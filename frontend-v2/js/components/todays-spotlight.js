/**
 * Today's Spotlight Component
 *
 * Simple panel showing 5 spotlight bills in a non-scrolling stack.
 * Matches the AllBillsPanel structure but without search or infinite scroll.
 * Click any bill to view details in BillDetailPanel.
 */
class TodaysSpotlight {
    constructor(options = {}) {
        this.container = options.container;
        this.onBillClick = options.onBillClick || null;
        this.config = {
            limit: 5,
            apiEndpoint: '/api/db/spotlight',
            ...options.config
        };

        this.state = {
            spotlights: [],
            loading: false,
            error: null,
            activeBillId: null
        };

        this.elements = {};

        // Set up global event listeners
        this.setupGlobalListeners();
    }

    /**
     * Normalize bill ID to uppercase for consistent comparison
     */
    normalizeBillId(billId) {
        if (!billId) return null;
        return String(billId).toUpperCase();
    }

    /**
     * Set up global event listeners for cross-component communication
     */
    setupGlobalListeners() {
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

        // Remove active class from all spotlight items
        const allItems = this.container.querySelectorAll('.spotlight-panel__item');
        allItems.forEach(item => item.classList.remove('is-active'));

        // Add active class to the matching item
        if (normalizedId) {
            const activeItem = this.container.querySelector(`.spotlight-panel__item[data-bill-id="${normalizedId}"]`);
            if (activeItem) {
                activeItem.classList.add('is-active');
            }
        }
    }

    /**
     * Initialize and load spotlight data
     */
    async init() {
        if (!this.container) {
            console.error('[TodaysSpotlight] No container provided');
            return;
        }

        this.render();
        await this.loadSpotlights();
    }

    /**
     * Render the panel structure
     */
    render() {
        this.container.innerHTML = `
            <div class="spotlight-panel">
                <div class="spotlight-panel__list" id="spotlight-list">
                    <div class="spotlight-panel__loading">Loading spotlight bills...</div>
                </div>
            </div>
        `;

        this.elements.list = this.container.querySelector('#spotlight-list');
    }

    /**
     * Load spotlight bills from API
     */
    async loadSpotlights() {
        this.state.loading = true;
        this.state.error = null;
        this.renderLoading();

        try {
            // Use congressionalDataService if available, otherwise direct fetch
            let spotlights;
            if (typeof congressionalDataService !== 'undefined') {
                spotlights = await congressionalDataService.getSpotlightBills({ limit: this.config.limit });
            } else {
                const response = await fetch(`${this.config.apiEndpoint}?limit=${this.config.limit}`);
                if (!response.ok) {
                    throw new Error('Failed to load spotlight bills');
                }
                const data = await response.json();
                spotlights = data.spotlights || data.bills || data.data || [];
            }

            this.state.spotlights = spotlights;
            this.state.loading = false;

            this.renderSpotlightList();

        } catch (error) {
            console.error('[TodaysSpotlight] Error loading spotlights:', error);
            this.state.error = error.message;
            this.state.loading = false;
            this.renderError();
        }
    }

    /**
     * Render the spotlight list
     */
    renderSpotlightList() {
        if (!this.elements.list) return;

        if (this.state.spotlights.length === 0) {
            this.elements.list.innerHTML = `
                <div class="spotlight-panel__empty">
                    No spotlight bills at this time
                </div>
            `;
            return;
        }

        const billsHTML = this.state.spotlights.map(bill => this.renderBillItem(bill)).join('');
        this.elements.list.innerHTML = billsHTML;

        // Add click handlers
        this.elements.list.querySelectorAll('.spotlight-panel__item').forEach(item => {
            item.addEventListener('click', () => {
                const billId = item.dataset.billId;
                if (billId) {
                    this.openBillDetail(billId);
                }
            });
        });
    }

    /**
     * Render a single bill item
     */
    renderBillItem(bill) {
        // Handle various bill object formats
        const billType = (bill.type || bill.bill_type || bill.billType || '').toUpperCase();
        const billNumber = bill.number || bill.bill_number || bill.billNumber || '';
        const congress = bill.congress || bill.congress_id || '119';
        const rawBillId = bill.id || bill.bill_id || bill.billId || `${congress}-${billType}-${billNumber}`;
        const billId = this.normalizeBillId(rawBillId);
        const title = bill.title || bill.short_title || 'Untitled';
        const displayId = `${billType} ${billNumber}`;
        const isActive = this.state.activeBillId === billId;

        // Optional: show category badge if available
        const category = bill.spotlight?.category || bill.category;
        const categoryBadge = category ? this.getCategoryBadge(category) : '';

        return `
            <div class="spotlight-panel__item ${isActive ? 'is-active' : ''}" data-bill-id="${this.escapeHtml(billId)}">
                <div class="spotlight-panel__item-header">
                    <span class="spotlight-panel__bill-id">${displayId}</span>
                    ${categoryBadge}
                </div>
                <span class="spotlight-panel__bill-title" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</span>
            </div>
        `;
    }

    /**
     * Get category badge HTML
     */
    getCategoryBadge(category) {
        const categoryConfig = {
            'breaking': { icon: '🔴', label: 'Breaking' },
            'trending': { icon: '🔥', label: 'Trending' },
            'upcoming_vote': { icon: '🗳️', label: 'Vote Soon' },
            'just_passed': { icon: '✅', label: 'Passed' }
        };
        const cat = categoryConfig[category];
        if (!cat) return '';
        return `<span class="spotlight-panel__category" title="${cat.label}">${cat.icon}</span>`;
    }

    /**
     * Open bill detail panel
     */
    openBillDetail(billId) {
        // Call custom handler if provided
        if (this.onBillClick) {
            const bill = this.state.spotlights.find(s =>
                (s.id || s.bill_id || s.billId) === billId
            );
            if (bill) {
                this.onBillClick(bill);
            }
        }

        // Emit event for BillDetailPanel
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('bill:showDetail', { billId, context: { source: 'spotlight' } });
        }
    }

    /**
     * Render loading state
     */
    renderLoading() {
        if (this.elements.list) {
            this.elements.list.innerHTML = `
                <div class="spotlight-panel__loading">
                    <div class="loading-spinner loading-spinner--sm"></div>
                    <span>Loading...</span>
                </div>
            `;
        }
    }

    /**
     * Render error state
     */
    renderError() {
        if (this.elements.list) {
            this.elements.list.innerHTML = `
                <div class="spotlight-panel__error">
                    <p>Error loading spotlight</p>
                    <button class="btn btn--ghost btn--sm" id="retry-spotlight">Retry</button>
                </div>
            `;

            const retryBtn = this.elements.list.querySelector('#retry-spotlight');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.loadSpotlights());
            }
        }
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Refresh data
     */
    async refresh() {
        await this.loadSpotlights();
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TodaysSpotlight;
} else {
    window.TodaysSpotlight = TodaysSpotlight;
}
