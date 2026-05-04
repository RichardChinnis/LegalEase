/**
 * Congressional Record Link Parser
 * Parses CR page references in bill action text and creates clickable links
 */

const CRLinkParser = {
    // Unique ID counter for CR link elements
    _linkIdCounter: 0,

    /**
     * Regex pattern for CR page references
     * Matches: "CR S8893-8894", "CR H6000-6004", "CR S8926", "CR H5956"
     */
    CR_PATTERN: /CR\s+([SH])(\d+)(?:-(\d+))?/gi,

    /**
     * Parse all CR references from action text
     * @param {string} text - Action text to parse
     * @returns {Array} Array of reference objects
     */
    parseReferences(text) {
        if (!text) return [];

        const references = [];
        const pattern = new RegExp(this.CR_PATTERN.source, 'gi');
        let match;

        while ((match = pattern.exec(text)) !== null) {
            const chamber = match[1].toUpperCase();
            const startPage = match[2];
            const endPage = match[3] || null;

            // Validate page number (3-6 digits)
            if (startPage.length >= 3 && startPage.length <= 6) {
                references.push({
                    chamber,
                    startPage,
                    endPage,
                    pageRef: `${chamber}${startPage}`,
                    fullMatch: match[0],
                    matchIndex: match.index,
                    isRange: !!endPage
                });
            }
        }

        // Remove duplicates based on pageRef
        const unique = references.filter((ref, index, self) =>
            index === self.findIndex(r => r.pageRef === ref.pageRef && r.matchIndex === ref.matchIndex)
        );

        return unique;
    },

    /**
     * Format a page reference string
     * @param {string} chamber - 'S' or 'H'
     * @param {string} page - Page number
     * @returns {string} Formatted reference like "H4725"
     */
    formatPageRef(chamber, page) {
        return `${chamber.toUpperCase()}${page}`;
    },

    /**
     * Get chamber full name
     * @param {string} chamber - 'S' or 'H'
     * @returns {string} Full chamber name
     */
    getChamberName(chamber) {
        const names = {
            'S': 'Senate',
            'H': 'House',
            'E': 'Extensions of Remarks',
            'D': 'Daily Digest'
        };
        return names[chamber.toUpperCase()] || 'Unknown';
    },

    /**
     * Enhance action text with clickable CR links
     * @param {string} text - Action text (should be HTML-escaped already)
     * @param {number} congress - Congress number for API context
     * @param {string} billTitle - Bill title for API context
     * @returns {string} Text with CR references wrapped in anchor tags
     */
    enhanceTextWithLinks(text, congress, billTitle) {
        if (!text) return text;

        const references = this.parseReferences(text);
        if (references.length === 0) return text;

        let enhancedText = text;

        // Process in reverse order to maintain correct indices
        for (let i = references.length - 1; i >= 0; i--) {
            const ref = references[i];
            const linkId = `cr-link-${ref.pageRef}-${++this._linkIdCounter}`;

            // Create the link HTML
            const displayText = ref.isRange
                ? `CR ${ref.chamber}${ref.startPage}-${ref.endPage}`
                : `CR ${ref.pageRef}`;

            const link = `<a class="cr-page-link"
                id="${linkId}"
                href="#"
                data-page-ref="${ref.pageRef}"
                data-chamber="${ref.chamber}"
                data-start-page="${ref.startPage}"
                ${ref.endPage ? `data-end-page="${ref.endPage}"` : ''}
                data-congress="${congress || ''}"
                data-bill-title="${this.escapeAttr(billTitle || '')}"
                title="View Congressional Record ${displayText}">${displayText}</a>`;

            // Replace the match with the link
            enhancedText = enhancedText.substring(0, ref.matchIndex) +
                          link +
                          enhancedText.substring(ref.matchIndex + ref.fullMatch.length);
        }

        return enhancedText;
    },

    /**
     * Escape string for use in HTML attribute
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeAttr(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CRLinkParser;
}

// Make available globally
window.CRLinkParser = CRLinkParser;
