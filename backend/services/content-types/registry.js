/**
 * Content Type Registry
 *
 * Central registry for all supported content types in the chat system.
 * Handles content type detection and provides access to type definitions.
 *
 * Usage:
 *   const registry = require('./content-types/registry');
 *   const contentType = registry.detect(contentInfo);
 *   console.log(contentType.systemPrompt);
 *
 * Adding new content types:
 *   1. Create a new type definition file (e.g., treaty.js)
 *   2. Import and register in registerDefaults() below
 *   3. Add any required section fetchers in context-assembler.js
 */

const { logger } = require('../../logger');

// Import content type definitions
const billType = require('./bill');
const hearingType = require('./hearing');
const committeeReportType = require('./committee-report');
const congressionalRecordType = require('./congressional-record');

class ContentTypeRegistry {
  constructor() {
    this.types = new Map();
    this.registerDefaults();
  }

  /**
   * Register all default content types
   */
  registerDefaults() {
    // Register in order of specificity (more specific types first)
    // This matters for detection fallback when contentType is not explicitly set
    this.register(hearingType);           // Has jacketNumber
    this.register(committeeReportType);   // Has reportType/reportNumber
    this.register(congressionalRecordType); // Has volume/issueNumber
    this.register(billType);              // Default fallback (type/number/congress)
  }

  /**
   * Register a content type definition
   * @param {Object} typeDefinition - Content type definition object
   */
  register(typeDefinition) {
    if (!typeDefinition.id) {
      throw new Error('Content type definition must have an id');
    }
    if (!typeDefinition.detect || typeof typeDefinition.detect !== 'function') {
      throw new Error(`Content type ${typeDefinition.id} must have a detect function`);
    }
    if (!typeDefinition.systemPrompt) {
      throw new Error(`Content type ${typeDefinition.id} must have a systemPrompt`);
    }
    if (!typeDefinition.formatHeader || typeof typeDefinition.formatHeader !== 'function') {
      throw new Error(`Content type ${typeDefinition.id} must have a formatHeader function`);
    }

    this.types.set(typeDefinition.id, typeDefinition);
    logger.debug(`Registered content type: ${typeDefinition.id}`);
  }

  /**
   * Detect the content type from content information
   * @param {Object} contentInfo - Content information object (billInfo, hearingInfo, etc.)
   * @returns {Object} - The matching content type definition
   */
  detect(contentInfo) {
    if (!contentInfo) {
      logger.warn('detect() called with null/undefined contentInfo, defaulting to bill');
      return this.types.get('bill');
    }

    // Check explicit contentType first (most reliable)
    if (contentInfo.contentType && this.types.has(contentInfo.contentType)) {
      logger.debug(`Content type detected from explicit contentType: ${contentInfo.contentType}`);
      return this.types.get(contentInfo.contentType);
    }

    // Fall back to detection logic (iterate in registration order)
    for (const [id, typeDef] of this.types) {
      try {
        if (typeDef.detect(contentInfo)) {
          logger.debug(`Content type detected via detect() function: ${id}`);
          return typeDef;
        }
      } catch (error) {
        logger.warn(`Error in detect() for content type ${id}:`, error.message);
      }
    }

    // Default to bill for backward compatibility
    logger.debug('No content type detected, defaulting to bill');
    return this.types.get('bill');
  }

  /**
   * Get a specific content type by ID
   * @param {string} typeId - Content type identifier
   * @returns {Object|undefined} - Content type definition or undefined
   */
  get(typeId) {
    return this.types.get(typeId);
  }

  /**
   * Check if a content type is registered
   * @param {string} typeId - Content type identifier
   * @returns {boolean} - True if registered
   */
  has(typeId) {
    return this.types.has(typeId);
  }

  /**
   * List all registered content types
   * @returns {Array} - Array of content type definitions
   */
  list() {
    return Array.from(this.types.values());
  }

  /**
   * List all registered content type IDs
   * @returns {Array} - Array of content type IDs
   */
  listIds() {
    return Array.from(this.types.keys());
  }

  /**
   * Get a summary of all registered types (for debugging/logging)
   * @returns {Object} - Summary object
   */
  getSummary() {
    const summary = {};
    for (const [id, typeDef] of this.types) {
      summary[id] = {
        name: typeDef.name,
        sections: typeDef.sections.map(s => s.id)
      };
    }
    return summary;
  }
}

// Export singleton instance
module.exports = new ContentTypeRegistry();
