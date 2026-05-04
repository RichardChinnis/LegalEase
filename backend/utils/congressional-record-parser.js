const logger = require('../logger');

/**
 * Parser for extracting Congressional Record references from bill action text
 */
class CongressionalRecordParser {
  constructor() {
    // Common CR reference patterns
    this.patterns = {
      // Standard format: CR H1234, CR S5678, CR H1234-1235, CR S5678-5679
      standard: /\bCR\s+([HSED])(\d+)(?:-([HSED])?(\d+))?\b/gi,
      
      // With "pp." or "p.": Congressional Record pp. S1234-S1235
      pages: /\bCongressional\s+Record\s+p{1,2}\.\s*([HSED])(\d+)(?:-([HSED])?(\d+))?\b/gi,
      
      // In parentheses: (text: CR H1234)
      textReference: /\(text:\s*CR\s+([HSED])(\d+)(?:-([HSED])?(\d+))?\)/gi,
      
      // Volume references: 169 Cong. Rec. S1234
      volumeReference: /\b(\d{2,3})\s+Cong\.\s*Rec\.\s*([HSED])(\d+)(?:-([HSED])?(\d+))?\b/gi,
      
      // Daily digest references: CR D1234
      dailyDigest: /\bCR\s+(D)(\d+)(?:-(D)?(\d+))?\b/gi,
      
      // Extensions of remarks: CR E1234
      extensions: /\bCR\s+(E)(\d+)(?:-(E)?(\d+))?\b/gi
    };
    
    // Chamber code mapping
    this.chamberMap = {
      'H': 'House',
      'S': 'Senate',
      'E': 'Extensions',
      'D': 'Daily Digest'
    };
  }

  /**
   * Parse all Congressional Record references from action text
   * @param {string} actionText - The action text to parse
   * @returns {Array} Array of parsed references
   */
  parseReferences(actionText) {
    if (!actionText || typeof actionText !== 'string') {
      return [];
    }

    const references = [];
    const processedRefs = new Set(); // Avoid duplicates

    // Process each pattern type
    Object.entries(this.patterns).forEach(([patternName, pattern]) => {
      let match;
      pattern.lastIndex = 0; // Reset regex state
      
      while ((match = pattern.exec(actionText)) !== null) {
        const reference = this.extractReference(match, patternName);
        
        if (reference) {
          const refKey = `${reference.chamber}-${reference.startPage}-${reference.endPage}`;
          
          if (!processedRefs.has(refKey)) {
            processedRefs.add(refKey);
            references.push(reference);
          }
        }
      }
    });

    return references;
  }

  /**
   * Extract reference details from regex match
   * @param {Array} match - Regex match array
   * @param {string} patternName - Name of the pattern that matched
   * @returns {Object|null} Parsed reference object
   */
  extractReference(match, patternName) {
    try {
      let chamber, startPage, endChamber, endPage, volume;

      switch (patternName) {
        case 'standard':
        case 'textReference':
        case 'dailyDigest':
        case 'extensions':
          [, chamber, startPage, endChamber, endPage] = match;
          break;
        
        case 'pages':
          [, chamber, startPage, endChamber, endPage] = match;
          break;
        
        case 'volumeReference':
          [, volume, chamber, startPage, endChamber, endPage] = match;
          break;
        
        default:
          return null;
      }

      // Validate chamber code
      if (!chamber || !this.chamberMap[chamber.toUpperCase()]) {
        return null;
      }

      chamber = chamber.toUpperCase();
      
      // Normalize page numbers
      startPage = this.normalizePageNumber(startPage);
      if (!startPage) return null;

      // Handle end page
      if (endPage) {
        endPage = this.normalizePageNumber(endPage);
        // If end chamber is different or missing, use start chamber
        if (!endChamber || endChamber.toUpperCase() !== chamber) {
          endChamber = chamber;
        }
      } else {
        endPage = null;
        endChamber = null;
      }

      const reference = {
        referenceText: match[0].trim(),
        chamber: chamber,
        chamberName: this.chamberMap[chamber],
        startPage: `${chamber}${startPage}`,
        endPage: endPage ? `${endChamber || chamber}${endPage}` : null,
        pageRange: endPage ? 
          `${chamber}${startPage}-${endChamber || chamber}${endPage}` : 
          `${chamber}${startPage}`,
        patternType: patternName
      };

      // Add volume if available
      if (volume) {
        reference.volume = parseInt(volume, 10);
      }

      // Add position in text for context
      reference.position = {
        start: match.index,
        end: match.index + match[0].length
      };

      return reference;
    } catch (error) {
      logger.error('Error extracting reference:', error, { match, patternName });
      return null;
    }
  }

  /**
   * Normalize page number (remove non-numeric characters, validate)
   * @param {string} pageStr - Page number string
   * @returns {string|null} Normalized page number
   */
  normalizePageNumber(pageStr) {
    if (!pageStr) return null;
    
    // Remove non-numeric characters
    const normalized = pageStr.replace(/\D/g, '');
    
    // Validate it's a reasonable page number (1-99999)
    const pageNum = parseInt(normalized, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > 99999) {
      return null;
    }
    
    return normalized;
  }

  /**
   * Parse volume and date information from action text
   * @param {string} actionText - The action text
   * @returns {Object|null} Volume and date info if found
   */
  parseVolumeInfo(actionText) {
    // Pattern for volume citations like "169 Cong. Rec. S1234 (July 15, 2023)"
    const volumePattern = /\b(\d{2,3})\s+Cong\.\s*Rec\.\s*[HSED]\d+\s*\(([^)]+)\)/i;
    const match = actionText.match(volumePattern);
    
    if (match) {
      const [, volume, dateStr] = match;
      
      return {
        volume: parseInt(volume, 10),
        dateString: dateStr.trim(),
        parsedDate: this.parseDate(dateStr)
      };
    }
    
    return null;
  }

  /**
   * Parse date string to ISO format
   * @param {string} dateStr - Date string to parse
   * @returns {string|null} ISO date string or null
   */
  parseDate(dateStr) {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (error) {
      // Invalid date
    }
    return null;
  }

  /**
   * Extract context around a reference
   * @param {string} text - Full text
   * @param {Object} reference - Reference object with position
   * @param {number} contextLength - Characters of context on each side
   * @returns {string} Context string
   */
  extractContext(text, reference, contextLength = 100) {
    if (!reference.position) return '';
    
    const start = Math.max(0, reference.position.start - contextLength);
    const end = Math.min(text.length, reference.position.end + contextLength);
    
    let context = text.substring(start, end);
    
    // Add ellipsis if truncated
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context.trim();
  }

  /**
   * Validate and enhance references with additional metadata
   * @param {Array} references - Array of parsed references
   * @param {string} fullText - Full action text for context
   * @returns {Array} Enhanced references
   */
  enhanceReferences(references, fullText) {
    return references.map(ref => {
      // Add context
      ref.context = this.extractContext(fullText, ref);
      
      // Estimate date from context if possible
      const volumeInfo = this.parseVolumeInfo(
        fullText.substring(
          Math.max(0, ref.position.start - 50),
          Math.min(fullText.length, ref.position.end + 50)
        )
      );
      
      if (volumeInfo) {
        ref.estimatedVolume = volumeInfo.volume;
        ref.estimatedDate = volumeInfo.parsedDate;
      }
      
      // Calculate confidence score based on pattern match quality
      ref.confidence = this.calculateConfidence(ref);
      
      return ref;
    });
  }

  /**
   * Calculate confidence score for a reference
   * @param {Object} reference - Reference object
   * @returns {number} Confidence score (0-100)
   */
  calculateConfidence(reference) {
    let score = 50; // Base score
    
    // Higher confidence for standard patterns
    if (reference.patternType === 'standard' || reference.patternType === 'textReference') {
      score += 30;
    } else if (reference.patternType === 'volumeReference') {
      score += 40; // Volume references are most specific
    } else {
      score += 20;
    }
    
    // Higher confidence if we have end page (range)
    if (reference.endPage) {
      score += 10;
    }
    
    // Higher confidence if we have volume/date info
    if (reference.estimatedVolume) {
      score += 10;
    }
    
    return Math.min(100, score);
  }

  /**
   * Parse all references from a batch of actions
   * @param {Array} actions - Array of action objects
   * @returns {Array} All parsed references with action context
   */
  parseActionsBatch(actions) {
    const allReferences = [];
    
    for (const action of actions) {
      if (!action.text) continue;
      
      const references = this.parseReferences(action.text);
      const enhancedRefs = this.enhanceReferences(references, action.text);
      
      // Add action context to each reference
      enhancedRefs.forEach(ref => {
        ref.actionId = action.action_id;
        ref.actionDate = action.action_date;
        ref.actionType = action.action_type;
        ref.billId = action.bill_id;
      });
      
      allReferences.push(...enhancedRefs);
    }
    
    return allReferences;
  }
}

module.exports = CongressionalRecordParser;