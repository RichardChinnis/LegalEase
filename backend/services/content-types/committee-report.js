/**
 * Committee Report Content Type Definition
 *
 * Defines how Congressional committee reports are handled in chat conversations,
 * including the system prompt, metadata formatting, and available context sections.
 */

module.exports = {
  id: 'committee-report',
  name: 'Committee Report',

  /**
   * Detect if the provided content info represents a committee report
   * @param {Object} info - Content information object
   * @returns {boolean} - True if this is a committee report
   */
  detect: (info) => {
    // Committee reports are identified by explicit contentType or presence of reportType/reportNumber
    return info.contentType === 'committee-report' ||
           (info.reportType && info.reportNumber);
  },

  /**
   * System prompt for committee report-related conversations
   */
  systemPrompt: `You are a knowledgeable assistant specializing in Congressional committee reports. You have been provided with the full text of a committee report that accompanies legislation or addresses a specific topic.

Your role is to help users understand and analyze this report by:
1. Summarizing the committee's findings and recommendations
2. Explaining the rationale for proposed legislation or policy positions
3. Identifying minority views or dissenting opinions when present
4. Clarifying cost estimates, implementation details, and projected impacts
5. Providing context about the committee's analysis and methodology

Guidelines:
- Be accurate and objective in your analysis
- Distinguish between majority and minority views when present
- Reference specific sections or page numbers when relevant
- Explain technical legislative or policy terminology
- Note any cost estimates from the Congressional Budget Office (CBO)
- Focus on the report content rather than broader political commentary
- If asked about subsequent actions, note that this information may not be in the report

The following committee report has been provided as context for your responses.`,

  /**
   * Format the content header for committee reports
   * @param {Object} info - Committee report information
   * @returns {string} - Formatted header string
   */
  formatHeader: (info) => {
    const reportType = info.reportType?.toUpperCase() || '';
    const reportNumber = info.reportNumber || info.number || 'Unknown';
    const congress = info.congress || 'Unknown';
    const title = info.title || 'No title available';
    const issueDate = info.issueDate || info.updateDate || 'Date not available';

    // Format chamber from reportType (H.Rept = House, S.Rept = Senate)
    let chamber = 'Unknown';
    if (reportType.includes('H')) {
      chamber = 'House';
    } else if (reportType.includes('S')) {
      chamber = 'Senate';
    }

    // Include committee info if available
    let committeeInfo = '';
    if (info.committees && Array.isArray(info.committees) && info.committees.length > 0) {
      const committeeNames = info.committees.map(c => c.name).join(', ');
      committeeInfo = `\nCommittee: ${committeeNames}`;
    }

    return `Committee Report: ${reportType} ${reportNumber} (${congress}th Congress)
Title: ${title}
Chamber: ${chamber}
Issue Date: ${issueDate}${committeeInfo}`;
  },

  /**
   * Available context sections for committee reports
   */
  sections: [
    {
      id: 'report_text',
      title: 'Report Text',
      configKey: 'includeReportText',
      default: true  // Report text is included by default when provided
    },
    {
      id: 'associated_bill',
      title: 'Associated Bill',
      configKey: 'includeAssociatedBill',
      default: false
    }
  ]
};
