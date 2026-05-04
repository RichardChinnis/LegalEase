/**
 * Bill Content Type Definition
 *
 * Defines how Congressional bills are handled in chat conversations,
 * including the system prompt, metadata formatting, and available context sections.
 */

module.exports = {
  id: 'bill',
  name: 'Congressional Bill',

  /**
   * Detect if the provided content info represents a bill
   * @param {Object} info - Content information object
   * @returns {boolean} - True if this is a bill
   */
  detect: (info) => {
    // Bills have type, number, and congress but NOT jacketNumber (which indicates a hearing)
    return info.type && info.number && info.congress && !info.jacketNumber && !info.reportType;
  },

  /**
   * System prompt for bill-related conversations
   */
  systemPrompt: `You are a knowledgeable assistant specializing in U.S. Congressional legislation. You have been provided with detailed information about a specific bill including its text, sponsors, summaries, and related documentation.

Your role is to help users understand and analyze this legislation by:
1. Explaining the bill's purpose, key provisions, and potential impacts
2. Clarifying complex legal or technical language
3. Providing context about the legislative process and timeline
4. Answering questions about specific sections or provisions
5. Discussing potential implications and related issues

Guidelines:
- Be accurate and objective in your analysis
- Cite specific sections or provisions when relevant
- Explain technical terms and legislative procedures
- Acknowledge limitations in your knowledge
- Focus on the provided bill information rather than general political commentary
- If asked about current status, note that your information may not be up-to-date

The following information about the bill has been provided as context for your responses.`,

  /**
   * Format the content header for bills
   * @param {Object} info - Bill information
   * @returns {string} - Formatted header string
   */
  formatHeader: (info) => {
    const billType = info.type?.toUpperCase() || 'Unknown';
    const billNumber = info.number || 'Unknown';
    const congress = info.congress || 'Unknown';
    const title = info.title || 'No title available';
    const introducedDate = info.introducedDate || 'Date not available';

    return `Bill: ${billType} ${billNumber} (${congress}th Congress)
Title: ${title}
Introduced: ${introducedDate}`;
  },

  /**
   * Available context sections for bills
   * Each section defines:
   * - id: Unique identifier used by section fetchers
   * - title: Display title in the context
   * - configKey: Which contextConfig key enables this section
   * - default: Whether to include by default when configKey is not specified
   */
  sections: [
    {
      id: 'bill_text',
      title: 'Bill Text',
      configKey: 'billTextVersion',
      default: false
    },
    {
      id: 'sponsor',
      title: 'Sponsor Information',
      configKey: 'includeSponsor',
      default: false
    },
    {
      id: 'cosponsors',
      title: 'Cosponsors',
      configKey: 'includeCosponsors',
      default: false
    },
    {
      id: 'summary',
      title: 'Bill Summary',
      configKey: 'summaryVersion',
      default: false
    },
    {
      id: 'committee_reports',
      title: 'Committee Reports',
      configKey: 'includeCommitteeReports',
      default: false
    }
  ]
};
