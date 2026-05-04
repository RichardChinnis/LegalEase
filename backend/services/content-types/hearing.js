/**
 * Hearing Content Type Definition
 *
 * Defines how Congressional hearings are handled in chat conversations,
 * including the system prompt, metadata formatting, and available context sections.
 */

module.exports = {
  id: 'hearing',
  name: 'Congressional Hearing',

  /**
   * Detect if the provided content info represents a hearing
   * @param {Object} info - Content information object
   * @returns {boolean} - True if this is a hearing
   */
  detect: (info) => {
    // Hearings are identified by explicit contentType or presence of jacketNumber
    return info.contentType === 'hearing' || !!info.jacketNumber;
  },

  /**
   * System prompt for hearing-related conversations
   */
  systemPrompt: `You are a knowledgeable assistant specializing in U.S. Congressional hearings. You have been provided with detailed information about a specific hearing including its transcript, witness testimony, and committee information.

Your role is to help users understand and analyze this hearing by:
1. Summarizing key testimony and statements from witnesses
2. Explaining the questions and concerns raised by committee members
3. Identifying the main topics and themes discussed
4. Clarifying technical or policy-related terminology
5. Providing context about the hearing's purpose and significance

Guidelines:
- Be accurate and objective in your analysis
- Reference specific testimony or exchanges when relevant
- Distinguish between witness statements and committee member questions
- Acknowledge when information is unclear or contested
- Focus on the hearing content rather than broader political commentary
- If asked about outcomes or follow-up actions, note that this information may not be in the transcript

The following information about the hearing has been provided as context for your responses.`,

  /**
   * Format the content header for hearings
   * @param {Object} info - Hearing information
   * @returns {string} - Formatted header string
   */
  formatHeader: (info) => {
    const jacketNumber = info.jacketNumber || 'Unknown';
    const congress = info.congress || 'Unknown';
    const title = info.title || 'No title available';
    const chamber = info.chamber || 'Unknown';

    // Format hearing date from dates array if available
    let hearingDate = 'Date not available';
    if (info.dates && Array.isArray(info.dates) && info.dates.length > 0) {
      const firstDate = info.dates[0].date || info.dates[0];
      hearingDate = new Date(firstDate).toLocaleDateString();
    } else if (info.updateDate) {
      hearingDate = new Date(info.updateDate).toLocaleDateString();
    }

    // Format committee info if available
    let committeeInfo = '';
    if (info.committees && Array.isArray(info.committees) && info.committees.length > 0) {
      const committeeNames = info.committees.map(c => c.name).join(', ');
      committeeInfo = `\nCommittee: ${committeeNames}`;
    }

    return `Hearing: ${jacketNumber} (${congress}th Congress)
Title: ${title}
Chamber: ${chamber}
Date: ${hearingDate}${committeeInfo}`;
  },

  /**
   * Available context sections for hearings
   */
  sections: [
    {
      id: 'hearing_text',
      title: 'Hearing Transcript',
      configKey: 'includeTranscript',
      default: true  // Hearing text is included by default when provided
    },
    {
      id: 'committees',
      title: 'Committees',
      configKey: 'includeCommittees',
      default: false
    }
  ]
};
