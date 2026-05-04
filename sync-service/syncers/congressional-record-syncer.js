const CongressClient = require('../lib/congress-client');
const DatabaseService = require('../lib/database');
const logger = require('../lib/logger');
const config = require('../config');
const CongressionalRecordParser = require('../../backend/utils/congressional-record-parser');

/**
 * Congressional Record Syncer
 * 
 * Synchronizes Congressional Record data from the Congress API including:
 * - Daily CR volumes, issues, and sections
 * - Individual articles with full-text content
 * - References from bill actions to CR pages
 * - Resolution of CR references to specific articles
 */
class CongressionalRecordSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.parser = new CongressionalRecordParser();
    this.stats = {
      volumes: { inserted: 0, updated: 0, failed: 0 },
      issues: { inserted: 0, updated: 0, failed: 0 },
      sections: { inserted: 0, updated: 0, failed: 0 },
      articles: { inserted: 0, updated: 0, failed: 0 },
      references: { inserted: 0, updated: 0, matched: 0, failed: 0 },
      totalProcessed: 0,
      errors: []
    };
  }

  /**
   * Transform CR volume data from API to database format
   * @param {Object} apiVolume - Volume data from Congress API
   * @returns {Object} Transformed volume data
   */
  transformVolumeData(apiVolume) {
    return {
      volume_number: parseInt(apiVolume.volumeNumber),
      congress: parseInt(apiVolume.congress),
      session_number: parseInt(apiVolume.sessionNumber || apiVolume.session || 1),
      year: parseInt(apiVolume.year) || new Date(apiVolume.issueDate).getFullYear(),
      metadata: JSON.stringify({
        url: apiVolume.url,
        updateDate: apiVolume.updateDate
      })
    };
  }

  /**
   * Transform CR issue data from API to database format
   * @param {Object} apiIssue - Issue data from Congress API
   * @param {number} volumeId - Database volume ID
   * @returns {Object} Transformed issue data
   */
  transformIssueData(apiIssue, volumeId) {
    return {
      volume_id: volumeId,
      issue_number: parseInt(apiIssue.issueNumber),
      issue_date: new Date(apiIssue.issueDate || apiIssue.dateIssued),
      congress: parseInt(apiIssue.congress),
      session_number: parseInt(apiIssue.sessionNumber || apiIssue.session || 1),
      full_issue_url: apiIssue.fullIssueUrl,
      update_date: apiIssue.updateDate ? new Date(apiIssue.updateDate) : null,
      metadata: JSON.stringify({
        url: apiIssue.url,
        links: apiIssue.links || []
      })
    };
  }

  /**
   * Transform CR section data from API to database format
   * @param {Object} apiSection - Section data from Congress API
   * @param {number} issueId - Database issue ID
   * @returns {Object} Transformed section data
   */
  transformSectionData(apiSection, issueId) {
    // Map section names from API to database enum values
    const sectionNameMap = {
      'Senate Section': 'Senate',
      'House Section': 'House', 
      'Extensions of Remarks Section': 'Extensions of Remarks',
      'Daily Digest': 'Daily Digest',
      // Legacy mappings
      'SENATE': 'Senate',
      'HOUSE': 'House', 
      'EXTENSIONS': 'Extensions of Remarks',
      'DAILY_DIGEST': 'Daily Digest'
    };

    const sectionName = sectionNameMap[apiSection.name] || sectionNameMap[apiSection.type] || apiSection.name;

    return {
      issue_id: issueId,
      name: sectionName,
      start_page: apiSection.startPage,
      end_page: apiSection.endPage || null,
      pdf_url: apiSection.pdfUrl,
      text_url: apiSection.textUrl,
      metadata: JSON.stringify({
        url: apiSection.url,
        type: apiSection.type,
        links: apiSection.links || []
      })
    };
  }

  /**
   * Transform CR article data from API to database format
   * @param {Object} apiArticle - Article data from Congress API
   * @param {number} sectionId - Database section ID
   * @returns {Object} Transformed article data
   */
  transformArticleData(apiArticle, sectionId) {
    // Extract URLs from the text array
    let pdfUrl = null;
    let textUrl = null;
    
    if (apiArticle.text && Array.isArray(apiArticle.text)) {
      // Find PDF URL
      const pdfEntry = apiArticle.text.find(t => t.type === 'PDF');
      if (pdfEntry) {
        pdfUrl = pdfEntry.url;
      }
      
      // Find HTML/Text URL
      const textEntry = apiArticle.text.find(t => t.type === 'Formatted Text' || t.type === 'HTML');
      if (textEntry) {
        textUrl = textEntry.url;
      }
    }
    
    // Fall back to direct properties if they exist
    pdfUrl = pdfUrl || apiArticle.pdfUrl || null;
    textUrl = textUrl || apiArticle.textUrl || null;
    
    const contentText = apiArticle.content || apiArticle.fullText || null;
    
    return {
      section_id: sectionId,
      title: apiArticle.title || 'Untitled',
      start_page: apiArticle.startPage,
      end_page: apiArticle.endPage || null,
      pdf_url: pdfUrl,
      text_url: textUrl,
      content_text: contentText,
      word_count: contentText ? contentText.split(/\s+/).length : null,
      character_count: contentText ? contentText.length : null,
      metadata: JSON.stringify({
        url: apiArticle.url,
        links: apiArticle.links || [],
        speakers: apiArticle.speakers || [],
        subjects: apiArticle.subjects || [],
        textEntries: apiArticle.text || []
      })
    };
  }

  /**
   * Upsert a Congressional Record volume
   * @param {Object} volumeData - Transformed volume data
   * @returns {Object} Upsert result with volume_id
   */
  async upsertVolume(volumeData) {
    return this.db.upsertCongressionalRecordVolume(volumeData);
  }

  /**
   * Upsert a Congressional Record issue
   * @param {Object} issueData - Transformed issue data
   * @returns {Object} Upsert result with issue_id
   */
  async upsertIssue(issueData) {
    return this.db.upsertCongressionalRecordIssue(issueData);
  }

  /**
   * Upsert a Congressional Record section
   * @param {Object} sectionData - Transformed section data
   * @returns {Object} Upsert result with section_id
   */
  async upsertSection(sectionData) {
    return this.db.upsertCongressionalRecordSection(sectionData);
  }

  /**
   * Upsert a Congressional Record article
   * @param {Object} articleData - Transformed article data
   * @returns {Object} Upsert result with article_id
   */
  async upsertArticle(articleData) {
    return this.db.upsertCongressionalRecordArticle(articleData);
  }

  /**
   * Sync Congressional Record data for a specific volume and issue
   * @param {number} volumeNumber - Volume number
   * @param {number} issueNumber - Issue number  
   * @param {Object} options - Additional options
   * @returns {Object} Sync results
   */
  async syncCongressionalRecordIssue(volumeNumber, issueNumber, options = {}) {
    const { syncArticles = true, syncContent = false } = options;
    
    logger.info('Starting CR issue sync', { volumeNumber, issueNumber });

    try {
      // Step 1: Fetch daily CR data
      const crData = await this.client.getDailyCongressionalRecord(volumeNumber, issueNumber);
      
      if (!crData || !crData.issue) {
        logger.warn('No CR data found', { volumeNumber, issueNumber });
        return { success: false, error: 'No data found' };
      }

      const dailyRecord = crData.issue;

      // Step 2: Upsert volume
      const volumeData = this.transformVolumeData(dailyRecord);
      const volumeResult = await this.upsertVolume(volumeData);
      
      if (volumeResult.inserted) this.stats.volumes.inserted++;
      else this.stats.volumes.updated++;

      // Step 3: Upsert issue
      const issueData = this.transformIssueData(dailyRecord, volumeResult.volume_id);
      const issueResult = await this.upsertIssue(issueData);
      
      if (issueResult.inserted) this.stats.issues.inserted++;
      else this.stats.issues.updated++;

      // Step 4: Sync sections
      const sections = dailyRecord.fullIssue?.sections || dailyRecord.sections || [];
      const sectionResults = [];

      for (const apiSection of sections) {
        try {
          const sectionData = this.transformSectionData(apiSection, issueResult.issue_id);
          const sectionResult = await this.upsertSection(sectionData);
          
          if (sectionResult.inserted) this.stats.sections.inserted++;
          else this.stats.sections.updated++;
          
          sectionResults.push({
            ...sectionResult,
            sectionName: apiSection.name
          });

        } catch (error) {
          this.stats.sections.failed++;
          this.stats.errors.push({
            type: 'section',
            volumeNumber,
            issueNumber,
            section: apiSection.name,
            error: error.message
          });
          logger.error('Failed to sync CR section', {
            volumeNumber, issueNumber,
            section: apiSection.name,
            error: error.message
          });
        }
      }

      // Step 5: Sync articles if requested
      if (syncArticles) {
        try {
          // Fetch articles from the articles endpoint
          const articlesResponse = await this.client.getCongressionalRecordArticles(volumeNumber, issueNumber, { limit: 250 });
          
          if (articlesResponse && articlesResponse.articles) {
            // Process each section's articles
            for (const sectionData of articlesResponse.articles) {
              // Find matching section from our results
              const matchingSection = sectionResults.find(s => s.sectionName === sectionData.name);
              
              if (matchingSection && sectionData.sectionArticles) {
                await this.syncSectionArticles(matchingSection.section_id, sectionData.sectionArticles, { syncContent });
              }
            }
          }

        } catch (error) {
          logger.error('Failed to sync CR articles', {
            volumeNumber, issueNumber,
            error: error.message
          });
          this.stats.errors.push({
            type: 'articles',
            volumeNumber,
            issueNumber,
            error: error.message
          });
        }
      }

      this.stats.totalProcessed++;

      logger.info('CR issue sync completed', {
        volumeNumber, issueNumber,
        stats: {
          sections: sectionResults.length,
          volumes: this.stats.volumes,
          issues: this.stats.issues,
          sections: this.stats.sections,
          articles: this.stats.articles
        }
      });

      return {
        success: true,
        volumeId: volumeResult.volume_id,
        issueId: issueResult.issue_id,
        sectionsProcessed: sectionResults.length,
        stats: { ...this.stats }
      };

    } catch (error) {
      logger.error('CR issue sync failed', {
        volumeNumber, issueNumber,
        error: error.message,
        stack: error.stack
      });

      this.stats.errors.push({
        type: 'issue',
        volumeNumber,
        issueNumber,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        stats: { ...this.stats }
      };
    }
  }

  /**
   * Sync articles for a specific section
   * @param {number} sectionId - Database section ID
   * @param {Array} articles - Array of article data from API
   * @param {Object} options - Sync options
   */
  async syncSectionArticles(sectionId, articles, options = {}) {
    const { syncContent = false } = options;

    for (const apiArticle of articles) {
      try {
        // If full content sync is requested, fetch article details
        if (syncContent && apiArticle.url) {
          const detailedArticle = await this.client.getCongressionalRecordArticle(apiArticle.url);
          if (detailedArticle) {
            Object.assign(apiArticle, detailedArticle);
          }
        }

        const articleData = this.transformArticleData(apiArticle, sectionId);
        const result = await this.upsertArticle(articleData);
        
        if (result.inserted) this.stats.articles.inserted++;
        else this.stats.articles.updated++;

      } catch (error) {
        this.stats.articles.failed++;
        this.stats.errors.push({
          type: 'article',
          sectionId,
          article: apiArticle.title,
          error: error.message
        });
        logger.error('Failed to sync CR article', {
          sectionId,
          article: apiArticle.title,
          error: error.message
        });
      }
    }
  }

  /**
   * Parse and create references from bill actions to Congressional Record
   * @param {Array} actions - Bill actions to process
   * @returns {Object} Processing results
   */
  async processCongressionalRecordReferences(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return { processed: 0, inserted: 0, matched: 0 };
    }

    logger.info('Processing CR references from actions', { actionCount: actions.length });

    let processed = 0;
    let inserted = 0;
    let matched = 0;

    for (const action of actions) {
      try {
        // Parse references from action text
        const references = this.parser.parseReferences(action.text);
        
        if (references.length === 0) continue;

        processed++;

        // Create reference records for each parsed reference
        for (const reference of references) {
          const referenceData = {
            action_id: action.action_id,
            bill_id: action.bill_id,
            reference_text: reference.referenceText,
            chamber: reference.chamber,
            start_page: reference.startPage,
            end_page: reference.endPage,
            is_resolved: false,
            resolution_confidence: reference.confidence / 100,
            metadata: JSON.stringify({
              patternType: reference.patternType,
              context: reference.context,
              estimatedVolume: reference.estimatedVolume,
              estimatedDate: reference.estimatedDate
            })
          };

          const result = await this.upsertCongressionalRecordReference(referenceData);
          if (result.inserted) inserted++;

          // Attempt to resolve reference to actual CR content
          const matchResult = await this.resolveReference(result.reference_id, referenceData);
          if (matchResult.matched) matched++;
        }

      } catch (error) {
        this.stats.references.failed++;
        this.stats.errors.push({
          type: 'reference',
          actionId: action.action_id,
          error: error.message
        });
        logger.error('Failed to process CR references', {
          actionId: action.action_id,
          error: error.message
        });
      }
    }

    this.stats.references.inserted += inserted;
    this.stats.references.matched += matched;

    logger.info('CR reference processing completed', {
      processed, inserted, matched
    });

    return { processed, inserted, matched };
  }

  /**
   * Upsert a Congressional Record reference
   * @param {Object} referenceData - Reference data
   * @returns {Object} Upsert result
   */
  async upsertCongressionalRecordReference(referenceData) {
    return this.db.upsertCongressionalRecordReference(referenceData);
  }

  /**
   * Attempt to resolve a CR reference to actual content
   * @param {number} referenceId - Reference ID
   * @param {Object} referenceData - Reference data
   * @returns {Object} Resolution result
   */
  async resolveReference(referenceId, referenceData) {
    try {
      // Use the database function to find matching articles
      const matches = await this.db.findArticlesByPageRange(
        referenceData.chamber,
        referenceData.start_page,
        referenceData.end_page
      );

      if (matches.length > 0) {
        // Take the best match (first result)
        const bestMatch = matches[0];
        
        // Update reference with resolution
        const confidence = Math.min(0.95, (referenceData.resolution_confidence || 0.5) + 0.3);
        const notes = `Auto-resolved to "${bestMatch.title}" (${bestMatch.issue_date})`;

        const resolutionData = {
          issue_id: bestMatch.issue_id,
          section_id: bestMatch.section_id,
          article_id: bestMatch.article_id,
          is_resolved: true,
          resolution_confidence: confidence,
          resolution_notes: notes
        };

        const updateResult = await this.db.updateCRReferenceResolution(referenceId, resolutionData);

        if (updateResult.success) {
          logger.debug('CR reference resolved', {
            referenceId,
            articleTitle: bestMatch.title,
            issueDate: bestMatch.issue_date,
            confidence
          });

          return { matched: true, articleId: bestMatch.article_id };
        }
      }

      return { matched: false };

    } catch (error) {
      logger.error('Failed to resolve CR reference', {
        referenceId,
        error: error.message
      });
      return { matched: false, error: error.message };
    }
  }

  /**
   * Sync recent Congressional Record issues
   * @param {Object} options - Sync options
   * @returns {Object} Sync results
   */
  async syncRecentCongressionalRecord(options = {}) {
    const {
      days = config.sync.incrementalDays['congressional-record'] || 7,
      syncArticles = true,
      syncContent = false
    } = options;

    // Reset stats at the start of sync
    this.stats = {
      volumes: { inserted: 0, updated: 0, failed: 0 },
      issues: { inserted: 0, updated: 0, failed: 0 },
      sections: { inserted: 0, updated: 0, failed: 0 },
      articles: { inserted: 0, updated: 0, failed: 0 },
      references: { inserted: 0, updated: 0, matched: 0, failed: 0 },
      totalProcessed: 0,
      errors: []
    };

    const startTime = Date.now();
    logger.info('Starting recent CR sync', { days, syncArticles, syncContent });

    try {
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get list of recent issues
      const issues = await this.client.getRecentCongressionalRecord(startDate, endDate);
      
      logger.info(`Found ${issues.length} recent CR issues to sync`);

      const batchSize = config.sync.batchSizes.reports || 25;
      let processed = 0;
      let successful = 0;

      // Process in batches
      for (let i = 0; i < issues.length; i += batchSize) {
        const batch = issues.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (issue) => {
          try {
            const result = await this.syncCongressionalRecordIssue(
              issue.volumeNumber, 
              issue.issueNumber,
              { syncArticles, syncContent }
            );
            
            processed++;
            if (result.success) successful++;

          } catch (error) {
            processed++;
            logger.error('Failed to sync CR issue', {
              volumeNumber: issue.volumeNumber,
              issueNumber: issue.issueNumber,
              error: error.message
            });
          }
        }));

        logger.info(`Processed CR batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(issues.length / batchSize)}`);
      }

      const duration = Date.now() - startTime;

      // Update sync status
      await this.updateSyncStatus('congressional-record', {
        success: true,
        records_synced: successful,
        records_failed: processed - successful,
        duration,
        metadata: {
          days,
          syncArticles,
          syncContent,
          stats: this.stats
        }
      });

      logger.info('Recent CR sync completed', {
        duration: `${duration}ms`,
        processed,
        successful,
        stats: this.stats
      });

      return {
        success: true,
        processed,
        successful,
        duration,
        stats: { ...this.stats }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      await this.updateSyncStatus('congressional-record', {
        success: false,
        error: error.message,
        duration,
        metadata: { days }
      });

      logger.error('Recent CR sync failed', {
        error: error.message,
        duration: `${duration}ms`
      });

      return {
        success: false,
        error: error.message,
        duration,
        stats: { ...this.stats }
      };
    }
  }

  /**
   * Sync all unresolved Congressional Record references
   * @returns {Object} Sync results
   */
  async syncUnresolvedReferences() {
    // Reset stats at the start of sync
    this.stats = {
      volumes: { inserted: 0, updated: 0, failed: 0 },
      issues: { inserted: 0, updated: 0, failed: 0 },
      sections: { inserted: 0, updated: 0, failed: 0 },
      articles: { inserted: 0, updated: 0, failed: 0 },
      references: { inserted: 0, updated: 0, matched: 0, failed: 0 },
      totalProcessed: 0,
      errors: []
    };

    logger.info('Starting unresolved CR references sync');

    try {
      // Get all unresolved references using database method
      const unresolvedRefs = await this.db.getUnresolvedCRReferences(1000);

      logger.info(`Found ${unresolvedRefs.length} unresolved CR references`);

      let resolved = 0;
      
      for (const ref of unresolvedRefs) {
        const matchResult = await this.resolveReference(ref.reference_id, ref);
        if (matchResult.matched) resolved++;
      }

      logger.info('Unresolved CR references sync completed', {
        total: unresolvedRefs.length,
        resolved
      });

      return {
        success: true,
        total: unresolvedRefs.length,
        resolved
      };

    } catch (error) {
      logger.error('Unresolved CR references sync failed', {
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update sync status in database
   * @param {string} entityType - Type of sync
   * @param {Object} status - Status data
   */
  async updateSyncStatus(entityType, status) {
    try {
      await this.db.updateSyncStatus(entityType, status);
    } catch (error) {
      logger.error('Failed to update sync status', { 
        entityType, 
        error: error.message 
      });
    }
  }

  /**
   * Main sync method
   * @param {Object} options - Sync options
   * @returns {Object} Sync results
   */
  async sync(options = {}) {
    const { 
      type = 'recent', 
      volumeNumber = null,
      issueNumber = null,
      ...otherOptions 
    } = options;

    switch (type) {
      case 'recent':
        return this.syncRecentCongressionalRecord(otherOptions);
      
      case 'issue':
        if (!volumeNumber || !issueNumber) {
          throw new Error('Volume and issue number required for issue sync');
        }
        return this.syncCongressionalRecordIssue(volumeNumber, issueNumber, otherOptions);
      
      case 'references':
        return this.syncUnresolvedReferences();
        
      default:
        throw new Error(`Unknown sync type: ${type}`);
    }
  }

  /**
   * Close database connection
   */
  async close() {
    await this.db.close();
  }
}

module.exports = CongressionalRecordSyncer;