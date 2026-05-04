/**
 * Content Types Module
 *
 * This module provides a centralized registry for managing different content types
 * in the chat system. Each content type defines:
 * - Detection logic (how to identify this content type from contentInfo)
 * - System prompt (LLM instructions specific to this content type)
 * - Header formatting (how to display content metadata)
 * - Available sections (what context sections can be included)
 *
 * Supported Content Types:
 * - bill: Congressional bills (HR, S, HJRES, etc.)
 * - hearing: Congressional hearings
 * - committee-report: Committee reports
 * - congressional-record: Congressional Record articles
 *
 * Usage:
 *   const { registry, contentTypes } = require('./content-types');
 *
 *   // Auto-detect content type
 *   const type = registry.detect(contentInfo);
 *   console.log(type.systemPrompt);
 *
 *   // Get specific type
 *   const billType = registry.get('bill');
 *
 *   // List all types
 *   const allTypes = registry.list();
 *
 * Adding New Content Types:
 *   1. Create a new file (e.g., treaty.js) following the existing patterns
 *   2. Import and register in registry.js
 *   3. Add any new section fetchers in context-assembler.js
 */

const registry = require('./registry');

// Re-export individual type definitions for direct access if needed
const billType = require('./bill');
const hearingType = require('./hearing');
const committeeReportType = require('./committee-report');
const congressionalRecordType = require('./congressional-record');

module.exports = {
  // Primary export - the registry singleton
  registry,

  // Individual content type definitions (for testing or direct access)
  contentTypes: {
    bill: billType,
    hearing: hearingType,
    'committee-report': committeeReportType,
    'congressional-record': congressionalRecordType
  },

  // Convenience re-exports of registry methods
  detect: (contentInfo) => registry.detect(contentInfo),
  get: (typeId) => registry.get(typeId),
  has: (typeId) => registry.has(typeId),
  list: () => registry.list(),
  listIds: () => registry.listIds()
};
