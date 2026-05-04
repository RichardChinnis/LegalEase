/**
 * SpotlightSection Component
 *
 * Primary "In the News" section for the dashboard main area.
 * Displays curated spotlight bills with full enhanced summaries,
 * news context, and "The Debate" information.
 *
 * This is the prominent, above-the-fold display of newsworthy legislation.
 */
class SpotlightSection {
    constructor(options = {}) {
        this.container = options.container;
        this.onBillClick = options.onBillClick || null;
        this.state = {
            spotlights: [],
            loading: false,
            error: null,
            activeBillId: null
        };

        this.setupGlobalListeners();

        // Bill ID normalization for consistent comparison
        this.normalizeBillId = (id) => {
            if (!id) return null;
            return String(id).toUpperCase();
        };

        // Category display configuration
        this.categoryConfig = {
            'breaking': { icon: '🔴', label: 'Breaking News', class: 'spotlight-card--breaking' },
            'trending': { icon: '🔥', label: 'Trending', class: 'spotlight-card--trending' },
            'upcoming_vote': { icon: '🗳️', label: 'Vote Coming Soon', class: 'spotlight-card--upcoming' },
            'just_passed': { icon: '✅', label: 'Just Passed', class: 'spotlight-card--passed' }
        };
    }

    /**
     * Set up global event listeners for cross-component communication
     */
    setupGlobalListeners() {
        // Listen for active bill changes to highlight in list
        if (typeof EventBus !== 'undefined' && typeof GLOBAL_EVENTS !== 'undefined') {
            EventBus.on(GLOBAL_EVENTS.BILL_ACTIVE_CHANGED, (data) => {
                this.updateActiveBill(data.billId);
            });
        }
    }

    /**
     * Update the active bill highlight
     * @param {string} billId - The bill ID to highlight
     */
    updateActiveBill(billId) {
        const normalizedId = this.normalizeBillId(billId);
        this.state.activeBillId = normalizedId;

        // Remove active class from all spotlight cards
        const allCards = this.container.querySelectorAll('.spotlight-card');
        allCards.forEach(card => card.classList.remove('is-active'));

        // Add active class to the matching card
        if (normalizedId) {
            const activeCard = this.container.querySelector(`.spotlight-card[data-bill-id="${normalizedId}"]`);
            if (activeCard) {
                activeCard.classList.add('is-active');
            }
        }
    }

    /**
     * Initialize and load spotlight data
     */
    async init() {
        await this.loadSpotlights();
    }

    /**
     * Load spotlight bills from API
     */
    async loadSpotlights() {
        if (!this.container) return;

        this.state.loading = true;
        this.renderLoadingState();

        try {
            const spotlights = await congressionalDataService.getSpotlightBills({ limit: 5 });

            this.state.spotlights = spotlights;
            this.state.loading = false;
            this.state.error = null;

            this.render();

        } catch (error) {
            console.error('[SpotlightSection] Error loading spotlights:', error);
            this.state.loading = false;
            this.state.error = error.message;
            this.renderErrorState();
        }
    }

    /**
     * Main render method
     */
    render() {
        if (!this.container) return;

        if (this.state.spotlights.length === 0) {
            this.renderEmptyState();
            return;
        }

        this.container.innerHTML = '';

        // Section header
        const header = document.createElement('div');
        header.className = 'spotlight-section__header';
        header.innerHTML = `
            <h2 class="spotlight-section__title">In the News</h2>
            <p class="spotlight-section__subtitle">Legislation making headlines right now</p>
        `;
        this.container.appendChild(header);

        // Cards container
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'spotlight-section__cards';

        this.state.spotlights.forEach((spotlight, index) => {
            const card = this.createSpotlightCard(spotlight, index === 0);
            cardsContainer.appendChild(card);
        });

        this.container.appendChild(cardsContainer);
    }

    /**
     * Create a spotlight card element
     * @param {Object} spotlight - Spotlight bill data
     * @param {boolean} isFeatured - Whether this is the first/featured card
     */
    createSpotlightCard(spotlight, isFeatured = false) {
        const card = document.createElement('article');
        const category = spotlight.spotlight?.category || 'trending';
        const categoryInfo = this.categoryConfig[category] || this.categoryConfig.trending;
        const billId = this.normalizeBillId(spotlight.id);
        const isActive = this.state.activeBillId === billId;

        card.className = `spotlight-card ${categoryInfo.class} ${isFeatured ? 'spotlight-card--featured' : ''} ${isActive ? 'is-active' : ''}`.trim();
        card.setAttribute('data-bill-id', billId || '');

        // Build the debate section if available
        const debateHtml = this.buildDebateSection(spotlight.enhancedSummary?.theDebate);

        // Build affects tags
        const tagsHtml = this.buildTagsSection(spotlight.enhancedSummary?.affectsTags);

        card.innerHTML = `
            <div class="spotlight-card__category">
                <span class="spotlight-card__category-icon">${categoryInfo.icon}</span>
                <span class="spotlight-card__category-label">${categoryInfo.label}</span>
            </div>

            ${spotlight.spotlight?.headline ? `
                <h3 class="spotlight-card__headline">${this.escapeHtml(spotlight.spotlight.headline)}</h3>
            ` : ''}

            <div class="spotlight-card__bill-info">
                <span class="spotlight-card__bill-number">${spotlight.type} ${spotlight.number}</span>
                <span class="spotlight-card__bill-status spotlight-card__bill-status--${(spotlight.status || 'introduced').toLowerCase().replace(/\s+/g, '-')}">${spotlight.status || 'Introduced'}</span>
            </div>

            <h4 class="spotlight-card__title">${this.escapeHtml(spotlight.title)}</h4>

            ${spotlight.enhancedSummary?.oneLiner ? `
                <p class="spotlight-card__one-liner">"${this.escapeHtml(spotlight.enhancedSummary.oneLiner)}"</p>
            ` : ''}

            ${spotlight.spotlight?.newsContext ? `
                <p class="spotlight-card__context">${this.escapeHtml(spotlight.spotlight.newsContext)}</p>
            ` : ''}

            ${debateHtml}

            ${tagsHtml}

            <div class="spotlight-card__actions">
                <button class="btn btn--primary btn--sm spotlight-card__learn-more" data-bill-id="${spotlight.id}">
                    Learn More
                </button>
                <button class="btn btn--outline btn--sm spotlight-card__follow" data-bill-id="${spotlight.id}">
                    <span class="follow-icon">☆</span> Follow
                </button>
            </div>
        `;

        // Add event listeners
        const learnMoreBtn = card.querySelector('.spotlight-card__learn-more');
        if (learnMoreBtn) {
            learnMoreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleBillClick(spotlight);
            });
        }

        const followBtn = card.querySelector('.spotlight-card__follow');
        if (followBtn) {
            followBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleFollowClick(spotlight, followBtn);
            });
        }

        // Make entire card clickable
        card.addEventListener('click', () => {
            this.handleBillClick(spotlight);
        });

        return card;
    }

    /**
     * Build the debate section HTML
     */
    buildDebateSection(theDebate) {
        if (!theDebate || (!theDebate.supporters && !theDebate.critics)) {
            return '';
        }

        return `
            <div class="spotlight-card__debate">
                <h5 class="spotlight-card__debate-title">The Debate</h5>
                ${theDebate.supporters ? `
                    <div class="spotlight-card__debate-side spotlight-card__debate-side--supporters">
                        <span class="debate-label">Supporters say:</span>
                        <p class="debate-text">${this.escapeHtml(theDebate.supporters)}</p>
                    </div>
                ` : ''}
                ${theDebate.critics ? `
                    <div class="spotlight-card__debate-side spotlight-card__debate-side--critics">
                        <span class="debate-label">Critics say:</span>
                        <p class="debate-text">${this.escapeHtml(theDebate.critics)}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Build the tags section HTML
     */
    buildTagsSection(tags) {
        if (!tags || tags.length === 0) {
            return '';
        }

        const tagHtml = tags.map(tag =>
            `<span class="spotlight-card__tag">${this.escapeHtml(tag)}</span>`
        ).join('');

        return `<div class="spotlight-card__tags">${tagHtml}</div>`;
    }

    /**
     * Handle bill click - emit event or call callback
     */
    handleBillClick(spotlight) {
        if (this.onBillClick) {
            this.onBillClick(spotlight);
        }

        // Also emit global event for dashboard integration
        if (typeof EventBus !== 'undefined' && typeof GLOBAL_EVENTS !== 'undefined') {
            EventBus.emit(GLOBAL_EVENTS.BILL_SELECTED, { bill: spotlight, source: 'spotlight-section' });
        }
    }

    /**
     * Handle follow button click
     */
    async handleFollowClick(spotlight, button) {
        try {
            button.disabled = true;
            const isNowFollowing = await congressionalDataService.toggleFollow('bill', spotlight.id);

            // Update button state
            const icon = button.querySelector('.follow-icon');
            if (isNowFollowing) {
                button.classList.add('spotlight-card__follow--following');
                if (icon) icon.textContent = '★';
                button.innerHTML = '<span class="follow-icon">★</span> Following';
            } else {
                button.classList.remove('spotlight-card__follow--following');
                if (icon) icon.textContent = '☆';
                button.innerHTML = '<span class="follow-icon">☆</span> Follow';
            }
        } catch (error) {
            console.error('[SpotlightSection] Error toggling follow:', error);
        } finally {
            button.disabled = false;
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Render loading state
     */
    renderLoadingState() {
        this.container.innerHTML = `
            <div class="spotlight-section__header">
                <h2 class="spotlight-section__title">In the News</h2>
                <p class="spotlight-section__subtitle">Legislation making headlines right now</p>
            </div>
            <div class="spotlight-section__loading">
                <div class="spotlight-card spotlight-card--skeleton">
                    <div class="loading-skeleton" style="width: 80px; height: 20px; margin-bottom: 12px;"></div>
                    <div class="loading-skeleton" style="width: 90%; height: 28px; margin-bottom: 8px;"></div>
                    <div class="loading-skeleton" style="width: 60%; height: 16px; margin-bottom: 16px;"></div>
                    <div class="loading-skeleton" style="width: 100%; height: 60px; margin-bottom: 12px;"></div>
                    <div class="loading-skeleton" style="width: 100%; height: 80px;"></div>
                </div>
                <div class="spotlight-card spotlight-card--skeleton">
                    <div class="loading-skeleton" style="width: 80px; height: 20px; margin-bottom: 12px;"></div>
                    <div class="loading-skeleton" style="width: 85%; height: 28px; margin-bottom: 8px;"></div>
                    <div class="loading-skeleton" style="width: 50%; height: 16px;"></div>
                </div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    renderErrorState() {
        this.container.innerHTML = `
            <div class="spotlight-section__header">
                <h2 class="spotlight-section__title">In the News</h2>
            </div>
            <div class="spotlight-section__error">
                <p>Unable to load spotlight bills</p>
                <button class="btn btn--secondary btn--sm" id="spotlight-retry-btn">
                    Try Again
                </button>
            </div>
        `;

        const retryBtn = this.container.querySelector('#spotlight-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.loadSpotlights());
        }
    }

    /**
     * Render empty state
     */
    renderEmptyState() {
        this.container.innerHTML = `
            <div class="spotlight-section__header">
                <h2 class="spotlight-section__title">In the News</h2>
            </div>
            <div class="spotlight-section__empty">
                <p>No spotlight legislation at this time.</p>
                <p class="text-muted">Check back soon for newsworthy bills and votes.</p>
            </div>
        `;
    }

    /**
     * Refresh the spotlight data
     */
    async refresh() {
        await this.loadSpotlights();
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpotlightSection;
} else {
    window.SpotlightSection = SpotlightSection;
}
