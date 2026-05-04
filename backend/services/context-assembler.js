/**
 * Context Assembler
 *
 * Assembles context for LLM conversations based on content type.
 * Uses the content type registry to auto-detect content type and
 * generate appropriate system prompts and context sections.
 */

const { logger } = require('../logger');
const axios = require('axios');
const contentTypeRegistry = require('./content-types/registry');

class ContextAssembler {
  constructor(congressAPIClient) {
    this.congressAPIClient = congressAPIClient;
    this.sectionFetchers = this.initializeSectionFetchers();
  }

  /**
   * Main entry point - assembles context for any content type
   * Auto-detects content type and generates appropriate context
   *
   * @param {Object} contentInfo - Content information (billInfo, hearingInfo, etc.)
   * @param {Object} contextConfig - Configuration for what sections to include
   * @param {string} providedText - Pre-fetched text content (transcript, report text, etc.)
   * @returns {Object} - Assembled context object
   */
  async assembleContext(contentInfo, contextConfig, providedText = '') {
    // Detect content type
    const contentType = contentTypeRegistry.detect(contentInfo);

    logger.info(`Assembling context for ${contentType.name}`, {
      typeId: contentType.id,
      config: contextConfig,
      providedTextLength: providedText ? providedText.length : 0
    });

    // Initialize context with type-specific system prompt and header
    const context = {
      contentType: contentType.id,
      systemPrompt: contentType.systemPrompt,
      billInfo: contentType.formatHeader(contentInfo), // Keep 'billInfo' key for backward compatibility
      sections: []
    };

    try {
      // Assemble sections based on content type definition
      for (const sectionDef of contentType.sections) {
        const shouldInclude = this.shouldIncludeSection(sectionDef, contextConfig, providedText);

        if (shouldInclude) {
          const section = await this.fetchSection(
            sectionDef,
            contentInfo,
            contextConfig,
            providedText
          );
          if (section) {
            context.sections.push(section);
          }
        }
      }

      logger.info(`Context assembled with ${context.sections.length} sections`, {
        contentType: contentType.id,
        sections: context.sections.map(s => s.type)
      });

      return context;

    } catch (error) {
      logger.error('Error assembling context:', error);
      throw new Error(`Failed to assemble context: ${error.message}`);
    }
  }

  /**
   * Legacy method for backward compatibility - delegates to assembleContext
   * @deprecated Use assembleContext() instead
   */
  async assembleHearingContext(hearingInfo, contextConfig, hearingText = '') {
    logger.debug('assembleHearingContext called - delegating to assembleContext');
    // Ensure contentType is set for proper detection
    if (!hearingInfo.contentType) {
      hearingInfo.contentType = 'hearing';
    }
    return this.assembleContext(hearingInfo, contextConfig, hearingText);
  }

  /**
   * Determine if a section should be included based on config and available data
   */
  shouldIncludeSection(sectionDef, contextConfig, providedText) {
    // Sections that require provided text
    const textRequiredSections = ['hearing_text', 'report_text', 'record_text', 'committee_reports'];
    if (textRequiredSections.includes(sectionDef.id) && !providedText) {
      return false;
    }

    // Check if section has a config key
    if (sectionDef.configKey) {
      const configValue = contextConfig[sectionDef.configKey];

      // If config value is explicitly false/null/undefined, check default
      if (configValue === false || configValue === null || configValue === undefined) {
        return sectionDef.default === true;
      }

      // Config value is truthy (true, 'latest', version string, etc.)
      return true;
    }

    // No config key - use default
    return sectionDef.default === true;
  }

  /**
   * Fetch content for a section
   */
  async fetchSection(sectionDef, contentInfo, contextConfig, providedText) {
    const fetcher = this.sectionFetchers[sectionDef.id];
    if (!fetcher) {
      logger.warn(`No fetcher for section: ${sectionDef.id}`);
      return null;
    }

    try {
      const content = await fetcher(contentInfo, contextConfig, providedText);
      if (!content) return null;

      return {
        type: sectionDef.id,
        title: sectionDef.title,
        content,
        version: typeof contextConfig[sectionDef.configKey] === 'string'
          ? contextConfig[sectionDef.configKey]
          : undefined
      };
    } catch (error) {
      logger.error(`Error fetching section ${sectionDef.id}:`, error);
      return null;
    }
  }

  /**
   * Initialize section fetchers for all content types
   * Each fetcher receives (contentInfo, contextConfig, providedText) and returns string content
   */
  initializeSectionFetchers() {
    return {
      // ===== Bill sections =====
      bill_text: async (info, config) => {
        // Default to ~80,000 chars (~20,000 tokens) if not specified
        const maxChars = config.maxBillTextCharacters || 80000;
        return this.getBillText(info, config.billTextVersion, maxChars);
      },

      sponsor: async (info) => {
        return this.getSponsorInfo(info);
      },

      cosponsors: async (info) => {
        return this.getCosponsorsInfo(info);
      },

      summary: async (info, config) => {
        return this.getBillSummary(info, config.summaryVersion);
      },

      committee_reports: async (info, config, text) => {
        if (!text) return null;
        return `--- Committee Report ---\nThe following is the full text of a committee report related to the bill.\n\n${text}`;
      },

      // ===== Hearing sections =====
      hearing_text: async (info, config, text) => {
        return text || null;
      },

      committees: async (info) => {
        return this.getCommitteesInfo(info);
      },

      // ===== Committee Report sections =====
      report_text: async (info, config, text) => {
        return text || null;
      },

      associated_bill: async (info) => {
        return this.getAssociatedBillInfo(info);
      },

      // ===== Congressional Record sections =====
      record_text: async (info, config, text) => {
        return text || null;
      }
    };
  }

  // ===== Section Fetch Methods =====

  /**
   * Get bill text for specified version
   * @param {Object} billInfo - Bill information
   * @param {string} version - Version to fetch ('latest' or specific version)
   * @param {number} maxChars - Maximum characters to include (default: no limit)
   */
  async getBillText(billInfo, version, maxChars = null) {
    try {
      const { congress, type, number } = billInfo;
      const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/text`;
      const result = await this.congressAPIClient.get(endpoint);

      const textVersions = result.data.textVersions || result.data.data?.textVersions || [];

      if (version === 'latest' && textVersions.length > 0) {
        const latestVersion = textVersions[0];
        return await this.extractTextContent(latestVersion, maxChars);
      } else {
        const selectedVersion = textVersions.find(v => v.type === version);
        if (selectedVersion) {
          return await this.extractTextContent(selectedVersion, maxChars);
        }
      }

      return null;
    } catch (error) {
      logger.error('Error fetching bill text:', error);
      return null;
    }
  }

  /**
   * Extract text content from version object
   * @param {Object} version - Version object with formats
   * @param {number} maxChars - Maximum characters to include (null = no limit)
   */
  async extractTextContent(version, maxChars = null) {
    const formats = version.formats || [];

    // Prefer 'Formatted Text' format for cleaner content
    const textFormat = formats.find(f => f.type === 'Formatted Text');

    if (textFormat && textFormat.url) {
      try {
        logger.info(`Fetching bill text from URL: ${textFormat.url}`);
        const response = await axios.get(textFormat.url);
        if (typeof response.data === 'string' && response.data.length > 0) {
          let text = response.data;

          // Truncate if maxChars is specified and text exceeds limit
          if (maxChars && text.length > maxChars) {
            logger.info(`Truncating bill text from ${text.length} to ${maxChars} characters`);
            text = text.substring(0, maxChars) + '\n\n[... Text truncated due to length ...]';
          }

          return `Bill Text (${version.type}):\n${text}`;
        } else {
          logger.warn('Fetched bill text content was empty or not a string.', { url: textFormat.url });
          return `Bill Text (${version.type}):\n[Could not retrieve content from: ${textFormat.url}]`;
        }
      } catch (error) {
        logger.error('Failed to fetch bill text content from URL.', { url: textFormat.url, error: error.message });
        return `Bill Text (${version.type}):\n[Error fetching content from: ${textFormat.url}]`;
      }
    }

    // Fallback for other formats
    const anyFormat = formats[0];
    if (anyFormat && anyFormat.url) {
      logger.warn('Could not find "Formatted Text" version, URL available for other format.', { type: anyFormat.type, url: anyFormat.url });
      return `Bill Text (${version.type}):\n[Full text available at: ${anyFormat.url}]`;
    }

    return `Bill Text (${version.type}): No text content available`;
  }

  /**
   * Get sponsor information
   */
  async getSponsorInfo(billInfo) {
    try {
      const { congress, type, number } = billInfo;
      const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}`;
      const result = await this.congressAPIClient.get(endpoint);

      const bill = result.data.bill || result.data.data?.bill || result.data;
      const sponsors = bill.sponsors || [];

      if (sponsors.length === 0) {
        return 'No sponsor information available';
      }

      return sponsors.map(sponsor =>
        `${sponsor.firstName} ${sponsor.lastName} (${sponsor.party}-${sponsor.state})`
      ).join(', ');

    } catch (error) {
      logger.error('Error fetching sponsor info:', error);
      return 'Error loading sponsor information';
    }
  }

  /**
   * Get cosponsors information
   */
  async getCosponsorsInfo(billInfo) {
    try {
      const { congress, type, number } = billInfo;
      const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/cosponsors`;
      const result = await this.congressAPIClient.get(endpoint);

      const cosponsors = result.data.cosponsors || result.data.data?.cosponsors || [];

      if (cosponsors.length === 0) {
        return 'No cosponsors';
      }

      const cosponsorList = cosponsors.map(cosponsor =>
        `${cosponsor.firstName} ${cosponsor.lastName} (${cosponsor.party}-${cosponsor.state})`
      ).join(', ');

      return `Total Cosponsors: ${cosponsors.length}\n${cosponsorList}`;

    } catch (error) {
      logger.error('Error fetching cosponsors info:', error);
      return 'Error loading cosponsors information';
    }
  }

  /**
   * Get bill summary
   */
  async getBillSummary(billInfo, version) {
    try {
      const { congress, type, number } = billInfo;
      const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/summaries`;
      const result = await this.congressAPIClient.get(endpoint);

      const summaries = result.data.summaries || result.data.data?.summaries || [];

      if (summaries.length === 0) {
        return 'No summary available';
      }

      let selectedSummary;
      if (version === 'latest') {
        selectedSummary = summaries[0];
      } else {
        selectedSummary = summaries.find(s => s.actionDesc === version || s.type === version);
      }

      if (!selectedSummary) {
        selectedSummary = summaries[0];
      }

      return `Summary (${selectedSummary.actionDesc || selectedSummary.type}):\n${selectedSummary.text || selectedSummary.summary || 'No summary text available'}`;

    } catch (error) {
      logger.error('Error fetching bill summary:', error);
      return 'Error loading bill summary';
    }
  }

  /**
   * Get committees information (for hearings)
   */
  getCommitteesInfo(hearingInfo) {
    if (!hearingInfo.committees || !Array.isArray(hearingInfo.committees)) {
      return null;
    }

    const committeeNames = hearingInfo.committees
      .map(c => c.name)
      .filter(Boolean)
      .join(', ');

    return committeeNames || null;
  }

  /**
   * Get associated bill information (for committee reports)
   */
  async getAssociatedBillInfo(reportInfo) {
    // If report has associated bills in the data
    if (reportInfo.associatedBills && reportInfo.associatedBills.length > 0) {
      return reportInfo.associatedBills.map(bill =>
        `${bill.type?.toUpperCase()} ${bill.number} (${bill.congress}th Congress): ${bill.title || 'No title'}`
      ).join('\n');
    }

    // If report has a single associatedBill
    if (reportInfo.associatedBill) {
      const bill = reportInfo.associatedBill;
      return `${bill.type?.toUpperCase()} ${bill.number} (${bill.congress}th Congress): ${bill.title || 'No title'}`;
    }

    return null;
  }

  /**
   * Convert context to string format for LLM
   */
  contextToString(context) {
    logger.debug(`Converting context to string`, {
      contentType: context.contentType,
      sectionCount: context.sections.length,
      sections: context.sections.map(s => s.type)
    });

    let contextString = `${context.systemPrompt}\n\n`;
    contextString += `${context.billInfo}\n\n`;

    context.sections.forEach((section) => {
      contextString += `=== ${section.title} ===\n`;
      contextString += `${section.content}\n\n`;
    });

    logger.debug(`Final context string length: ${contextString.length}`);
    return contextString;
  }

  /**
   * Estimate token count for context
   */
  estimateTokenCount(context, tokenCounter) {
    const contextString = this.contextToString(context);
    return tokenCounter(contextString);
  }
}

module.exports = { ContextAssembler };
