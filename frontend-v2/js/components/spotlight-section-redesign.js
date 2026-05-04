/**
 * SpotlightSection Component - REDESIGNED
 *
 * Split-panel master-detail design for "In the News" section.
 * Features compact list view with side panel details.
 *
 * UX Improvements:
 * - 60-70% vertical space reduction
 * - Immediate detail visibility (no scrolling)
 * - Scannable list with clear hierarchy
 * - Mobile-responsive with drawer pattern
 */
class SpotlightSectionRedesigned {
    constructor(options = {}) {
        this.container = options.container;
        this.onBillClick = options.onBillClick || null;
        this.state = {
            spotlights: [],
            selectedSpotlight: null, // Currently selected bill
            loading: false,
            error: null,
            isMobile: window.innerWidth < 1024
        };

        // Category display configuration
        this.categoryConfig = {
            'breaking': { icon: '🔴', label: 'Breaking', shortLabel: 'Breaking', class: 'spotlight-compact--breaking' },
            'trending': { icon: '🔥', label: 'Trending', shortLabel: 'Trending', class: 'spotlight-compact--trending' },
            'upcoming_vote': { icon: '🗳️', label: 'Vote Coming Soon', shortLabel: 'Vote Soon', class: 'spotlight-compact--upcoming' },
            'just_passed': { icon: '✅', label: 'Just Passed', shortLabel: 'Passed', class: 'spotlight-compact--passed' }
        };

        // Bind methods
        this.handleResize = this.handleResize.bind(this);
        this.handleKeyboardNavigation = this.handleKeyboardNavigation.bind(this);

        // Setup resize listener
        window.addEventListener('resize', this.handleResize);
    }

    /**
     * Initialize and load spotlight data
     */
    async init() {
        await this.loadSpotlights();

        // Add keyboard navigation support
        document.addEventListener('keydown', this.handleKeyboardNavigation);
    }

    /**
     * Handle window resize
     */
    handleResize() {
        const wasMobile = this.state.isMobile;
        this.state.isMobile = window.innerWidth < 1024;

        // Re-render if crossing mobile/desktop breakpoint
        if (wasMobile !== this.state.isMobile) {
            this.render();
        }
    }

    /**
     * Keyboard navigation (arrow keys to navigate list, Enter to select)
     */
    handleKeyboardNavigation(e) {
        if (!this.state.spotlights.length || this.state.isMobile) return;

        const currentIndex = this.state.spotlights.findIndex(
            s => s.id === this.state.selectedSpotlight?.id
        );

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = Math.min(currentIndex + 1, this.state.spotlights.length - 1);
            this.selectSpotlight(this.state.spotlights[nextIndex]);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = Math.max(currentIndex - 1, 0);
            this.selectSpotlight(this.state.spotlights[prevIndex]);
        }
    }

    /**
     * Load spotlight bills from API
     */
    async loadSpotlights() {
        if (!this.container) return;

        this.state.loading = true;
        this.renderLoadingState();

        try {
            const spotlights = await congressionalDataService.getSpotlightBills({ limit: 6 });

            this.state.spotlights = spotlights;
            this.state.loading = false;
            this.state.error = null;

            // Auto-select first bill on desktop
            if (spotlights.length > 0 && !this.state.isMobile) {
                this.state.selectedSpotlight = spotlights[0];
            }

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
        this.container.className = 'spotlight-section spotlight-section--redesigned';

        // Section header
        const header = document.createElement('div');
        header.className = 'spotlight-section__header';
        header.innerHTML = `
            <h2 class="spotlight-section__title">In the News</h2>
            <p class="spotlight-section__subtitle">Legislation making headlines right now</p>
        `;
        this.container.appendChild(header);

        // Split panel container
        const splitPanel = document.createElement('div');
        splitPanel.className = `spotlight-split ${this.state.isMobile ? 'spotlight-split--mobile' : 'spotlight-split--desktop'}`;

        // List panel
        const listPanel = this.createListPanel();
        splitPanel.appendChild(listPanel);

        // Detail panel (desktop only initially)
        if (!this.state.isMobile) {
            const detailPanel = this.createDetailPanel();
            splitPanel.appendChild(detailPanel);
        }

        this.container.appendChild(splitPanel);

        // Mobile detail drawer (rendered but hidden)
        if (this.state.isMobile && this.state.selectedSpotlight) {
            const drawer = this.createMobileDetailDrawer();
            this.container.appendChild(drawer);
        }
    }

    /**
     * Create compact list panel
     */
    createListPanel() {
        const panel = document.createElement('div');
        panel.className = 'spotlight-list';

        this.state.spotlights.forEach((spotlight, index) => {
            const item = this.createCompactListItem(spotlight, index === 0);
            panel.appendChild(item);
        });

        return panel;
    }

    /**
     * Create compact list item (80-100px height)
     */
    createCompactListItem(spotlight, isFeatured = false) {
        const item = document.createElement('div');
        const category = spotlight.spotlight?.category || 'trending';
        const categoryInfo = this.categoryConfig[category] || this.categoryConfig.trending;
        const isSelected = this.state.selectedSpotlight?.id === spotlight.id;

        item.className = `spotlight-item ${categoryInfo.class} ${isFeatured ? 'spotlight-item--featured' : ''} ${isSelected ? 'spotlight-item--selected' : ''}`;
        item.dataset.billId = spotlight.id;

        // Truncate title smartly
        const truncatedTitle = this.truncateTitle(spotlight.title, isFeatured ? 120 : 80);

        item.innerHTML = `
            <div class="spotlight-item__indicator"></div>
            <div class="spotlight-item__content">
                <div class="spotlight-item__header">
                    <span class="spotlight-item__category">
                        <span class="category-icon">${categoryInfo.icon}</span>
                        <span class="category-label">${categoryInfo.shortLabel}</span>
                    </span>
                    <span class="spotlight-item__bill-number">${spotlight.type} ${spotlight.number}</span>
                </div>
                ${spotlight.spotlight?.headline && isFeatured ? `
                    <h4 class="spotlight-item__headline">${this.escapeHtml(spotlight.spotlight.headline)}</h4>
                ` : ''}
                <p class="spotlight-item__title">${this.escapeHtml(truncatedTitle)}</p>
                <div class="spotlight-item__meta">
                    <span class="spotlight-item__status">${spotlight.status || 'Introduced'}</span>
                    ${spotlight.enhancedSummary?.affectsTags?.[0] ? `
                        <span class="spotlight-item__tag">${this.escapeHtml(spotlight.enhancedSummary.affectsTags[0])}</span>
                    ` : ''}
                </div>
            </div>
        `;

        // Click handler
        item.addEventListener('click', () => {
            this.selectSpotlight(spotlight);
        });

        return item;
    }

    /**
     * Select a spotlight (update detail panel or show drawer)
     */
    selectSpotlight(spotlight) {
        this.state.selectedSpotlight = spotlight;

        if (this.state.isMobile) {
            // Show mobile drawer
            this.showMobileDetailDrawer();
        } else {
            // Update desktop detail panel
            this.updateDetailPanel();
            // Update selected state in list
            this.updateListSelection();
        }

        // Track analytics
        if (typeof analytics !== 'undefined') {
            analytics.track('spotlight_bill_selected', {
                billId: spotlight.id,
                category: spotlight.spotlight?.category,
                position: this.state.spotlights.findIndex(s => s.id === spotlight.id)
            });
        }
    }

    /**
     * Update list item selection states
     */
    updateListSelection() {
        const items = this.container.querySelectorAll('.spotlight-item');
        items.forEach(item => {
            const isSelected = item.dataset.billId === this.state.selectedSpotlight?.id;
            item.classList.toggle('spotlight-item--selected', isSelected);
        });
    }

    /**
     * Create detail panel for desktop
     */
    createDetailPanel() {
        const panel = document.createElement('div');
        panel.className = 'spotlight-detail';
        panel.id = 'spotlight-detail-panel';

        if (this.state.selectedSpotlight) {
            panel.innerHTML = this.buildDetailContent(this.state.selectedSpotlight);
            this.attachDetailEventListeners(panel);
        } else {
            panel.innerHTML = `
                <div class="spotlight-detail__empty">
                    <p>Select a bill to see details</p>
                </div>
            `;
        }

        return panel;
    }

    /**
     * Update detail panel content (desktop)
     */
    updateDetailPanel() {
        const panel = this.container.querySelector('#spotlight-detail-panel');
        if (!panel) return;

        panel.innerHTML = this.buildDetailContent(this.state.selectedSpotlight);
        this.attachDetailEventListeners(panel);

        // Smooth scroll to top of detail panel
        panel.scrollTop = 0;
    }

    /**
     * Build detail content HTML
     */
    buildDetailContent(spotlight) {
        const category = spotlight.spotlight?.category || 'trending';
        const categoryInfo = this.categoryConfig[category] || this.categoryConfig.trending;
        const debateHtml = this.buildDebateSection(spotlight.enhancedSummary?.theDebate);
        const tagsHtml = this.buildTagsSection(spotlight.enhancedSummary?.affectsTags);

        return `
            <div class="spotlight-detail__content">
                <div class="spotlight-detail__category ${categoryInfo.class}">
                    <span class="category-icon">${categoryInfo.icon}</span>
                    <span class="category-label">${categoryInfo.label}</span>
                </div>

                ${spotlight.spotlight?.headline ? `
                    <h3 class="spotlight-detail__headline">${this.escapeHtml(spotlight.spotlight.headline)}</h3>
                ` : ''}

                <div class="spotlight-detail__bill-info">
                    <span class="spotlight-detail__bill-number">${spotlight.type} ${spotlight.number}</span>
                    <span class="spotlight-detail__status spotlight-detail__status--${(spotlight.status || 'introduced').toLowerCase().replace(/\s+/g, '-')}">${spotlight.status || 'Introduced'}</span>
                </div>

                <h4 class="spotlight-detail__title">${this.escapeHtml(spotlight.title)}</h4>

                ${spotlight.enhancedSummary?.oneLiner ? `
                    <p class="spotlight-detail__one-liner">"${this.escapeHtml(spotlight.enhancedSummary.oneLiner)}"</p>
                ` : ''}

                ${spotlight.spotlight?.newsContext ? `
                    <p class="spotlight-detail__context">${this.escapeHtml(spotlight.spotlight.newsContext)}</p>
                ` : ''}

                ${debateHtml}

                ${tagsHtml}

                <div class="spotlight-detail__actions">
                    <button class="btn btn--primary btn--md spotlight-detail__learn-more" data-bill-id="${spotlight.id}">
                        Learn More
                    </button>
                    <button class="btn btn--outline btn--md spotlight-detail__follow" data-bill-id="${spotlight.id}">
                        <span class="follow-icon">☆</span> Follow
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Attach event listeners to detail panel buttons
     */
    attachDetailEventListeners(panel) {
        const learnMoreBtn = panel.querySelector('.spotlight-detail__learn-more');
        if (learnMoreBtn) {
            learnMoreBtn.addEventListener('click', () => {
                this.handleBillClick(this.state.selectedSpotlight);
            });
        }

        const followBtn = panel.querySelector('.spotlight-detail__follow');
        if (followBtn) {
            followBtn.addEventListener('click', () => {
                this.handleFollowClick(this.state.selectedSpotlight, followBtn);
            });
        }
    }

    /**
     * Create mobile detail drawer (modal-style)
     */
    createMobileDetailDrawer() {
        const drawer = document.createElement('div');
        drawer.className = 'spotlight-drawer spotlight-drawer--visible';
        drawer.id = 'spotlight-mobile-drawer';

        drawer.innerHTML = `
            <div class="spotlight-drawer__backdrop"></div>
            <div class="spotlight-drawer__panel">
                <div class="spotlight-drawer__header">
                    <button class="spotlight-drawer__close" aria-label="Close">
                        <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="spotlight-drawer__content">
                    ${this.buildDetailContent(this.state.selectedSpotlight)}
                </div>
            </div>
        `;

        // Close handlers
        const backdrop = drawer.querySelector('.spotlight-drawer__backdrop');
        const closeBtn = drawer.querySelector('.spotlight-drawer__close');

        const closeDrawer = () => this.closeMobileDetailDrawer();

        backdrop.addEventListener('click', closeDrawer);
        closeBtn.addEventListener('click', closeDrawer);

        // Attach detail event listeners
        this.attachDetailEventListeners(drawer);

        return drawer;
    }

    /**
     * Show mobile detail drawer
     */
    showMobileDetailDrawer() {
        // Remove existing drawer if present
        const existingDrawer = this.container.querySelector('#spotlight-mobile-drawer');
        if (existingDrawer) {
            existingDrawer.remove();
        }

        // Create and append new drawer
        const drawer = this.createMobileDetailDrawer();
        this.container.appendChild(drawer);

        // Lock body scroll
        document.body.style.overflow = 'hidden';

        // Animate in after a frame
        requestAnimationFrame(() => {
            drawer.classList.add('spotlight-drawer--visible');
        });
    }

    /**
     * Close mobile detail drawer
     */
    closeMobileDetailDrawer() {
        const drawer = this.container.querySelector('#spotlight-mobile-drawer');
        if (!drawer) return;

        drawer.classList.remove('spotlight-drawer--visible');

        // Remove after animation
        setTimeout(() => {
            drawer.remove();
            document.body.style.overflow = '';
            this.state.selectedSpotlight = null;
        }, 300);
    }

    /**
     * Build the debate section HTML
     */
    buildDebateSection(theDebate) {
        if (!theDebate || (!theDebate.supporters && !theDebate.critics)) {
            return '';
        }

        return `
            <div class="spotlight-detail__debate">
                <h5 class="spotlight-detail__debate-title">The Debate</h5>
                <div class="spotlight-detail__debate-content">
                    ${theDebate.supporters ? `
                        <div class="debate-side debate-side--supporters">
                            <span class="debate-label">Supporters say:</span>
                            <p class="debate-text">${this.escapeHtml(theDebate.supporters)}</p>
                        </div>
                    ` : ''}
                    ${theDebate.critics ? `
                        <div class="debate-side debate-side--critics">
                            <span class="debate-label">Critics say:</span>
                            <p class="debate-text">${this.escapeHtml(theDebate.critics)}</p>
                        </div>
                    ` : ''}
                </div>
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
            `<span class="spotlight-detail__tag">${this.escapeHtml(tag)}</span>`
        ).join('');

        return `<div class="spotlight-detail__tags">${tagHtml}</div>`;
    }

    /**
     * Truncate title intelligently
     */
    truncateTitle(title, maxLength) {
        if (!title || title.length <= maxLength) return title;

        // Try to break at word boundary
        const truncated = title.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');

        if (lastSpace > maxLength * 0.8) {
            return truncated.substring(0, lastSpace) + '...';
        }

        return truncated + '...';
    }

    /**
     * Handle bill click - emit event or call callback
     */
    handleBillClick(spotlight) {
        // Close mobile drawer if open
        if (this.state.isMobile) {
            this.closeMobileDetailDrawer();
        }

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
                button.classList.add('spotlight-detail__follow--following');
                if (icon) icon.textContent = '★';
                button.innerHTML = '<span class="follow-icon">★</span> Following';
            } else {
                button.classList.remove('spotlight-detail__follow--following');
                if (icon) icon.textContent = '☆';
                button.innerHTML = '<span class="follow-icon">☆</span> Follow';
            }

            // Emit event
            if (typeof EventBus !== 'undefined') {
                EventBus.emit(isNowFollowing ? 'bill:followed' : 'bill:unfollowed', {
                    bill: spotlight,
                    billId: spotlight.id
                });
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
                <div class="loading-skeleton" style="height: 80px; margin-bottom: 12px; border-radius: 8px;"></div>
                <div class="loading-skeleton" style="height: 80px; margin-bottom: 12px; border-radius: 8px;"></div>
                <div class="loading-skeleton" style="height: 80px; margin-bottom: 12px; border-radius: 8px;"></div>
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

    /**
     * Cleanup
     */
    destroy() {
        window.removeEventListener('resize', this.handleResize);
        document.removeEventListener('keydown', this.handleKeyboardNavigation);

        // Restore body scroll if drawer was open
        document.body.style.overflow = '';
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpotlightSectionRedesigned;
} else {
    window.SpotlightSectionRedesigned = SpotlightSectionRedesigned;
}
