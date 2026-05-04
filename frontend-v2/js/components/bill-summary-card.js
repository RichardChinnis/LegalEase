/**
 * BillSummaryCard Component
 *
 * Displays AI-generated bill summaries with angel/devil/realistic perspectives.
 * Provides tabbed interface for viewing different summary types.
 */

class BillSummaryCard extends BaseComponent {
    constructor(props) {
        super(props);
        this.state = {
            activeTab: 'short',
            summaries: props.summaries || null,
            loading: !props.summaries,
            error: null,
            generating: false
        };
    }

    getDefaultProps() {
        return {
            billId: null,  // Format: "119-hr-123"
            congress: null,
            billType: null,
            billNumber: null,
            summaries: null,  // Pre-loaded summaries
            showGenerate: true,  // Show generate button if no summaries
            compact: false,
            onSummaryGenerated: null  // Callback when summary is generated
        };
    }

    /**
     * Initialize and fetch summaries if not provided
     */
    async afterMount() {
        if (!this.state.summaries && this.props.billId) {
            await this.fetchSummaries();
        }
    }

    /**
     * Fetch summaries from API
     */
    async fetchSummaries() {
        const { billId, congress, billType, billNumber } = this.props;

        // Determine API parameters
        let apiCongress, apiType, apiNumber;
        if (billId) {
            const parts = billId.split('-');
            apiCongress = parts[0];
            apiType = parts[1];
            apiNumber = parts[2];
        } else {
            apiCongress = congress;
            apiType = billType;
            apiNumber = billNumber;
        }

        if (!apiCongress || !apiType || !apiNumber) {
            this.setState({ loading: false, error: 'Missing bill information' });
            return;
        }

        try {
            this.setState({ loading: true, error: null });

            const response = await fetch(`/api/db/bill/${apiCongress}/${apiType}/${apiNumber}/ai-summary`);

            if (!response.ok) {
                if (response.status === 404) {
                    // No summaries yet - that's okay
                    this.setState({ loading: false, summaries: null });
                    return;
                }
                throw new Error('Failed to fetch summaries');
            }

            const data = await response.json();
            this.setState({
                loading: false,
                summaries: data.summaries || null
            });
        } catch (error) {
            console.error('[BillSummaryCard] Error fetching summaries:', error);
            this.setState({ loading: false, error: error.message });
        }
    }

    /**
     * Generate summaries via API
     */
    async generateSummaries() {
        const { billId, congress, billType, billNumber, onSummaryGenerated } = this.props;

        let apiCongress, apiType, apiNumber;
        if (billId) {
            const parts = billId.split('-');
            apiCongress = parts[0];
            apiType = parts[1];
            apiNumber = parts[2];
        } else {
            apiCongress = congress;
            apiType = billType;
            apiNumber = billNumber;
        }

        if (!apiCongress || !apiType || !apiNumber) {
            return;
        }

        try {
            this.setState({ generating: true, error: null });

            const response = await fetch(`/api/db/bill/${apiCongress}/${apiType}/${apiNumber}/ai-summary`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    types: ['short', 'optimistic', 'cynical', 'realistic']
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to generate summaries');
            }

            const data = await response.json();
            this.setState({
                generating: false,
                summaries: data.summaries || null
            });

            if (onSummaryGenerated) {
                onSummaryGenerated(data.summaries);
            }
        } catch (error) {
            console.error('[BillSummaryCard] Error generating summaries:', error);
            this.setState({ generating: false, error: error.message });
        }
    }

    /**
     * Switch active tab
     */
    switchTab(tab) {
        this.setState({ activeTab: tab });
        this.render();
    }

    /**
     * Get summary content for a specific type
     */
    getSummaryContent(type) {
        const { summaries } = this.state;
        if (!summaries) return null;

        // Handle both object and array formats
        if (Array.isArray(summaries)) {
            const summary = summaries.find(s => s.summary_type === type || s.summaryType === type);
            return summary?.content || null;
        }

        return summaries[type] || null;
    }

    /**
     * Tab configuration
     */
    getTabs() {
        return [
            {
                id: 'short',
                label: 'Summary',
                icon: this.getIcon('summary'),
                description: 'One-sentence summary'
            },
            {
                id: 'optimistic',
                label: 'Angel',
                icon: this.getIcon('angel'),
                description: 'Best case interpretation'
            },
            {
                id: 'cynical',
                label: 'Devil',
                icon: this.getIcon('devil'),
                description: 'Cynical interpretation'
            },
            {
                id: 'realistic',
                label: 'Realistic',
                icon: this.getIcon('realistic'),
                description: 'Balanced assessment'
            }
        ];
    }

    /**
     * Get icon SVG for tab
     */
    getIcon(type) {
        const icons = {
            summary: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>`,
            angel: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                <line x1="9" y1="9" x2="9.01" y2="9"></line>
                <line x1="15" y1="9" x2="15.01" y2="9"></line>
                <path d="M12 2C9 2 6 4 6 7"></path>
                <path d="M12 2C15 2 18 4 18 7"></path>
            </svg>`,
            devil: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M16 16s-1.5-2-4-2-4 2-4 2"></path>
                <line x1="9" y1="9" x2="9.01" y2="9"></line>
                <line x1="15" y1="9" x2="15.01" y2="9"></line>
                <path d="M6 3L9 6"></path>
                <path d="M18 3L15 6"></path>
            </svg>`,
            realistic: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="8" y1="15" x2="16" y2="15"></line>
                <line x1="9" y1="9" x2="9.01" y2="9"></line>
                <line x1="15" y1="9" x2="15.01" y2="9"></line>
            </svg>`
        };
        return icons[type] || icons.summary;
    }

    template() {
        const { compact, showGenerate } = this.props;
        const { loading, error, generating, activeTab, summaries } = this.state;

        // Loading state
        if (loading) {
            return `
                <div class="bill-summary-card ${compact ? 'bill-summary-card--compact' : ''}">
                    <div class="bill-summary-card__loading">
                        <div class="loading-spinner"></div>
                        <span>Loading summaries...</span>
                    </div>
                </div>
            `;
        }

        // Error state
        if (error) {
            return `
                <div class="bill-summary-card ${compact ? 'bill-summary-card--compact' : ''}">
                    <div class="bill-summary-card__error">
                        <span class="error-icon">!</span>
                        <span>${error}</span>
                    </div>
                </div>
            `;
        }

        // No summaries - show pending message
        if (!summaries) {
            return `
                <div class="bill-summary-card ${compact ? 'bill-summary-card--compact' : ''}">
                    <div class="bill-summary-card__empty">
                        <div class="empty-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                                <path d="M2 17l10 5 10-5"></path>
                                <path d="M2 12l10 5 10-5"></path>
                            </svg>
                        </div>
                        <p class="empty-text">AI summaries pending</p>
                        <p class="empty-subtext">Summaries are generated automatically and will appear here soon.</p>
                    </div>
                </div>
            `;
        }


        // Show summaries with tabs
        const tabs = this.getTabs();
        const currentContent = this.getSummaryContent(activeTab);

        return `
            <div class="bill-summary-card ${compact ? 'bill-summary-card--compact' : ''}">
                <div class="bill-summary-card__tabs">
                    ${tabs.map(tab => `
                        <button class="summary-tab ${activeTab === tab.id ? 'summary-tab--active' : ''} summary-tab--${tab.id}"
                                data-tab="${tab.id}"
                                title="${tab.description}">
                            <span class="summary-tab__icon">${tab.icon}</span>
                            <span class="summary-tab__label">${tab.label}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="bill-summary-card__content">
                    ${currentContent
                        ? `<p class="summary-text summary-text--${activeTab}">${this.escapeHtml(currentContent)}</p>`
                        : `<p class="summary-text summary-text--empty">No ${activeTab} summary available</p>`
                    }
                </div>
            </div>
        `;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Bind events after render
     */
    afterRender() {
        const container = this.getContainer();
        if (!container) return;

        // Tab click handlers
        const tabs = container.querySelectorAll('.summary-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const tabId = tab.dataset.tab;
                this.switchTab(tabId);
            });
        });

        // Generate button handler
        const generateBtn = container.querySelector('.generate-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await this.generateSummaries();
                this.render();
            });
        }
    }

    /**
     * Get the container element
     */
    getContainer() {
        if (this.element) return this.element;
        // Try to find by class if mounted
        return document.querySelector('.bill-summary-card');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillSummaryCard;
} else {
    window.BillSummaryCard = BillSummaryCard;
}
