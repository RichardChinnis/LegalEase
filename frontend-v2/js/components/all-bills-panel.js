/**
 * AllBillsPanel Component
 *
 * Compact sidebar panel showing all bills with:
 * - Search functionality (same API as frontend/ search)
 * - Infinite scroll for browsing
 * - Date descending sort
 * - Click to open BillDetailModal
 */

class AllBillsPanel {
    constructor(options = {}) {
        this.container = options.container;
        this.config = {
            pageSize: 20,
            debounceDelay: 400,
            minSearchLength: 2,
            apiEndpoint: '/api/db/bills',
            searchEndpoint: '/api/db/search',
            ...options.config
        };

        this.state = {
            bills: [],
            loading: false,
            loadingMore: false,
            searchQuery: '',
            isSearchMode: false,
            offset: 0,
            hasMore: true,
            error: null,
            followedBills: new Set(), // Track which bills are followed
            activeBillId: null // Track currently active/selected bill
        };

        this.elements = {};
        this.debouncedSearch = this.debounce(this.performSearch.bind(this), this.config.debounceDelay);
        this.boundHandleScroll = this.handleScroll.bind(this);
    }

    /**
     * Initialize the panel
     */
    async init() {
        if (!this.container) {
            console.error('[AllBillsPanel] No container provided');
            return;
        }

        this.render();
        this.setupEventListeners();
        this.setupGlobalListeners();
        await this.loadFollowedBills();
        await this.loadBills();
    }

    /**
     * Setup global event listeners for follow/unfollow
     */
    setupGlobalListeners() {
        if (typeof EventBus !== 'undefined') {
            EventBus.on('bill:followed', (data) => {
                const normalizedId = this.normalizeBillId(data.billId);
                this.state.followedBills.add(normalizedId);
                this.updateFollowButton(data.billId, true);
            });

            EventBus.on('bill:unfollowed', (data) => {
                const normalizedId = this.normalizeBillId(data.billId);
                this.state.followedBills.delete(normalizedId);
                this.updateFollowButton(data.billId, false);
            });

            // Listen for active bill changes to highlight in list
            if (typeof GLOBAL_EVENTS !== 'undefined') {
                EventBus.on(GLOBAL_EVENTS.BILL_ACTIVE_CHANGED, (data) => {
                    this.updateActiveBill(data.billId);
                });
            }
        }
    }

    /**
     * Update the active bill highlight
     */
    updateActiveBill(billId) {
        const normalizedId = this.normalizeBillId(billId);
        this.state.activeBillId = normalizedId;

        // Remove active class from all items
        const allItems = this.container.querySelectorAll('.all-bills-panel__item');
        allItems.forEach(item => item.classList.remove('is-active'));

        // Add active class to the matching item
        if (normalizedId) {
            const activeItem = this.container.querySelector(`.all-bills-panel__item[data-bill-id="${normalizedId}"]`);
            if (activeItem) {
                activeItem.classList.add('is-active');
            }
        }
    }

    /**
     * Normalize bill ID to uppercase for consistent comparison
     */
    normalizeBillId(billId) {
        return (billId || '').toUpperCase();
    }

    /**
     * Load user's followed bills
     */
    async loadFollowedBills() {
        const userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) return;

        try {
            const response = await fetch(`/api/db/user/${userId}/follows?follow_type=bill`);
            if (response.ok) {
                const data = await response.json();
                const follows = data.follows || [];
                // Normalize all bill IDs to uppercase for consistent comparison
                this.state.followedBills = new Set(follows.map(f => this.normalizeBillId(f.follow_target_id)));
            }
        } catch (error) {
            console.error('[AllBillsPanel] Error loading followed bills:', error);
        }
    }

    /**
     * Render the panel structure
     */
    render() {
        this.container.innerHTML = `
            <div class="all-bills-panel">
                <div class="all-bills-panel__search">
                    <input
                        type="text"
                        class="all-bills-panel__search-input"
                        placeholder="Search bills..."
                        id="all-bills-search"
                        autocomplete="off"
                    >
                </div>
                <div class="all-bills-panel__list" id="all-bills-list">
                    <div class="all-bills-panel__loading">Loading bills...</div>
                </div>
            </div>
        `;

        this.elements.searchInput = this.container.querySelector('#all-bills-search');
        this.elements.list = this.container.querySelector('#all-bills-list');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Search input
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.state.searchQuery = query;

                if (query.length >= this.config.minSearchLength) {
                    this.state.isSearchMode = true;
                    this.debouncedSearch(query);
                } else if (query.length === 0) {
                    this.state.isSearchMode = false;
                    this.resetAndLoad();
                }
            });

            this.elements.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.elements.searchInput.value = '';
                    this.state.searchQuery = '';
                    this.state.isSearchMode = false;
                    this.resetAndLoad();
                }
            });
        }

        // Infinite scroll
        if (this.elements.list) {
            this.elements.list.addEventListener('scroll', this.boundHandleScroll);
        }
    }

    /**
     * Handle scroll for infinite loading
     */
    handleScroll() {
        if (this.state.loading || this.state.loadingMore || !this.state.hasMore) return;
        if (this.state.isSearchMode) return; // Don't infinite scroll during search

        const list = this.elements.list;
        const scrollPosition = list.scrollTop + list.clientHeight;
        const scrollHeight = list.scrollHeight;
        const threshold = 100;

        if (scrollPosition >= scrollHeight - threshold) {
            this.loadMoreBills();
        }
    }

    /**
     * Load initial bills (date descending)
     */
    async loadBills() {
        this.state.loading = true;
        this.state.error = null;
        this.renderLoading();

        try {
            const response = await fetch(
                `${this.config.apiEndpoint}?limit=${this.config.pageSize}&offset=0&sort=lastActionDate&order=desc`
            );

            if (!response.ok) {
                throw new Error('Failed to load bills');
            }

            const data = await response.json();
            const bills = data.bills || data.data || [];

            this.state.bills = bills;
            this.state.offset = bills.length;
            this.state.hasMore = bills.length >= this.config.pageSize;
            this.state.loading = false;

            this.renderBillList();

        } catch (error) {
            console.error('[AllBillsPanel] Error loading bills:', error);
            this.state.error = error.message;
            this.state.loading = false;
            this.renderError();
        }
    }

    /**
     * Load more bills (infinite scroll)
     */
    async loadMoreBills() {
        if (this.state.loadingMore || !this.state.hasMore) return;

        this.state.loadingMore = true;
        this.renderLoadingMore();

        try {
            const response = await fetch(
                `${this.config.apiEndpoint}?limit=${this.config.pageSize}&offset=${this.state.offset}&sort=lastActionDate&order=desc`
            );

            if (!response.ok) {
                throw new Error('Failed to load more bills');
            }

            const data = await response.json();
            const newBills = data.bills || data.data || [];

            this.state.bills = [...this.state.bills, ...newBills];
            this.state.offset += newBills.length;
            this.state.hasMore = newBills.length >= this.config.pageSize;
            this.state.loadingMore = false;

            this.renderBillList();

        } catch (error) {
            console.error('[AllBillsPanel] Error loading more bills:', error);
            this.state.loadingMore = false;
            this.removeLoadingMore();
        }
    }

    /**
     * Perform search
     */
    async performSearch(query) {
        if (!query || query.length < this.config.minSearchLength) return;

        this.state.loading = true;
        this.state.error = null;
        this.renderLoading();

        try {
            const params = new URLSearchParams({
                q: query,
                contentTypes: 'bills',
                limit: 50,
                sortBy: 'relevance'
            });

            const response = await fetch(`${this.config.searchEndpoint}?${params}`);

            if (!response.ok) {
                throw new Error('Search failed');
            }

            const data = await response.json();
            const results = data?.data?.results || [];

            // Transform search results to bill format
            // Note: When using contentTypes=bills, all results are bills so no filter needed
            const bills = results.map(r => this.transformSearchResult(r));

            this.state.bills = bills;
            this.state.hasMore = false; // Search doesn't paginate
            this.state.loading = false;

            this.renderBillList();

        } catch (error) {
            console.error('[AllBillsPanel] Search error:', error);
            this.state.error = error.message;
            this.state.loading = false;
            this.renderError();
        }
    }

    /**
     * Transform search result to bill format
     */
    transformSearchResult(result) {
        const parts = (result.id || '').split('-');
        return {
            bill_id: result.id,
            congress_id: parts[0],
            bill_type: parts[1]?.toUpperCase(),
            bill_number: parts[2],
            title: result.title,
            latest_action_date: result.latestActionDate || result.introducedDate
        };
    }

    /**
     * Reset state and reload
     */
    async resetAndLoad() {
        this.state.bills = [];
        this.state.offset = 0;
        this.state.hasMore = true;
        this.state.isSearchMode = false;
        await this.loadBills();
    }

    /**
     * Render the bill list
     */
    renderBillList() {
        if (!this.elements.list) return;

        if (this.state.bills.length === 0) {
            this.elements.list.innerHTML = `
                <div class="all-bills-panel__empty">
                    ${this.state.isSearchMode ? 'No bills match your search' : 'No bills available'}
                </div>
            `;
            return;
        }

        const billsHTML = this.state.bills.map(bill => this.renderBillItem(bill)).join('');
        const endHTML = !this.state.hasMore && !this.state.isSearchMode
            ? '<div class="all-bills-panel__end">End of bills</div>'
            : '';

        this.elements.list.innerHTML = billsHTML + endHTML;

        // Add click handlers for bill items
        this.elements.list.querySelectorAll('.all-bills-panel__item').forEach(item => {
            // Click on item content opens detail
            const content = item.querySelector('.all-bills-panel__item-content');
            if (content) {
                content.addEventListener('click', () => {
                    const billId = item.dataset.billId;
                    if (billId) {
                        this.openBillDetail(billId);
                    }
                });
            }
        });

        // Add click handlers for follow buttons
        this.elements.list.querySelectorAll('.all-bills-panel__follow-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const billId = btn.dataset.billId;
                if (billId) {
                    this.toggleFollow(billId);
                }
            });
        });
    }

    /**
     * Render a single bill item
     */
    renderBillItem(bill) {
        const billType = (bill.bill_type || bill.type || '').toUpperCase();
        const billNumber = bill.bill_number || bill.number;
        const congressId = bill.congress_id || bill.congress || '';
        const billId = bill.bill_id || `${congressId}-${billType}-${billNumber}`;
        const title = bill.title || bill.short_title || 'Untitled';
        const displayId = congressId ? `${billType} ${billNumber} (${congressId})` : `${billType} ${billNumber}`;
        const isFollowing = this.state.followedBills.has(this.normalizeBillId(billId));
        const isActive = this.state.activeBillId === this.normalizeBillId(billId);

        return `
            <div class="all-bills-panel__item${isActive ? ' is-active' : ''}" data-bill-id="${this.escapeHtml(billId)}">
                <div class="all-bills-panel__item-content">
                    <span class="all-bills-panel__bill-id">${displayId}</span>
                    <span class="all-bills-panel__bill-title" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</span>
                </div>
                <button class="all-bills-panel__follow-btn ${isFollowing ? 'is-following' : ''}"
                        data-action="toggle-follow"
                        data-bill-id="${this.escapeHtml(billId)}"
                        title="${isFollowing ? 'Unfollow' : 'Follow'}"
                        aria-pressed="${isFollowing}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFollowing ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                </button>
            </div>
        `;
    }

    /**
     * Toggle follow for a bill
     */
    async toggleFollow(billId, bill = null) {
        let userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) {
            userId = 'user-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('congress-tracker-user-id', userId);
        }

        const normalizedId = this.normalizeBillId(billId);
        const isFollowing = this.state.followedBills.has(normalizedId);

        try {
            if (isFollowing) {
                const response = await fetch(`/api/db/user/${userId}/follow`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        follow_type: 'bill',
                        target_id: normalizedId
                    })
                });

                if (response.ok) {
                    this.state.followedBills.delete(normalizedId);
                    this.updateFollowButton(billId, false);
                    if (typeof EventBus !== 'undefined') {
                        EventBus.emit('bill:unfollowed', { billId: normalizedId });
                    }
                }
            } else {
                const response = await fetch(`/api/db/user/${userId}/follow`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        follow_type: 'bill',
                        target_id: normalizedId
                    })
                });

                if (response.ok) {
                    this.state.followedBills.add(normalizedId);
                    this.updateFollowButton(billId, true);
                    if (typeof EventBus !== 'undefined') {
                        // Find bill data if available
                        const billData = bill || this.state.bills.find(b =>
                            this.normalizeBillId(b.bill_id || `${b.congress_id || b.congress}-${(b.bill_type || b.type || '').toUpperCase()}-${b.bill_number || b.number}`) === normalizedId
                        );
                        EventBus.emit('bill:followed', {
                            billId: normalizedId,
                            bill: billData ? {
                                bill_id: normalizedId,
                                bill_type: billData.bill_type || billData.type,
                                bill_number: billData.bill_number || billData.number,
                                congress: billData.congress_id || billData.congress,
                                title: billData.title || billData.short_title
                            } : { bill_id: normalizedId }
                        });
                    }
                }
            }
        } catch (error) {
            console.error('[AllBillsPanel] Error toggling follow:', error);
        }
    }

    /**
     * Update follow button UI for a specific bill
     */
    updateFollowButton(billId, isFollowing) {
        const btn = this.elements.list?.querySelector(`[data-action="toggle-follow"][data-bill-id="${billId}"]`);
        if (btn) {
            btn.classList.toggle('is-following', isFollowing);
            btn.setAttribute('aria-pressed', isFollowing);
            btn.setAttribute('title', isFollowing ? 'Unfollow' : 'Follow');
            const svg = btn.querySelector('svg');
            if (svg) {
                svg.setAttribute('fill', isFollowing ? 'currentColor' : 'none');
            }
        }
    }

    /**
     * Open bill detail modal
     */
    openBillDetail(billId) {
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('bill:showDetail', { billId });
        } else if (window.billDetailModal) {
            window.billDetailModal.openWithBillId(billId);
        }
    }

    /**
     * Render loading state
     */
    renderLoading() {
        if (this.elements.list) {
            this.elements.list.innerHTML = `
                <div class="all-bills-panel__loading">
                    <div class="loading-spinner loading-spinner--sm"></div>
                    <span>Loading...</span>
                </div>
            `;
        }
    }

    /**
     * Render loading more indicator
     */
    renderLoadingMore() {
        if (this.elements.list) {
            const indicator = document.createElement('div');
            indicator.className = 'all-bills-panel__loading-more';
            indicator.id = 'loading-more-indicator';
            indicator.innerHTML = 'Loading more...';
            this.elements.list.appendChild(indicator);
        }
    }

    /**
     * Remove loading more indicator
     */
    removeLoadingMore() {
        const indicator = this.elements.list?.querySelector('#loading-more-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Render error state
     */
    renderError() {
        if (this.elements.list) {
            this.elements.list.innerHTML = `
                <div class="all-bills-panel__error">
                    <p>Error loading bills</p>
                    <button class="btn btn--ghost btn--sm" id="retry-bills">Retry</button>
                </div>
            `;

            const retryBtn = this.elements.list.querySelector('#retry-bills');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.resetAndLoad());
            }
        }
    }

    /**
     * Debounce utility
     */
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
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
     * Destroy the panel
     */
    destroy() {
        if (this.elements.list) {
            this.elements.list.removeEventListener('scroll', this.boundHandleScroll);
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AllBillsPanel;
} else {
    window.AllBillsPanel = AllBillsPanel;
}
