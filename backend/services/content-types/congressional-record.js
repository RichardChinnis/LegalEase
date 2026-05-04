/**
 * Congressional Record Content Type Definition
 *
 * Defines how Congressional Record content is handled in chat conversations,
 * including the system prompt, metadata formatting, and available context sections.
 */

module.exports = {
  id: 'congressional-record',
  name: 'Congressional Record',

  /**
   * Detect if the provided content info represents Congressional Record content
   * @param {Object} info - Content information object
   * @returns {boolean} - True if this is Congressional Record content
   */
  detect: (info) => {
    // Congressional Record is identified by explicit contentType or presence of volume/issueNumber
    return info.contentType === 'congressional-record' ||
           (info.volume && (info.issueNumber || info.issue));
  },

  /**
   * System prompt for Congressional Record-related conversations
   */
  systemPrompt: `You are a knowledgeable assistant specializing in the Congressional Record, the official record of the proceedings and debates of the United States Congress. You have been provided with content from the Congressional Record.

Your role is to help users understand and analyze this record by:
1. Summarizing floor speeches, debates, and statements
2. Explaining procedural actions, votes, and parliamentary maneuvers
3. Identifying key statements and positions from Members of Congress
4. Clarifying legislative procedures and parliamentary terminology
5. Providing context about the proceedings and their significance

Guidelines:
- Be accurate and objective in your analysis
- Distinguish between different speakers and their positions
- Reference specific page numbers or sections when relevant
- Explain procedural terms and parliamentary rules (e.g., cloture, unanimous consent, motion to recommit)
- Note whether content is from House proceedings, Senate proceedings, or Extensions of Remarks
- Distinguish between actual floor debate and inserted materials
- Focus on the record content rather than broader political commentary

The following Congressional Record content has been provided as context for your responses.`,

  /**
   * Format the content header for Congressional Record
   * @param {Object} info - Congressional Record information
   * @returns {string} - Formatted header string
   */
  formatHeader: (info) => {
    const volume = info.volume || 'Unknown';
    const issueNumber = info.issueNumber || info.issue || 'Unknown';
    const section = info.section || info.sectionName || 'Unknown';
    const issueDate = info.issueDate || info.date || 'Date not available';
    const congress = info.congress || 'Unknown';

    // Format section display name
    let sectionDisplay = section;
    const sectionMap = {
      'House': 'House Proceedings',
      'Senate': 'Senate Proceedings',
      'Extensions': 'Extensions of Remarks',
      'Digest': 'Daily Digest'
    };
    if (sectionMap[section]) {
      sectionDisplay = sectionMap[section];
    }

    // Include article title if available
    let titleInfo = '';
    if (info.title) {
      titleInfo = `\nTitle: ${info.title}`;
    }

    // Include page reference if available
    let pageInfo = '';
    if (info.startPage) {
      const endPage = info.endPage ? `-${info.endPage}` : '';
      pageInfo = `\nPages: ${info.startPage}${endPage}`;
    }

    return `Congressional Record: Volume ${volume}, Issue ${issueNumber} (${congress}th Congress)
Section: ${sectionDisplay}
Date: ${issueDate}${titleInfo}${pageInfo}`;
  },

  /**
   * Available context sections for Congressional Record
   */
  sections: [
    {
      id: 'record_text',
      title: 'Record Content',
      configKey: 'includeRecordText',
      default: true  // Record text is included by default when provided
    }
  ]
};
