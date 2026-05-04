/**
 * Formatting Utilities for Congressional Data
 * 
 * Provides consistent formatting for dates, text, political data,
 * and other congressional information throughout the application.
 */

const FormatUtils = {

    /**
     * Date and Time Formatting
     */
    date: {
        /**
         * Format date for display
         * @param {string|Date} date - Date to format
         * @param {Object} [options] - Formatting options
         * @returns {string} Formatted date string
         */
        format(date, options = {}) {
            if (!date) return '';

            const d = new Date(date);
            if (isNaN(d.getTime())) return 'Invalid Date';

            const defaultOptions = {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            };

            return d.toLocaleDateString('en-US', { ...defaultOptions, ...options });
        },

        /**
         * Format date as short format (MM/DD/YYYY)
         * @param {string|Date} date - Date to format
         * @returns {string} Short date string
         */
        short(date) {
            return this.format(date, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        },

        /**
         * Get relative time (e.g., "2 days ago", "in 3 hours")
         * @param {string|Date} date - Date to format
         * @param {Date} [baseDate=new Date()] - Base date for comparison
         * @returns {string} Relative time string
         */
        relative(date, baseDate = new Date()) {
            if (!date) return '';

            const d = new Date(date);
            const base = new Date(baseDate);
            
            if (isNaN(d.getTime()) || isNaN(base.getTime())) return 'Invalid Date';

            const diffMs = base.getTime() - d.getTime();
            const diffSeconds = Math.floor(diffMs / 1000);
            const diffMinutes = Math.floor(diffSeconds / 60);
            const diffHours = Math.floor(diffMinutes / 60);
            const diffDays = Math.floor(diffHours / 24);
            const diffWeeks = Math.floor(diffDays / 7);
            const diffMonths = Math.floor(diffDays / 30);
            const diffYears = Math.floor(diffDays / 365);

            const future = diffMs < 0;
            const abs = Math.abs;

            if (abs(diffSeconds) < 60) {
                return future ? 'in a few seconds' : 'a few seconds ago';
            } else if (abs(diffMinutes) < 60) {
                const minutes = abs(diffMinutes);
                return future 
                    ? `in ${minutes} minute${minutes !== 1 ? 's' : ''}`
                    : `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
            } else if (abs(diffHours) < 24) {
                const hours = abs(diffHours);
                return future 
                    ? `in ${hours} hour${hours !== 1 ? 's' : ''}`
                    : `${hours} hour${hours !== 1 ? 's' : ''} ago`;
            } else if (abs(diffDays) < 7) {
                const days = abs(diffDays);
                return future 
                    ? `in ${days} day${days !== 1 ? 's' : ''}`
                    : `${days} day${days !== 1 ? 's' : ''} ago`;
            } else if (abs(diffWeeks) < 4) {
                const weeks = abs(diffWeeks);
                return future 
                    ? `in ${weeks} week${weeks !== 1 ? 's' : ''}`
                    : `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
            } else if (abs(diffMonths) < 12) {
                const months = abs(diffMonths);
                return future 
                    ? `in ${months} month${months !== 1 ? 's' : ''}`
                    : `${months} month${months !== 1 ? 's' : ''} ago`;
            } else {
                const years = abs(diffYears);
                return future 
                    ? `in ${years} year${years !== 1 ? 's' : ''}`
                    : `${years} year${years !== 1 ? 's' : ''} ago`;
            }
        },

        /**
         * Format congressional session date
         * @param {string} congress - Congress number
         * @param {string} session - Session number
         * @returns {string} Formatted session string
         */
        congressional(congress, session) {
            if (!congress) return '';
            
            const congressNum = parseInt(congress);
            const sessionNum = session ? parseInt(session) : null;
            
            // Each congress spans 2 years, starting from 1789
            const startYear = 1789 + (congressNum - 1) * 2;
            const endYear = startYear + 1;
            
            let result = `${congressNum}${this.getOrdinalSuffix(congressNum)} Congress (${startYear}-${endYear})`;
            
            if (sessionNum) {
                result += `, ${sessionNum}${this.getOrdinalSuffix(sessionNum)} Session`;
            }
            
            return result;
        },

        /**
         * Get ordinal suffix for numbers (1st, 2nd, 3rd, 4th, etc.)
         * @param {number} num - Number to get suffix for
         * @returns {string} Ordinal suffix
         */
        getOrdinalSuffix(num) {
            const j = num % 10;
            const k = num % 100;
            
            if (j === 1 && k !== 11) return 'st';
            if (j === 2 && k !== 12) return 'nd';
            if (j === 3 && k !== 13) return 'rd';
            return 'th';
        }
    },

    /**
     * Text Formatting Utilities
     */
    text: {
        /**
         * Truncate text to specified length with ellipsis
         * @param {string} text - Text to truncate
         * @param {number} length - Maximum length
         * @param {string} [suffix='...'] - Suffix to add when truncated
         * @returns {string} Truncated text
         */
        truncate(text, length, suffix = '...') {
            if (!text || text.length <= length) return text || '';
            return text.substring(0, length - suffix.length).trim() + suffix;
        },

        /**
         * Truncate text to word boundary
         * @param {string} text - Text to truncate
         * @param {number} maxWords - Maximum number of words
         * @param {string} [suffix='...'] - Suffix to add when truncated
         * @returns {string} Truncated text
         */
        truncateWords(text, maxWords, suffix = '...') {
            if (!text) return '';
            
            const words = text.trim().split(/\s+/);
            if (words.length <= maxWords) return text;
            
            return words.slice(0, maxWords).join(' ') + suffix;
        },

        /**
         * Capitalize first letter of each word
         * @param {string} text - Text to capitalize
         * @returns {string} Title cased text
         */
        titleCase(text) {
            if (!text) return '';
            return text.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
        },

        /**
         * Convert camelCase to Title Case
         * @param {string} text - CamelCase text
         * @returns {string} Title Case text
         */
        camelToTitle(text) {
            if (!text) return '';
            return text.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
        },

        /**
         * Strip HTML tags from text
         * @param {string} html - HTML string
         * @returns {string} Plain text
         */
        stripHTML(html) {
            if (!html) return '';
            const div = document.createElement('div');
            div.innerHTML = html;
            return div.textContent || div.innerText || '';
        },

        /**
         * Escape HTML characters to prevent XSS
         * @param {string} text - Text to escape
         * @returns {string} HTML-escaped text
         */
        escapeHtml(text) {
            if (!text) return '';
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, function(m) { return map[m]; });
        },

        /**
         * Highlight search terms in text
         * @param {string} text - Text to highlight in
         * @param {string|Array} terms - Search terms
         * @param {string} [className='highlight'] - CSS class for highlights
         * @returns {string} Text with highlighted terms
         */
        highlight(text, terms, className = 'highlight') {
            if (!text || !terms) return text;
            
            const termsArray = Array.isArray(terms) ? terms : [terms];
            let result = text;
            
            termsArray.forEach(term => {
                if (term.trim()) {
                    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    result = result.replace(regex, `<span class="${className}">$1</span>`);
                }
            });
            
            return result;
        }
    },

    /**
     * Political Data Formatting
     */
    political: {
        /**
         * Format political party
         * @param {string} party - Party abbreviation (D, R, I, etc.)
         * @param {boolean} [full=false] - Return full party name
         * @returns {string} Formatted party
         */
        party(party, full = false) {
            if (!party) return '';
            
            const partyMap = {
                'D': full ? 'Democratic' : 'D',
                'R': full ? 'Republican' : 'R',
                'I': full ? 'Independent' : 'I',
                'L': full ? 'Libertarian' : 'L',
                'G': full ? 'Green' : 'G'
            };
            
            return partyMap[party.toUpperCase()] || party;
        },

        /**
         * Get party color class
         * @param {string} party - Party abbreviation
         * @returns {string} CSS class name
         */
        partyColor(party) {
            if (!party) return 'party-other';
            
            const colorMap = {
                'D': 'party-democratic',
                'R': 'party-republican',
                'I': 'party-independent'
            };
            
            return colorMap[party.toUpperCase()] || 'party-other';
        },

        /**
         * Format member state and district
         * @param {string} state - State abbreviation
         * @param {string} district - District number
         * @returns {string} Formatted district
         */
        district(state, district) {
            if (!state) return '';
            
            if (district && district !== '0' && district !== 'At Large') {
                return `${state}-${district}`;
            }
            
            return state;
        },

        /**
         * Format member title and name
         * @param {Object} member - Member object
         * @returns {string} Formatted name with title
         */
        memberName(member) {
            if (!member) return '';

            const { title, firstName, lastName, middleName, suffix, chamber } = member;
            let name = '';

            // Use title if provided, otherwise derive from chamber
            let displayTitle = title;
            if (!displayTitle && chamber) {
                displayTitle = chamber === 'Senate' ? 'Sen.' : 'Rep.';
            }

            if (displayTitle) {
                name += `${displayTitle} `;
            }

            if (firstName) {
                name += firstName;
            }

            if (middleName) {
                name += ` ${middleName}`;
            }

            if (lastName) {
                name += ` ${lastName}`;
            }

            if (suffix) {
                name += ` ${suffix}`;
            }

            return name.trim();
        },

        /**
         * Format vote result
         * @param {Object} vote - Vote object
         * @returns {string} Formatted vote result
         */
        voteResult(vote) {
            if (!vote) return '';
            
            const { result, totalVotes, yesVotes, noVotes, presentVotes, notVotingVotes } = vote;
            
            let formatted = result || '';
            
            if (totalVotes) {
                const parts = [];
                if (yesVotes) parts.push(`${yesVotes} Yes`);
                if (noVotes) parts.push(`${noVotes} No`);
                if (presentVotes) parts.push(`${presentVotes} Present`);
                if (notVotingVotes) parts.push(`${notVotingVotes} Not Voting`);
                
                if (parts.length > 0) {
                    formatted += ` (${parts.join(', ')})`;
                }
            }
            
            return formatted;
        }
    },

    /**
     * Number Formatting
     */
    number: {
        /**
         * Format large numbers with commas
         * @param {number} num - Number to format
         * @returns {string} Formatted number
         */
        format(num) {
            if (num === null || num === undefined) return '';
            return num.toLocaleString('en-US');
        },

        /**
         * Format number as percentage
         * @param {number} num - Number to format (0-1 or 0-100)
         * @param {number} [decimals=1] - Number of decimal places
         * @param {boolean} [assumeDecimal=true] - Assume input is decimal (0-1)
         * @returns {string} Formatted percentage
         */
        percentage(num, decimals = 1, assumeDecimal = true) {
            if (num === null || num === undefined) return '';
            
            const value = assumeDecimal ? num * 100 : num;
            return `${value.toFixed(decimals)}%`;
        },

        /**
         * Format currency
         * @param {number} amount - Amount to format
         * @param {string} [currency='USD'] - Currency code
         * @returns {string} Formatted currency
         */
        currency(amount, currency = 'USD') {
            if (amount === null || amount === undefined) return '';
            
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency
            }).format(amount);
        },

        /**
         * Abbreviate large numbers (1K, 1M, 1B)
         * @param {number} num - Number to abbreviate
         * @param {number} [decimals=1] - Number of decimal places
         * @returns {string} Abbreviated number
         */
        abbreviate(num, decimals = 1) {
            if (num === null || num === undefined) return '';
            
            const absNum = Math.abs(num);
            const sign = num < 0 ? '-' : '';
            
            if (absNum >= 1e9) {
                return sign + (absNum / 1e9).toFixed(decimals) + 'B';
            } else if (absNum >= 1e6) {
                return sign + (absNum / 1e6).toFixed(decimals) + 'M';
            } else if (absNum >= 1e3) {
                return sign + (absNum / 1e3).toFixed(decimals) + 'K';
            } else {
                return num.toString();
            }
        }
    },

    /**
     * Bill and Legislative Formatting
     */
    bill: {
        /**
         * Format bill number
         * @param {Object|string} bill - Bill object or bill number
         * @returns {string} Formatted bill number
         */
        number(bill) {
            if (!bill) return '';
            
            if (typeof bill === 'string') {
                return bill.toUpperCase();
            }
            
            if (bill.type && bill.number) {
                const congress = bill.congress ? ` (${bill.congress})` : '';
                return `${bill.type.toUpperCase()} ${bill.number}${congress}`;
            }
            
            return '';
        },

        /**
         * Format bill title with truncation
         * @param {string} title - Bill title
         * @param {number} [maxLength=100] - Maximum length
         * @returns {string} Formatted title
         */
        title(title, maxLength = 100) {
            if (!title) return '';
            return FormatUtils.text.truncate(title, maxLength);
        },

        /**
         * Format bill status
         * @param {string} status - Bill status
         * @returns {string} Human-readable status
         */
        status(status) {
            if (!status) return '';
            
            const statusMap = {
                'introduced': 'Introduced',
                'referred': 'In Committee',
                'reported': 'Reported by Committee',
                'passed_house': 'Passed House',
                'passed_senate': 'Passed Senate',
                'failed': 'Failed',
                'enacted': 'Enacted',
                'vetoed': 'Vetoed'
            };
            
            return statusMap[status.toLowerCase()] || FormatUtils.text.titleCase(status.replace(/_/g, ' '));
        },

        /**
         * Get status progress percentage
         * @param {string} status - Current status
         * @returns {number} Progress percentage (0-100)
         */
        statusProgress(status) {
            if (!status) return 0;
            
            const progressMap = {
                'introduced': 10,
                'referred': 20,
                'reported': 40,
                'passed_house': 60,
                'passed_senate': 80,
                'enacted': 100,
                'failed': 0,
                'vetoed': 95
            };
            
            return progressMap[status.toLowerCase()] || 0;
        }
    },

    /**
     * URL and Link Formatting
     */
    url: {
        /**
         * Create member profile URL
         * @param {Object} member - Member object
         * @returns {string} Member profile URL
         */
        memberProfile(member) {
            if (!member || !member.id) return '#';
            return `/member/${member.id}`;
        },

        /**
         * Create bill detail URL
         * @param {Object} bill - Bill object
         * @returns {string} Bill detail URL
         */
        billDetail(bill) {
            if (!bill) return '#';
            
            if (bill.type && bill.number && bill.congress) {
                return `/bill/${bill.congress}/${bill.type}/${bill.number}`;
            } else if (bill.id) {
                return `/bill/${bill.id}`;
            }
            
            return '#';
        },

        /**
         * Create search URL
         * @param {string} query - Search query
         * @param {Object} [filters] - Search filters
         * @returns {string} Search URL
         */
        search(query, filters = {}) {
            const params = new URLSearchParams();
            
            if (query) params.set('q', query);
            
            Object.entries(filters).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });
            
            const queryString = params.toString();
            return `/search${queryString ? `?${queryString}` : ''}`;
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FormatUtils;
} else {
    window.FormatUtils = FormatUtils;
}