/**
 * BillDetailPanel Component
 *
 * Standalone panel for viewing bill details inline (replaces modal).
 * Used as the primary bill detail display from any source:
 * - Spotlight section
 * - Rep Activity Panel
 * - All Bills Panel
 * - Following Sidebar
 *
 * Provides consistent bill exploration experience with:
 * - Bill header and status
 * - Vertical timeline
 * - Rep position callout (optional, for rep-related context)
 * - Sponsor card
 * - Summary tabs (English/Detailed/Angel/Devil/Realistic)
 * - Embedded PDF text viewer
 * - Chat panel
 */

class BillDetailPanel {
    constructor(options = {}) {
        this.container = options.container;
        this.state = {
            bill: null,
            journeyData: null,
            summaries: null,
            context: null,  // Optional: rep/activity context
            chatExpanded: false,
            loading: false,
            error: null,
            isFollowing: false,
            checkingFollowStatus: false,
            // Actions panel state
            actionsExpanded: false,
            actionsData: null,
            actionsLoading: false,
            actionsError: null,
            // Cosponsors state
            cosponsorsExpanded: false,
            cosponsorsData: null,
            cosponsorsLoading: false,
            cosponsorsError: null,
            // Chat state
            chatConversationId: null,
            chatMessages: [],
            chatInitialized: false,
            chatInitializing: false,
            chatSending: false
        };

        this.init();
    }

    /**
     * Initialize the panel
     */
    init() {
        if (!this.container) {
            console.error('[BillDetailPanel] No container provided');
            return;
        }

        this.setupGlobalListeners();
        this.showEmpty();
    }

    /**
     * Setup global event listeners
     */
    setupGlobalListeners() {
        // Listen for bill selection events from any source
        if (typeof EventBus !== 'undefined') {
            EventBus.on('bill:showDetail', (data) => {
                this.showBill(data.billId, data.context);
            });

            EventBus.on('bill:showDetailWithData', (data) => {
                this.showBillWithData(data.bill, data.journey, data.summaries, data.context);
            });

            // Listen for BILL_SELECTED events (from Tracking, Spotlight, etc.)
            if (typeof GLOBAL_EVENTS !== 'undefined') {
                EventBus.on(GLOBAL_EVENTS.BILL_SELECTED, (data) => {
                    const bill = data.bill || data;
                    const billId = bill.id || bill.bill_id || bill.billId ||
                        `${bill.congress || bill.congress_id}-${bill.type || bill.bill_type}-${bill.number || bill.bill_number}`;
                    this.showBill(billId, data.context);
                });
            }

            // Listen for follow/unfollow events to update button state
            EventBus.on('bill:followed', (data) => {
                if (this.state.bill && this.getBillId() === data.billId) {
                    this.state.isFollowing = true;
                    this.updateFollowButton(true);
                }
            });

            EventBus.on('bill:unfollowed', (data) => {
                if (this.state.bill && this.getBillId() === data.billId) {
                    this.state.isFollowing = false;
                    this.updateFollowButton(false);
                }
            });
        }
    }

    /**
     * Get bill ID in standard format
     */
    getBillId() {
        const bill = this.state.bill;
        if (!bill) return null;
        return bill.bill_id || `${bill.congress_id || bill.congress}-${(bill.bill_type || bill.type || '').toUpperCase()}-${bill.bill_number || bill.number}`;
    }

    /**
     * Check if current bill is being followed
     */
    async checkFollowStatus() {
        const billId = this.getBillId();
        if (!billId) {
            this.state.checkingFollowStatus = false;
            return;
        }

        const userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) {
            this.state.checkingFollowStatus = false;
            return;
        }

        this.state.checkingFollowStatus = true;

        try {
            const response = await fetch(`/api/db/user/${userId}/follows?follow_type=bill`);
            if (response.ok) {
                const data = await response.json();
                const follows = data.follows || [];
                // Case-insensitive comparison for bill IDs
                const normalizedBillId = billId.toUpperCase();
                const isFollowing = follows.some(f => (f.follow_target_id || '').toUpperCase() === normalizedBillId);
                this.state.isFollowing = isFollowing;
                this.state.checkingFollowStatus = false;
                this.updateFollowButton(isFollowing);
            } else {
                this.state.checkingFollowStatus = false;
            }
        } catch (error) {
            console.error('[BillDetailPanel] Error checking follow status:', error);
            this.state.checkingFollowStatus = false;
        }
    }

    /**
     * Toggle follow state for current bill
     */
    async toggleFollow() {
        const bill = this.state.bill;
        const billId = this.getBillId();
        if (!bill || !billId) return;

        // Normalize bill ID to uppercase for consistent storage and comparison
        const normalizedId = billId.toUpperCase();

        let userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) {
            userId = 'user-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('congress-tracker-user-id', userId);
        }

        try {
            if (this.state.isFollowing) {
                // Unfollow
                const response = await fetch(`/api/db/user/${userId}/follow`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        follow_type: 'bill',
                        target_id: normalizedId
                    })
                });

                if (response.ok) {
                    this.state.isFollowing = false;
                    this.updateFollowButton(false);
                    if (typeof EventBus !== 'undefined') {
                        EventBus.emit('bill:unfollowed', { billId: normalizedId });
                    }
                }
            } else {
                // Follow
                const response = await fetch(`/api/db/user/${userId}/follow`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        follow_type: 'bill',
                        target_id: normalizedId
                    })
                });

                if (response.ok) {
                    this.state.isFollowing = true;
                    this.updateFollowButton(true);
                    if (typeof EventBus !== 'undefined') {
                        EventBus.emit('bill:followed', {
                            billId: normalizedId,
                            bill: {
                                bill_id: normalizedId,
                                bill_type: bill.bill_type || bill.type,
                                bill_number: bill.bill_number || bill.number,
                                congress: bill.congress_id || bill.congress,
                                title: bill.title || bill.short_title
                            }
                        });
                    }
                }
            }
        } catch (error) {
            console.error('[BillDetailPanel] Error toggling follow:', error);
        }
    }

    /**
     * Update follow button UI
     */
    updateFollowButton(isFollowing) {
        const btn = this.container.querySelector('[data-action="toggle-follow"]');
        if (btn) {
            btn.classList.toggle('is-following', isFollowing);
            btn.setAttribute('aria-pressed', isFollowing);
            btn.setAttribute('title', isFollowing ? 'Unfollow this bill' : 'Follow this bill');

            const label = btn.querySelector('.follow-btn__label');
            if (label) {
                label.textContent = isFollowing ? 'Following' : 'Follow';
            }

            const svg = btn.querySelector('svg');
            if (svg) {
                svg.setAttribute('fill', isFollowing ? 'currentColor' : 'none');
            }
        }
    }

    /**
     * Render follow button HTML
     */
    renderFollowButton() {
        const { isFollowing, checkingFollowStatus } = this.state;

        return `
            <button class="bill-detail__follow-btn ${isFollowing ? 'is-following' : ''}"
                    data-action="toggle-follow"
                    title="${isFollowing ? 'Unfollow this bill' : 'Follow this bill'}"
                    aria-pressed="${isFollowing}"
                    ${checkingFollowStatus ? 'disabled' : ''}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFollowing ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="follow-btn__label">${isFollowing ? 'Following' : 'Follow'}</span>
            </button>
        `;
    }

    /**
     * Show bill by ID (fetches data)
     */
    async showBill(billId, context = null) {
        if (!billId) return;

        this.state.context = context;
        this.state.loading = true;
        this.state.error = null;
        // Reset actions state when loading a new bill
        this.state.actionsExpanded = false;
        this.state.actionsData = null;
        this.state.actionsLoading = false;
        this.state.actionsError = null;
        // Reset cosponsors state when loading a new bill
        this.state.cosponsorsExpanded = false;
        this.state.cosponsorsData = null;
        this.state.cosponsorsLoading = false;
        this.state.cosponsorsError = null;
        // Reset chat state when loading a new bill
        this.state.chatConversationId = null;
        this.state.chatMessages = [];
        this.state.chatInitialized = false;
        this.state.chatInitializing = false;
        this.state.chatSending = false;
        this.renderLoading();

        try {
            // Parse bill ID (format: "119-HR-1234" or "119-hr-1234")
            const parts = billId.split('-');
            let congress, billType, billNumber;

            if (parts.length >= 3) {
                congress = parts[0];
                billType = parts[1].toLowerCase();
                billNumber = parts[2];
            } else {
                throw new Error('Invalid bill ID format');
            }

            // Fetch bill details, journey, and summaries in parallel
            const [billRes, journeyRes, summaryRes] = await Promise.all([
                fetch(`/api/db/bill/${congress}/${billType}/${billNumber}`),
                fetch(`/api/db/bill/${congress}/${billType}/${billNumber}/journey`),
                fetch(`/api/db/bill/${congress}/${billType}/${billNumber}/ai-summary`)
            ]);

            let billData = null;
            let journeyData = null;
            let summaries = null;

            if (billRes.ok) {
                const data = await billRes.json();
                billData = data.bill || data;
            } else {
                throw new Error('Failed to load bill details');
            }

            if (journeyRes.ok) {
                const data = await journeyRes.json();
                journeyData = data;
            }

            if (summaryRes.ok) {
                const data = await summaryRes.json();
                summaries = data.summaries || null;
            }

            this.state.bill = billData;
            this.state.journeyData = journeyData;
            this.state.summaries = summaries;
            this.state.loading = false;

            this.render();

        } catch (error) {
            console.error('[BillDetailPanel] Error loading bill:', error);
            this.state.error = error.message;
            this.state.loading = false;
            this.renderError();
        }
    }

    /**
     * Show bill with pre-loaded data
     */
    showBillWithData(bill, journey = null, summaries = null, context = null) {
        this.state.bill = bill;
        this.state.journeyData = journey;
        this.state.summaries = summaries;
        this.state.context = context;
        this.state.loading = false;
        this.state.error = null;
        // Reset actions state when loading a new bill
        this.state.actionsExpanded = false;
        this.state.actionsData = null;
        this.state.actionsLoading = false;
        this.state.actionsError = null;
        // Reset cosponsors state when loading a new bill
        this.state.cosponsorsExpanded = false;
        this.state.cosponsorsData = null;
        this.state.cosponsorsLoading = false;
        this.state.cosponsorsError = null;
        // Reset chat state when loading a new bill
        this.state.chatConversationId = null;
        this.state.chatMessages = [];
        this.state.chatInitialized = false;
        this.state.chatInitializing = false;
        this.state.chatSending = false;

        this.render();
    }

    /**
     * Show empty state
     */
    showEmpty(message = 'Select a bill to view details') {
        this.state.bill = null;
        this.state.journeyData = null;
        this.state.summaries = null;
        this.state.context = null;

        this.container.innerHTML = `
            <div class="bill-detail-panel bill-detail-panel--empty">
                <div class="bill-detail__empty">
                    <div class="empty-icon">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                    </div>
                    <p class="empty-message">${message}</p>
                    <p class="empty-hint">Click on any bill from the sidebar or activity feed</p>
                </div>
            </div>
        `;
    }

    /**
     * Clear the panel
     */
    clear() {
        this.showEmpty();
    }

    /**
     * Main render method
     */
    render() {
        const bill = this.state.bill;
        const journey = this.state.journeyData;
        const summaries = this.state.summaries;
        const context = this.state.context;

        if (!bill) {
            this.renderError('No bill data available');
            return;
        }

        const billNumber = `${(bill.bill_type || bill.type || '').toUpperCase()} ${bill.bill_number || bill.number}`;
        const title = bill.title || bill.short_title || 'Untitled Bill';
        const status = journey?.currentStage || this.computeStatusFromAction(bill.latest_action_text || bill.latestAction?.text);

        this.container.innerHTML = `
            <div class="bill-detail-panel">
                <div class="bill-detail">
                    <!-- Bill Header -->
                    <div class="bill-detail__header">
                        <div class="bill-detail__header-left">
                            <span class="bill-detail__number">${billNumber}</span>
                            <span class="bill-detail__status bill-detail__status--${status}">${this.formatStatus(status)}</span>
                        </div>
                        <div class="bill-detail__header-right">
                            ${this.renderFollowButton()}
                        </div>
                    </div>
                    <h3 class="bill-detail__title">${this.escapeHtml(title)}</h3>

                    ${context?.rep ? this.renderRepContext(context) : ''}

                    <!-- Timeline and Summary Row -->
                    <div class="bill-detail__main-row" data-actions-expanded="${this.state.actionsExpanded}">
                        <!-- Vertical Timeline -->
                        <div class="bill-detail__timeline" id="panel-vertical-timeline">
                            ${this.renderVerticalTimeline(journey)}

                            <!-- Actions Toggle Button -->
                            <div class="bill-detail__actions-toggle-container">
                                <button class="bill-detail__actions-toggle"
                                        data-action="toggle-actions"
                                        aria-expanded="${this.state.actionsExpanded}"
                                        aria-controls="panel-actions-section">
                                    <svg class="actions-toggle__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                                        <path d="M9 14l2 2 4-4"/>
                                    </svg>
                                    <span class="actions-toggle__text">${this.state.actionsExpanded ? 'Hide History' : 'View Full History'}</span>
                                    <svg class="actions-toggle__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="9 18 15 12 9 6"></polyline>
                                    </svg>
                                </button>
                            </div>

                            ${this.renderSponsorCard(bill)}
                            ${this.renderCosponsorSection(bill)}
                        </div>

                        <!-- Actions Panel (Collapsible) -->
                        <div class="bill-detail__actions-section"
                             id="panel-actions-section"
                             aria-hidden="${!this.state.actionsExpanded}">
                            <div class="actions-panel">
                                <div class="actions-panel__header">
                                    <h4 class="actions-panel__title">Legislative History</h4>
                                    <span class="actions-panel__count" id="actions-count"></span>
                                </div>
                                <div class="actions-panel__list" id="actions-list">
                                    <div class="actions-panel__loading">Loading actions...</div>
                                </div>
                            </div>
                        </div>

                        <!-- Summary Section -->
                        <div class="bill-detail__summary" id="panel-summary-section">
                            ${this.renderSummarySection(summaries)}
                        </div>
                    </div>

                    <!-- Bill Text and Chat Row -->
                    <div class="bill-detail__text-chat-row">
                        <!-- Bill Text Section -->
                        <div class="bill-detail__text-section">
                            <div class="bill-detail__text-viewer" id="panel-bill-text-viewer">
                                <div class="bill-text-loading">Loading bill text...</div>
                            </div>
                        </div>

                        <!-- Chat Section -->
                        <div class="bill-detail__chat-section">
                            <!-- Spacer to align gold-bordered chat with PDF iframe top when version badge is present -->
                            <div class="bill-detail__chat-spacer" id="panel-chat-spacer" aria-hidden="true"></div>
                            <div class="bill-detail__chat-panel" id="panel-chat-panel">
                                <!-- Messages Container -->
                                <div class="chat-messages" id="panel-chat-messages">
                                    <div class="chat-welcome">
                                        <div class="chat-welcome__icon">&#128172;</div>
                                        <h5>Ask about this bill</h5>
                                        <p>I can explain the bill's purpose, key provisions, and potential impact.</p>
                                    </div>
                                </div>
                                <!-- Suggestions -->
                                <div class="chat-suggestions" id="panel-chat-suggestions">
                                    <button class="chat-suggestion" data-question="What does this bill actually do in plain English?">What does this bill do?</button>
                                    <button class="chat-suggestion" data-question="Who supports and who opposes this bill?">Who supports/opposes?</button>
                                    <button class="chat-suggestion" data-question="How might this bill affect everyday citizens?">How does it affect me?</button>
                                </div>
                                <!-- Input Area -->
                                <div class="chat-input-container">
                                    <textarea class="chat-input" id="panel-chat-input" placeholder="Ask a question..." rows="1"></textarea>
                                    <button class="chat-send-btn" id="panel-chat-send-btn">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.setupEventListeners();
        this.loadBillText();
        this.syncPanelHeights();
    }

    /**
     * Sync panel heights to match the timeline container
     * Makes the layout more stable by keeping heights consistent
     */
    syncPanelHeights() {
        // Use requestAnimationFrame to ensure DOM is fully rendered
        requestAnimationFrame(() => {
            const timelineContainer = this.container.querySelector('#panel-vertical-timeline');
            const summarySection = this.container.querySelector('#panel-summary-section');
            const actionsSection = this.container.querySelector('#panel-actions-section');

            if (!timelineContainer) return;

            const timelineHeight = timelineContainer.offsetHeight;

            // Sync summary section height
            if (summarySection) {
                summarySection.style.height = `${timelineHeight}px`;
            }

            // Sync actions section height (when expanded)
            if (actionsSection && this.state.actionsExpanded) {
                actionsSection.style.maxHeight = `${timelineHeight}px`;
                const actionsPanel = actionsSection.querySelector('.actions-panel');
                if (actionsPanel) {
                    actionsPanel.style.maxHeight = `${timelineHeight}px`;
                }
            }
        });
    }

    /**
     * Render rep context callout
     */
    renderRepContext(context) {
        const rep = context.rep;
        if (!rep) return '';

        const photoUrl = rep.depiction?.imageUrl || rep.photoUrl ||
            `https://bioguide.congress.gov/bioguide/photo/${(rep.bioguideId || rep.id)?.charAt(0)}/${rep.bioguideId || rep.id}.jpg`;
        const name = rep.name || rep.fullName || `${rep.firstName || ''} ${rep.lastName || ''}`.trim();
        const partyClass = this.getPartyClass(rep);

        return `
            <div class="bill-detail__rep-action ${partyClass ? `bill-detail__rep-action--${partyClass}` : ''}">
                <img class="bill-detail__rep-photo"
                     src="${photoUrl}"
                     alt="${name}"
                     onerror="this.style.display='none'">
                <span class="bill-detail__rep-name">${name}</span>
                <span class="bill-detail__rep-action-text">${this.formatRepAction(context)}</span>
                ${context.date ? `<span class="bill-detail__rep-date">${this.formatDate(context.date)}</span>` : ''}
            </div>
        `;
    }

    /**
     * Get party class for styling
     */
    getPartyClass(rep) {
        const party = (rep.partyName || rep.party || '').toLowerCase();
        if (party.includes('democrat')) return 'democrat';
        if (party.includes('republican')) return 'republican';
        if (party.includes('independent') || party === 'i') return 'independent';
        return '';
    }

    /**
     * Get party code for card styling (d, r, i)
     */
    getPartyCode(party) {
        const p = (party || '').toUpperCase();
        if (p === 'D' || p.includes('DEMOCRAT')) return 'd';
        if (p === 'R' || p.includes('REPUBLICAN')) return 'r';
        if (p === 'I' || p.includes('INDEPENDENT')) return 'i';
        return '';
    }

    /**
     * Render sponsor card (same style as rep selector cards)
     */
    renderSponsorCard(bill) {
        const sponsors = bill.sponsors || [];
        if (sponsors.length === 0) {
            return '<div class="bill-detail__sponsor-empty">No sponsor information</div>';
        }

        const sponsor = sponsors[0]; // Primary sponsor
        const bioguideId = sponsor.bioguideId;
        const photoUrl = `https://bioguide.congress.gov/bioguide/photo/${bioguideId?.charAt(0)}/${bioguideId}.jpg`;

        // Get display name - handle both API formats
        let displayName = sponsor.fullName || sponsor.name || '';
        let title = '';

        // Parse name from format: "Rep. Arrington, Jodey C. [R-TX-19]" or "Sen. Smith, John [D-CA]"
        const nameMatch = displayName.match(/^(Rep\.|Sen\.)\s+([^,]+),\s+([^\[]+)/);
        if (nameMatch) {
            title = nameMatch[1] === 'Rep.' ? 'Rep.' : 'Sen.';
            displayName = `${nameMatch[3].trim().split(' ')[0]} ${nameMatch[2]}`;
        } else if (sponsor.firstName && sponsor.lastName) {
            displayName = `${sponsor.firstName} ${sponsor.lastName}`;
            title = sponsor.district !== undefined ? 'Rep.' : 'Sen.';
        }

        const partyCode = this.getPartyCode(sponsor.party);
        const state = sponsor.state || '';
        const district = sponsor.district;
        const chamber = district !== undefined && district !== null ? 'House' : 'Senate';
        const locationText = chamber === 'House' ? `${partyCode.toUpperCase()}-${state}-${district}` : `${partyCode.toUpperCase()}-${state}`;

        return `
            <div class="bill-detail__sponsor-section">
                <div class="sponsor-card sponsor-card--${partyCode}">
                    <div class="sponsor-card__party-indicator"></div>
                    <img class="sponsor-card__photo"
                         src="${photoUrl}"
                         alt="${displayName}"
                         onerror="this.style.display='none'">
                    <div class="sponsor-card__info">
                        <span class="sponsor-card__name">${title}<br>${this.escapeHtml(displayName)}</span>
                        <span class="sponsor-card__party">${locationText}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render cosponsor expandable section
     */
    renderCosponsorSection(bill) {
        const count = bill.cosponsors?.count || bill.cosponsorsCount || 0;
        if (count === 0) return '';

        return `
            <div class="bill-detail__cosponsor-section">
                <button class="cosponsor-toggle"
                        data-action="toggle-cosponsors"
                        aria-expanded="${this.state.cosponsorsExpanded}"
                        aria-controls="panel-cosponsor-list">
                    <span class="cosponsor-toggle__text">Cosponsors (${count})</span>
                    <svg class="cosponsor-toggle__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                <div class="cosponsor-list-container"
                     id="panel-cosponsor-list"
                     aria-hidden="${!this.state.cosponsorsExpanded}">
                    ${this.state.cosponsorsData ? this.renderCosponsorList(this.state.cosponsorsData) : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render the cosponsor list items
     */
    renderCosponsorList(cosponsors) {
        if (cosponsors.length === 0) {
            return '<div class="cosponsor-list__empty">No cosponsors found</div>';
        }

        const items = cosponsors.map(cs => {
            const name = (cs.firstName && cs.lastName) ? `${cs.firstName} ${cs.lastName}` : (cs.fullName || '').replace(/\s*\[.*?\]\s*$/, '');
            const partyCode = this.getPartyCode(cs.party);
            const state = cs.state || '';
            const district = cs.district;
            const title = district !== undefined && district !== null ? 'Rep.' : 'Sen.';
            const location = district !== undefined && district !== null
                ? `${partyCode.toUpperCase()}-${state}-${district}`
                : `${partyCode.toUpperCase()}-${state}`;

            return `<li class="cosponsor-list__item">
                <span class="cosponsor-list__name cosponsor-list__party--${partyCode}">${title} ${this.escapeHtml(name)}</span>
                <span class="cosponsor-list__location"> (${this.escapeHtml(location)})</span>
            </li>`;
        }).join('');

        return `<ul class="cosponsor-list">${items}</ul>`;
    }

    /**
     * Render vertical timeline
     * Uses journey stages if available, otherwise falls back to default stages
     */
    renderVerticalTimeline(journey) {
        // If journey has detailed stages array, use it
        if (journey?.stages && Array.isArray(journey.stages)) {
            return this.renderJourneyStages(journey.stages, journey.currentStage);
        }

        // Fallback: map currentStage to a standard timeline
        const stages = [
            { id: 'introduced', label: 'Introduced' },
            { id: 'in_committee', label: 'In Committee' },
            { id: 'reported', label: 'Reported' },
            { id: 'passed_origin', label: 'Passed Chamber' },
            { id: 'in_other_chamber', label: 'Other Chamber' },
            { id: 'passed_both', label: 'Passed Congress' },
            { id: 'to_president', label: 'To President' },
            { id: 'became_law', label: 'Became Law' }
        ];

        const currentStage = this.normalizeStage(journey?.currentStage || 'introduced');
        const currentIndex = stages.findIndex(s => s.id === currentStage);
        const effectiveIndex = currentIndex >= 0 ? currentIndex : this.getStagePosition(currentStage, stages.length);

        // Get stage dates if available from journey
        const stageDates = journey?.stageDates || {};

        return `
            <div class="vertical-timeline">
                ${stages.map((stage, index) => {
                    const isPast = index < effectiveIndex;
                    const isCurrent = index === effectiveIndex || stage.id === currentStage;

                    let stateClass = 'future';
                    if (isPast) stateClass = 'completed';
                    if (isCurrent) stateClass = 'current';

                    // Handle terminal negative states
                    if (currentStage === 'vetoed' || currentStage === 'failed') {
                        if (index > effectiveIndex) stateClass = 'blocked';
                    }

                    // Get date for this stage if completed or current
                    const stageDate = stageDates[stage.id];
                    const dateStr = this.formatStageDate(stageDate, stateClass === 'completed' ? 'complete' : stateClass);

                    return `
                        <div class="vertical-timeline__stage vertical-timeline__stage--${stateClass}">
                            <div class="vertical-timeline__dot"></div>
                            <div class="vertical-timeline__line"></div>
                            <div class="vertical-timeline__label">
                                <span class="vertical-timeline__stage-name">${stage.label}</span>
                                ${dateStr ? `<span class="vertical-timeline__stage-date">${dateStr}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    /**
     * Render timeline from journey stages array
     */
    renderJourneyStages(stages, currentStage) {
        return `
            <div class="vertical-timeline">
                ${stages.map((stage) => {
                    let stateClass = stage.status || 'pending';
                    if (stateClass === 'complete') stateClass = 'completed';

                    // Format date as (m/yy) for completed or current stages
                    const dateStr = this.formatStageDate(stage.date, stage.status);

                    return `
                        <div class="vertical-timeline__stage vertical-timeline__stage--${stateClass}">
                            <div class="vertical-timeline__dot"></div>
                            <div class="vertical-timeline__line"></div>
                            <div class="vertical-timeline__label">
                                <span class="vertical-timeline__stage-name">${stage.label || stage.shortLabel}</span>
                                ${dateStr ? `<span class="vertical-timeline__stage-date">${dateStr}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    /**
     * Format stage date as (m/yy) for display
     * Shows for completed, current, or failed stages with dates
     */
    formatStageDate(dateStr, status) {
        if (!dateStr) return '';
        // Show dates for completed, current, and failed stages
        const validStatuses = ['complete', 'completed', 'current', 'failed'];
        if (!validStatuses.includes(status)) return '';

        try {
            const date = new Date(dateStr);
            const month = date.getMonth() + 1; // 0-indexed
            const year = date.getFullYear().toString().slice(-2);
            return `(${month}/${year})`;
        } catch (e) {
            return '';
        }
    }

    /**
     * Normalize stage name to match timeline IDs
     */
    normalizeStage(stage) {
        const mapping = {
            'passed_one_chamber': 'passed_origin',
            'passed_both_chambers': 'passed_both',
            'resolving_differences': 'passed_both'
        };
        return mapping[stage] || stage;
    }

    /**
     * Get approximate position for stages not in the standard list
     */
    getStagePosition(stage, totalStages) {
        const positions = {
            'vetoed': 6,
            'veto_overridden': 7,
            'failed': 3,
            'resolving_differences': 5
        };
        return positions[stage] || 0;
    }

    /**
     * Render summary section with tabs
     */
    renderSummarySection(summaries) {
        if (!summaries || (Array.isArray(summaries) && summaries.length === 0)) {
            return `
                <div class="summary-pending">
                    <p>AI summaries pending</p>
                    <p class="summary-pending__subtext">Summaries are generated automatically</p>
                </div>
            `;
        }

        const getSummary = (type) => {
            if (Array.isArray(summaries)) {
                const s = summaries.find(s => s.summary_type === type || s.summaryType === type);
                return s?.content || null;
            }
            return summaries[type] || null;
        };

        const simple = getSummary('simple');
        const short = getSummary('short');
        const optimistic = getSummary('optimistic');
        const cynical = getSummary('cynical');
        const realistic = getSummary('realistic');

        // Determine which tab should be active (prefer simple if available, otherwise short)
        const defaultTab = simple ? 'simple' : 'short';

        return `
            <div class="summary-tabs">
                <div class="summary-tabs__nav">
                    <button class="summary-tab ${defaultTab === 'simple' ? 'summary-tab--active' : ''}" data-tab="simple" title="Plain language summary anyone can understand">English</button>
                    <button class="summary-tab ${defaultTab === 'short' ? 'summary-tab--active' : ''}" data-tab="short" title="Detailed policy summary">Detailed</button>
                    <button class="summary-tab" data-tab="optimistic" title="Optimistic take on this bill">Angel</button>
                    <button class="summary-tab" data-tab="cynical" title="Critical take on this bill">Devil</button>
                    <button class="summary-tab" data-tab="realistic" title="Balanced, realistic take on this bill">Realistic</button>
                    <span class="ai-badge" title="AI-generated content">
                        <svg class="ai-badge__icon" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0 Q6 6 0 8 Q6 10 8 16 Q10 10 16 8 Q10 6 8 0Z"/>
                        </svg>
                        <span class="ai-badge__text">AI</span>
                    </span>
                </div>
                <div class="summary-tabs__content">
                    <div class="summary-content ${defaultTab === 'simple' ? 'summary-content--active' : ''}" data-content="simple">
                        ${simple ? this.formatSummaryText(simple) : '<p class="summary-empty">Plain English summary coming soon</p>'}
                    </div>
                    <div class="summary-content ${defaultTab === 'short' ? 'summary-content--active' : ''}" data-content="short">
                        ${short ? this.formatSummaryText(short) : '<p class="summary-empty">No detailed summary available</p>'}
                    </div>
                    <div class="summary-content" data-content="optimistic">
                        ${optimistic ? this.formatSummaryText(optimistic) : '<p class="summary-empty">No optimistic take available</p>'}
                    </div>
                    <div class="summary-content" data-content="cynical">
                        ${cynical ? this.formatSummaryText(cynical) : '<p class="summary-empty">No critical take available</p>'}
                    </div>
                    <div class="summary-content" data-content="realistic">
                        ${realistic ? this.formatSummaryText(realistic) : '<p class="summary-empty">No realistic take available</p>'}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Setup event listeners for the panel content
     */
    setupEventListeners() {
        // Follow button
        const followBtn = this.container.querySelector('[data-action="toggle-follow"]');
        if (followBtn) {
            followBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleFollow();
            });
        }

        // Check follow status after setting up listeners
        this.checkFollowStatus();

        // Actions toggle button
        const actionsToggle = this.container.querySelector('[data-action="toggle-actions"]');
        if (actionsToggle) {
            actionsToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleActionsPanel();
            });
        }

        // Cosponsors toggle button
        const cosponsorsToggle = this.container.querySelector('[data-action="toggle-cosponsors"]');
        if (cosponsorsToggle) {
            cosponsorsToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleCosponsorsSection();
            });
        }

        // Retry actions loading
        this.container.addEventListener('click', (e) => {
            if (e.target.matches('[data-action="retry-actions"]')) {
                e.preventDefault();
                this.loadActions();
            }
        });

        // Committee link clicks (for future: open committee details)
        this.container.addEventListener('click', (e) => {
            const committeeLink = e.target.closest('[data-committee-code]');
            if (committeeLink) {
                e.preventDefault();
                const code = committeeLink.dataset.committeeCode;
                console.log('[BillDetailPanel] Committee clicked:', code);
                // Future: emit event or navigate to committee details
            }
        });

        // Congressional Record page link clicks
        this.container.addEventListener('click', (e) => {
            const crLink = e.target.closest('.cr-page-link');
            if (crLink) {
                e.preventDefault();
                const pageRef = crLink.dataset.pageRef;
                const congress = crLink.dataset.congress || this.state.bill?.congress_id;
                const billTitle = crLink.dataset.billTitle || this.state.bill?.title;

                if (pageRef && window.crPageViewer) {
                    window.crPageViewer.open(pageRef, congress, billTitle);
                } else {
                    console.warn('[BillDetailPanel] CR page viewer not available or missing pageRef');
                }
            }
        });

        // Summary tab switching
        this.container.querySelectorAll('.summary-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;

                this.container.querySelectorAll('.summary-tab').forEach(t => t.classList.remove('summary-tab--active'));
                tab.classList.add('summary-tab--active');

                this.container.querySelectorAll('.summary-content').forEach(c => c.classList.remove('summary-content--active'));
                const contentEl = this.container.querySelector(`.summary-content[data-content="${tabId}"]`);
                if (contentEl) contentEl.classList.add('summary-content--active');
            });
        });

        // Chat suggestions
        this.container.querySelectorAll('.chat-suggestion').forEach(btn => {
            btn.addEventListener('click', () => {
                const question = btn.dataset.question;
                const input = this.container.querySelector('#panel-chat-input');
                if (input) {
                    input.value = question;
                    this.autoResizeTextarea(input);
                }
            });
        });

        // Auto-resize chat textarea
        const chatInput = this.container.querySelector('#panel-chat-input');
        if (chatInput) {
            chatInput.addEventListener('input', () => {
                this.autoResizeTextarea(chatInput);
            });

            // Send on Enter (without Shift)
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }

        // Send button click
        const sendBtn = this.container.querySelector('#panel-chat-send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendChatMessage());
        }
    }

    /**
     * Auto-resize textarea to fit content
     */
    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        const newHeight = Math.min(textarea.scrollHeight, 100);
        textarea.style.height = newHeight + 'px';
    }

    // ========== CHAT METHODS ==========

    /**
     * Initialize chat conversation with the API
     */
    async initializeChatConversation() {
        // Guard against duplicate initialization
        if (this.state.chatInitialized || this.state.chatInitializing) {
            return;
        }

        // Check if chatAPI is available
        if (!window.chatAPI) {
            console.error('[BillDetailPanel] Chat API not available');
            this.showChatError('Chat service unavailable. Please refresh the page.');
            return;
        }

        const bill = this.state.bill;
        if (!bill) {
            console.error('[BillDetailPanel] No bill loaded for chat');
            return;
        }

        this.state.chatInitializing = true;
        this.setChatInputEnabled(false);

        try {
            // Build bill info object
            const billInfo = {
                type: (bill.bill_type || bill.type || '').toLowerCase(),
                number: String(bill.bill_number || bill.number),
                congress: bill.congress_id || bill.congress,
                title: bill.title || bill.short_title || ''
            };

            // Context config - include bill text for meaningful responses
            const contextConfig = {
                billTextVersion: 'latest',  // Include bill text for context
                summaryVersion: 'latest',
                includeSponsor: true,
                includeCosponsors: false,
                includeCommitteeReports: false
            };

            console.log('[BillDetailPanel] Creating chat conversation for bill:', billInfo);

            // Create conversation with Gemini Flash
            const conversation = await window.chatAPI.createConversation(
                billInfo,
                contextConfig,
                'gemini',
                'gemini-flash-latest'
            );

            this.state.chatConversationId = conversation.conversationId;
            this.state.chatInitialized = true;
            this.state.chatInitializing = false;

            console.log('[BillDetailPanel] Chat conversation created:', conversation.conversationId);

            this.setChatInputEnabled(true);

        } catch (error) {
            console.error('[BillDetailPanel] Failed to initialize chat:', error);
            this.state.chatInitializing = false;
            this.showChatError('Could not start chat. Please try again.');
            this.setChatInputEnabled(true);
        }
    }

    /**
     * Send a chat message
     */
    async sendChatMessage() {
        console.log('[BillDetailPanel] sendChatMessage called');

        const input = this.container.querySelector('#panel-chat-input');
        if (!input) {
            console.log('[BillDetailPanel] No input element found');
            return;
        }

        const message = input.value.trim();
        console.log('[BillDetailPanel] Message to send:', message);
        if (!message) {
            console.log('[BillDetailPanel] Message is empty, returning');
            return;
        }

        // Initialize conversation if needed (lazy init)
        if (!this.state.chatConversationId) {
            await this.initializeChatConversation();
            if (!this.state.chatConversationId) {
                return; // Initialization failed
            }
        }

        // Clear input and disable
        input.value = '';
        this.autoResizeTextarea(input);
        input.focus(); // Focus immediately so input is in view before async work
        this.setChatInputEnabled(false);
        this.state.chatSending = true;

        // Remove welcome message if present
        const welcome = this.container.querySelector('.chat-welcome');
        if (welcome) {
            welcome.remove();
        }

        // Hide suggestions after first message
        const suggestions = this.container.querySelector('#panel-chat-suggestions');
        if (suggestions) {
            suggestions.style.display = 'none';
        }

        // Add user message to UI
        this.addChatMessage('user', message);

        // Show typing indicator
        const typingIndicator = this.showTypingIndicator();

        try {
            console.log('[BillDetailPanel] Calling streamMessage with conversationId:', this.state.chatConversationId);
            // Get streaming response
            const stream = await window.chatAPI.streamMessage(
                this.state.chatConversationId,
                message
            );
            console.log('[BillDetailPanel] Got stream:', stream);

            // Remove typing indicator
            if (typingIndicator) {
                typingIndicator.remove();
            }

            // Handle the stream
            console.log('[BillDetailPanel] Calling handleChatStream');
            await this.handleChatStream(stream);
            console.log('[BillDetailPanel] handleChatStream completed');

        } catch (error) {
            console.error('[BillDetailPanel] Chat error:', error);

            // Remove typing indicator
            if (typingIndicator) {
                typingIndicator.remove();
            }

            // Show error message
            this.addChatMessage('assistant', `I'm sorry, I encountered an error: ${error.message}`, true);
        } finally {
            this.state.chatSending = false;
            this.setChatInputEnabled(true);
            input.focus({ preventScroll: true });
        }
    }

    /**
     * Handle streaming response from the API
     */
    async handleChatStream(stream) {
        console.log('[BillDetailPanel] handleChatStream started');

        // Create assistant message placeholder
        const assistantEl = this.addChatMessage('assistant', '');
        const contentEl = assistantEl.querySelector('.message-content');
        console.log('[BillDetailPanel] Created assistant message element:', assistantEl);

        let fullContent = '';
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        console.log('[BillDetailPanel] Got reader, starting to read stream');

        try {
            while (true) {
                const { value, done } = await reader.read();
                console.log('[BillDetailPanel] Stream read:', { done, valueLength: value?.length });

                if (done) {
                    // Process any remaining buffer
                    if (buffer) {
                        this.processSSEChunk(buffer, (chunk) => {
                            fullContent += chunk;
                        });
                    }
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Split on double newlines (SSE format)
                const lines = buffer.split('\n\n');
                buffer = lines.pop(); // Keep incomplete chunk

                for (const line of lines) {
                    this.processSSEChunk(line, (chunk) => {
                        fullContent += chunk;

                        // Render with markdown if available
                        if (window.marked) {
                            contentEl.innerHTML = Sanitize.markdown(fullContent);
                        } else {
                            contentEl.textContent = fullContent;
                        }

                        this.scrollChatToBottom();
                    });
                }
            }

            // Final render
            if (window.marked) {
                contentEl.innerHTML = Sanitize.markdown(fullContent);
            } else {
                contentEl.textContent = fullContent;
            }
            this.scrollChatToBottom();

            // Store message
            this.state.chatMessages.push({ role: 'assistant', content: fullContent });

        } catch (error) {
            console.error('[BillDetailPanel] Stream error:', error);
            contentEl.innerHTML = fullContent + '<br><br><em style="color: #991b1b;">[Error processing response]</em>';
        }
    }

    /**
     * Process an SSE chunk
     */
    processSSEChunk(sseLine, onContent) {
        if (!sseLine.startsWith('data: ')) return;

        try {
            const data = JSON.parse(sseLine.substring(6));

            if (data.type === 'content' && data.content) {
                onContent(data.content);
            } else if (data.type === 'error') {
                onContent(`\n\n[Error: ${data.error}]`);
            }
            // Ignore 'start' and 'done' types - handled by stream completion
        } catch (e) {
            // Ignore JSON parse errors (partial data, etc.)
        }
    }

    /**
     * Add a message to the chat UI
     */
    addChatMessage(role, content, isError = false) {
        const messagesContainer = this.container.querySelector('#panel-chat-messages');
        if (!messagesContainer) return null;

        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${role}${isError ? ' error' : ''}`;

        // Escape HTML for user messages, allow rendering for assistant
        const displayContent = role === 'user' ? this.escapeHtml(content) : content;

        messageEl.innerHTML = `<div class="message-content">${displayContent}</div>`;
        messagesContainer.appendChild(messageEl);
        this.scrollChatToBottom();

        // Store in state (raw content)
        if (content) {
            this.state.chatMessages.push({ role, content });
        }

        return messageEl;
    }

    /**
     * Show typing indicator
     */
    showTypingIndicator() {
        const messagesContainer = this.container.querySelector('#panel-chat-messages');
        if (!messagesContainer) return null;

        const typingEl = document.createElement('div');
        typingEl.className = 'chat-typing';
        typingEl.innerHTML = '<span></span><span></span><span></span>';
        messagesContainer.appendChild(typingEl);
        this.scrollChatToBottom();

        return typingEl;
    }

    /**
     * Show chat error message
     */
    showChatError(message) {
        const messagesContainer = this.container.querySelector('#panel-chat-messages');
        if (!messagesContainer) return;

        // Remove welcome if present
        const welcome = messagesContainer.querySelector('.chat-welcome');
        if (welcome) {
            welcome.remove();
        }

        const errorEl = document.createElement('div');
        errorEl.className = 'chat-message assistant error';
        errorEl.innerHTML = `<div class="message-content">${this.escapeHtml(message)}</div>`;
        messagesContainer.appendChild(errorEl);
        this.scrollChatToBottom();
    }

    /**
     * Enable/disable chat input
     */
    setChatInputEnabled(enabled) {
        const input = this.container.querySelector('#panel-chat-input');
        const sendBtn = this.container.querySelector('#panel-chat-send-btn');

        if (input) {
            input.disabled = !enabled;
            input.placeholder = enabled ? 'Ask a question...' : 'Please wait...';
        }

        if (sendBtn) {
            sendBtn.disabled = !enabled;
        }
    }

    /**
     * Scroll chat messages to bottom
     */
    scrollChatToBottom() {
        const messagesContainer = this.container.querySelector('#panel-chat-messages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    /**
     * Reset chat state (called when bill changes)
     */
    resetChat() {
        this.state.chatConversationId = null;
        this.state.chatMessages = [];
        this.state.chatInitialized = false;
        this.state.chatInitializing = false;
        this.state.chatSending = false;

        // Reset UI if container exists
        const messagesContainer = this.container.querySelector('#panel-chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="chat-welcome">
                    <div class="chat-welcome__icon">&#128172;</div>
                    <h5>Ask about this bill</h5>
                    <p>I can explain the bill's purpose, key provisions, and potential impact.</p>
                </div>
            `;
        }

        // Show suggestions again
        const suggestions = this.container.querySelector('#panel-chat-suggestions');
        if (suggestions) {
            suggestions.style.display = '';
        }

        this.setChatInputEnabled(true);
    }

    /**
     * Load bill text PDF
     */
    async loadBillText() {
        const bill = this.state.bill;
        if (!bill) return;

        const viewer = this.container.querySelector('#panel-bill-text-viewer');
        if (!viewer) return;

        try {
            const congress = bill.congress_id || bill.congress;
            const type = (bill.bill_type || bill.type || '').toLowerCase();
            const number = bill.bill_number || bill.number;

            const response = await fetch(`/api/db/bill/${congress}/${type}/${number}/text`);

            if (!response.ok) {
                throw new Error('Bill text not available');
            }

            const data = await response.json();
            const textVersions = data.textVersions || [];

            if (textVersions.length === 0) {
                throw new Error('No text versions available');
            }

            const latestVersion = textVersions[0];
            const formats = latestVersion.formats || [];
            const pdfFormat = formats.find(f => f.type === 'PDF');

            if (!pdfFormat) {
                throw new Error('No PDF version available');
            }

            const proxyUrl = `/api/pdf-content?url=${encodeURIComponent(pdfFormat.url)}#navpanes=0&view=FitH`;

            viewer.innerHTML = `
                <div class="bill-text-pdf-container">
                    ${textVersions.length > 1 ? `
                        <div class="bill-text-version-badge">
                            <select class="version-selector" id="panel-version-selector">
                                ${textVersions.map((v, i) => {
                                    const vPdf = v.formats?.find(f => f.type === 'PDF');
                                    return vPdf ? `<option value="${vPdf.url}" ${i === 0 ? 'selected' : ''}>${v.type}</option>` : '';
                                }).join('')}
                            </select>
                        </div>
                    ` : ''}
                    <iframe
                        class="bill-text-pdf-viewer"
                        src="${proxyUrl}"
                        title="Bill Text PDF"
                        frameborder="0"
                    ></iframe>
                </div>
            `;

            // Version selector change handler
            const selector = viewer.querySelector('#panel-version-selector');
            if (selector) {
                selector.addEventListener('change', (e) => {
                    const iframe = viewer.querySelector('.bill-text-pdf-viewer');
                    const newUrl = e.target.value;
                    if (iframe) {
                        iframe.src = `/api/pdf-content?url=${encodeURIComponent(newUrl)}#navpanes=0&view=FitH`;
                    }
                });
            }

            this.syncChatSpacerToBadge();

        } catch (error) {
            const congress = bill.congress_id || bill.congress;
            const type = (bill.bill_type || bill.type || '').toLowerCase();
            const number = bill.bill_number || bill.number;

            viewer.innerHTML = `
                <div class="bill-text-error">
                    <p>Bill text not yet available</p>
                    <a href="https://www.congress.gov/bill/${congress}th-congress/${type}-bill/${number}/text"
                       target="_blank" rel="noopener">
                       Check Congress.gov &#8599;
                    </a>
                </div>
            `;
            this.syncChatSpacerToBadge();
        }
    }

    syncChatSpacerToBadge() {
        const badge = this.container.querySelector('#panel-bill-text-viewer .bill-text-version-badge');
        const spacer = this.container.querySelector('#panel-chat-spacer');
        if (!spacer) return;
        spacer.style.height = badge ? `${badge.offsetHeight}px` : '0px';
    }

    /**
     * Render loading state
     */
    renderLoading() {
        this.container.innerHTML = `
            <div class="bill-detail-panel bill-detail-panel--loading">
                <div class="bill-detail__loading">
                    <div class="loading-spinner"></div>
                    <p>Loading bill details...</p>
                </div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    renderError(message = 'Failed to load bill details') {
        this.container.innerHTML = `
            <div class="bill-detail-panel bill-detail-panel--error">
                <div class="bill-detail__error">
                    <p>Error loading bill</p>
                    <p class="error-message">${this.escapeHtml(message)}</p>
                </div>
            </div>
        `;
    }

    // ========== UTILITY METHODS ==========

    computeStatusFromAction(actionText) {
        if (!actionText) return 'introduced';
        const text = actionText.toLowerCase();

        if (text.includes('became public law') || text.includes('signed by president')) {
            return 'became_law';
        } else if (text.includes('vetoed')) {
            return 'vetoed';
        } else if (text.includes('presented to president')) {
            return 'to_president';
        } else if (text.includes('passed house') && text.includes('passed senate')) {
            return 'passed_both_chambers';
        } else if (text.includes('passed house') || text.includes('passed senate')) {
            return 'passed_one_chamber';
        } else if (text.includes('committee') || text.includes('referred to')) {
            return 'in_committee';
        }

        return 'introduced';
    }

    formatStatus(status) {
        const labels = {
            'introduced': 'Introduced',
            'in_committee': 'In Committee',
            'reported': 'Reported',
            'passed_one_chamber': 'Passed Chamber',
            'passed_origin': 'Passed Chamber',
            'in_other_chamber': 'Other Chamber',
            'passed_both_chambers': 'Passed Congress',
            'passed_both': 'Passed Congress',
            'resolving_differences': 'Conference',
            'to_president': 'To President',
            'became_law': 'Became Law',
            'vetoed': 'Vetoed',
            'veto_overridden': 'Veto Overridden',
            'failed': 'Failed'
        };
        return labels[status] || this.formatUnknownStatus(status);
    }

    formatUnknownStatus(status) {
        if (!status) return 'Unknown';
        return status
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    formatRepAction(context) {
        const type = context.type || context.activityType;
        switch (type) {
            case 'vote':
                return `voted ${context.votePosition?.toUpperCase() || 'on this bill'}`;
            case 'sponsored':
                return 'sponsored this bill';
            case 'cosponsored':
                return 'cosponsored this bill';
            default:
                return context.description || '';
        }
    }

    formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Format action text with clickable CR page links
     * @param {string} text - Action text
     * @returns {string} Formatted HTML with CR links
     */
    formatActionText(text) {
        if (!text) return '';

        // Congress.gov API action text may contain trusted HTML links (e.g., discharge petitions)
        // Sanitize to allow only safe <a> tags, remove any other HTML
        let formatted = this.sanitizeActionHtml(text);

        // If CR link parser is available, enhance with clickable links for CR references
        if (window.CRLinkParser) {
            const congress = this.state.bill?.congress_id;
            const billTitle = this.state.bill?.title;
            formatted = window.CRLinkParser.enhanceTextWithLinks(formatted, congress, billTitle);
        }

        return formatted;
    }

    /**
     * Sanitize HTML to allow only safe <a> tags from trusted Congress.gov data
     * @param {string} html - Raw HTML string
     * @returns {string} Sanitized HTML with only safe <a> tags preserved
     */
    sanitizeActionHtml(html) {
        if (!html) return '';

        // Create a temporary element to parse the HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Process all elements
        const processNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return document.createTextNode(node.textContent);
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                // Only allow <a> tags with href
                if (node.tagName === 'A' && node.hasAttribute('href')) {
                    const safe = document.createElement('a');
                    const href = node.getAttribute('href');
                    // Only allow http/https links
                    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                        safe.href = href;
                        safe.target = '_blank';
                        safe.rel = 'noopener noreferrer';
                        safe.className = 'action-external-link';
                        // Process children
                        for (const child of node.childNodes) {
                            const processed = processNode(child);
                            if (processed) safe.appendChild(processed);
                        }
                        return safe;
                    }
                }

                // For other elements, just process their text content
                const fragment = document.createDocumentFragment();
                for (const child of node.childNodes) {
                    const processed = processNode(child);
                    if (processed) fragment.appendChild(processed);
                }
                return fragment;
            }

            return null;
        };

        const result = document.createElement('div');
        for (const child of temp.childNodes) {
            const processed = processNode(child);
            if (processed) result.appendChild(processed);
        }

        return result.innerHTML;
    }

    formatSummaryText(text) {
        if (!text) return '';

        // First escape HTML to prevent XSS
        let formatted = this.escapeHtml(text);

        // Convert markdown headings to styled text
        formatted = formatted.replace(/^#\s+(.+)$/gm, '<strong class="summary-heading">$1</strong>');

        // Convert **bold** to <strong>
        formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Convert paragraphs (double newline) to proper paragraph breaks
        formatted = formatted.replace(/\n\n+/g, '</p><p>');

        // Convert single newlines to line breaks
        formatted = formatted.replace(/\n/g, '<br>');

        // Wrap in paragraph tags
        formatted = '<p>' + formatted + '</p>';

        // Clean up empty paragraphs
        formatted = formatted.replace(/<p>\s*<\/p>/g, '');

        return formatted;
    }

    // ========== ACTIONS PANEL METHODS ==========

    /**
     * Toggle the actions panel visibility
     */
    async toggleActionsPanel() {
        this.state.actionsExpanded = !this.state.actionsExpanded;

        const mainRow = this.container.querySelector('.bill-detail__main-row');
        const toggleBtn = this.container.querySelector('[data-action="toggle-actions"]');
        const actionsSection = this.container.querySelector('#panel-actions-section');

        if (mainRow) {
            mainRow.setAttribute('data-actions-expanded', this.state.actionsExpanded);
        }

        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', this.state.actionsExpanded);
            const textSpan = toggleBtn.querySelector('.actions-toggle__text');
            if (textSpan) {
                textSpan.textContent = this.state.actionsExpanded ? 'Hide History' : 'View Full History';
            }
        }

        if (actionsSection) {
            actionsSection.setAttribute('aria-hidden', !this.state.actionsExpanded);

            if (!this.state.actionsExpanded) {
                // Clear inline styles when collapsing
                actionsSection.style.maxHeight = '';
                const actionsPanel = actionsSection.querySelector('.actions-panel');
                if (actionsPanel) {
                    actionsPanel.style.maxHeight = '';
                }
            }
        }

        // Sync heights (will set actions panel height if expanded)
        this.syncPanelHeights();

        // Load actions data if expanding and not already loaded
        if (this.state.actionsExpanded && !this.state.actionsData) {
            await this.loadActions();
        }
    }

    /**
     * Toggle cosponsors section visibility
     */
    async toggleCosponsorsSection() {
        this.state.cosponsorsExpanded = !this.state.cosponsorsExpanded;

        const toggleBtn = this.container.querySelector('[data-action="toggle-cosponsors"]');
        const listContainer = this.container.querySelector('#panel-cosponsor-list');

        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', this.state.cosponsorsExpanded);
        }

        if (listContainer) {
            listContainer.setAttribute('aria-hidden', !this.state.cosponsorsExpanded);
        }

        // Load cosponsors data if expanding and not already loaded
        if (this.state.cosponsorsExpanded && !this.state.cosponsorsData) {
            await this.loadCosponsors();
        }
    }

    /**
     * Load cosponsor data from the API
     */
    async loadCosponsors() {
        const bill = this.state.bill;
        if (!bill) return;

        const listContainer = this.container.querySelector('#panel-cosponsor-list');
        this.state.cosponsorsLoading = true;

        if (listContainer) {
            listContainer.innerHTML = '<div class="cosponsor-list__loading">Loading cosponsors...</div>';
        }

        try {
            const billId = this.getBillId();
            if (!billId) throw new Error('No bill ID');

            const cosponsors = await window.congressionalDataService.getBillCosponsors(billId);
            this.state.cosponsorsData = cosponsors;
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = null;

            if (listContainer) {
                listContainer.innerHTML = this.renderCosponsorList(this.state.cosponsorsData);
            }
        } catch (error) {
            console.error('[BillDetailPanel] Error loading cosponsors:', error);
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = error.message;

            if (listContainer) {
                listContainer.innerHTML = '<div class="cosponsor-list__error">Failed to load cosponsors</div>';
            }
        }
    }

    /**
     * Load bill actions from the API
     */
    async loadActions() {
        const bill = this.state.bill;
        if (!bill) return;

        const actionsList = this.container.querySelector('#actions-list');
        const actionsCount = this.container.querySelector('#actions-count');

        this.state.actionsLoading = true;

        if (actionsList) {
            actionsList.innerHTML = '<div class="actions-panel__loading">Loading actions...</div>';
        }

        try {
            const congress = bill.congress_id || bill.congress;
            const type = (bill.bill_type || bill.type || '').toLowerCase();
            const number = bill.bill_number || bill.number;

            const response = await fetch(`/api/db/bill/${congress}/${type}/${number}/actions`);
            if (!response.ok) throw new Error('Failed to load actions');

            const data = await response.json();
            this.state.actionsData = data.actions || [];

            this.state.actionsLoading = false;
            this.state.actionsError = null;

            // Update count badge
            if (actionsCount) {
                actionsCount.textContent = `${this.state.actionsData.length} actions`;
            }

            // Render actions
            this.renderActionsList();

        } catch (error) {
            console.error('[BillDetailPanel] Error loading actions:', error);
            this.state.actionsLoading = false;
            this.state.actionsError = error.message;

            if (actionsList) {
                actionsList.innerHTML = `
                    <div class="actions-panel__error">
                        <p>Failed to load actions</p>
                        <button class="btn btn--sm btn--secondary" data-action="retry-actions">Retry</button>
                    </div>
                `;
            }
        }
    }

    /**
     * Render the list of actions
     */
    renderActionsList() {
        const actionsList = this.container.querySelector('#actions-list');
        if (!actionsList || !this.state.actionsData) return;

        if (this.state.actionsData.length === 0) {
            actionsList.innerHTML = `
                <div class="actions-panel__empty">
                    <p>No actions recorded for this bill</p>
                </div>
            `;
            return;
        }

        actionsList.innerHTML = this.state.actionsData.map(action => this.renderActionItem(action)).join('');
    }

    /**
     * Render a single action item
     * @param {Object} action - Action data from API
     * @returns {string} HTML string
     */
    renderActionItem(action) {
        const date = action.actionDate ? this.formatActionDate(action.actionDate) : 'Unknown date';
        const time = action.actionTime ? this.formatActionTime(action.actionTime) : '';
        const type = action.type || 'Unknown';
        const code = action.actionCode || '';
        const text = action.text || 'No description available';
        const source = action.sourceSystem?.name || '';
        const committees = action.committees || [];
        const recordedVotes = action.recordedVotes || [];

        // Enhance action text with CR page links if parser is available
        const formattedText = this.formatActionText(text);

        return `
            <div class="action-item">
                <div class="action-item__header">
                    <span class="action-item__date">${date}</span>
                    ${time ? `<span class="action-item__time">${time}</span>` : ''}
                    <span class="action-item__type action-item__type--${type}">${this.formatActionType(type)}</span>
                </div>
                <div class="action-item__text">${formattedText}</div>
                ${code ? `<div class="action-item__code">Code: ${code}</div>` : ''}
                ${source ? `<div class="action-item__source">Source: ${source}</div>` : ''}
                ${this.renderActionCommittees(committees)}
                ${this.renderRecordedVotes(recordedVotes)}
                ${this.renderActionMeeting(action)}
            </div>
        `;
    }

    /**
     * Render committee links within an action
     * @param {Array} committees - Array of committee objects
     * @returns {string} HTML string
     */
    renderActionCommittees(committees) {
        if (!committees || committees.length === 0) return '';

        const committeeLinks = committees.map(committee => {
            const name = committee.name || committee.committeeName || 'Unknown Committee';
            const systemCode = committee.systemCode || '';
            return `
                <a class="action-item__committee-link"
                   href="#"
                   data-committee-code="${systemCode}"
                   title="View committee details">
                    ${this.escapeHtml(name)}
                </a>
            `;
        }).join('');

        return `
            <div class="action-item__committees">
                <div class="action-item__committees-label">Committees</div>
                ${committeeLinks}
            </div>
        `;
    }

    /**
     * Render recorded vote links within an action
     * @param {Array} recordedVotes - Array of recorded vote objects
     * @returns {string} HTML string
     */
    renderRecordedVotes(recordedVotes) {
        if (!recordedVotes || recordedVotes.length === 0) return '';

        const voteLinks = recordedVotes.map(vote => {
            const chamber = vote.chamber || 'Congress';
            const rollNumber = vote.rollNumber || vote.rollCallNumber || 'N/A';
            const date = vote.date ? this.formatActionDate(vote.date) : '';
            const url = vote.url || '#';
            const result = vote.result || '';

            const resultClass = result.toLowerCase().includes('pass') ? 'passed' :
                               result.toLowerCase().includes('fail') ? 'failed' : '';

            return `
                <a class="action-item__vote-link"
                   href="${url}"
                   target="_blank"
                   rel="noopener noreferrer"
                   title="View vote details on ${chamber}">
                    <span>${chamber} Roll Call #${rollNumber}</span>
                    ${date ? `<span>(${date})</span>` : ''}
                    ${result ? `<span class="action-item__vote-result action-item__vote-result--${resultClass}">${result}</span>` : ''}
                </a>
            `;
        }).join('');

        return `
            <div class="action-item__votes">
                <div class="action-item__votes-label">Recorded Votes</div>
                ${voteLinks}
            </div>
        `;
    }

    /**
     * Render committee meeting info within an action
     * @param {Object} action - Action data from API
     * @returns {string} HTML string
     */
    renderActionMeeting(action) {
        if (!action.meeting) return '';

        const { meeting } = action;
        const typeLabel = meeting.type || 'Meeting';
        const committee = meeting.committee || '';
        const title = meeting.title || '';

        // Truncate long titles
        const displayTitle = title.length > 200
            ? title.substring(0, 200) + '...'
            : title;

        const videoLinks = (meeting.videos || [])
            .filter(v => v && v.url)
            .map(v => {
                const isCongressGov = v.url.includes('congress.gov');
                const linkText = isCongressGov ? 'Congress.gov' : 'Video';
                const icon = isCongressGov
                    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>'
                    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
                return `
                    <a href="${this.escapeHtml(v.url)}"
                       target="_blank"
                       rel="noopener noreferrer"
                       class="action-item__video-link">
                        ${icon}
                        ${linkText}
                    </a>
                `;
            }).join('');

        return `
            <div class="action-item__meeting">
                <div class="action-item__meeting-header">
                    <span class="action-item__meeting-type">${this.escapeHtml(typeLabel)}</span>
                    ${committee ? `<span class="action-item__meeting-committee">${this.escapeHtml(committee)}</span>` : ''}
                </div>
                ${displayTitle ? `<div class="action-item__meeting-title">${this.escapeHtml(displayTitle)}</div>` : ''}
                ${videoLinks ? `<div class="action-item__meeting-videos">${videoLinks}</div>` : ''}
            </div>
        `;
    }

    /**
     * Format action date for display
     * @param {string} dateStr - ISO date string
     * @returns {string} Formatted date
     */
    formatActionDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    /**
     * Format action time for display
     * @param {string} timeStr - Time string
     * @returns {string} Formatted time
     */
    formatActionTime(timeStr) {
        if (!timeStr) return '';
        // Handle various time formats
        try {
            const [hours, minutes] = timeStr.split(':');
            const hour = parseInt(hours);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const hour12 = hour % 12 || 12;
            return `${hour12}:${minutes} ${ampm}`;
        } catch {
            return timeStr;
        }
    }

    /**
     * Format action type for display
     * @param {string} type - Action type code
     * @returns {string} Formatted type label
     */
    formatActionType(type) {
        const typeLabels = {
            'IntroReferral': 'Intro',
            'Committee': 'Committee',
            'Floor': 'Floor',
            'BecameLaw': 'Law',
            'President': 'President',
            'Veto': 'Veto',
            'Calendars': 'Calendar',
            'ResolvingDifferences': 'Conference',
            'Discharge': 'Discharge',
            'NotUsed': 'Other'
        };
        return typeLabels[type] || type;
    }

    /**
     * Destroy the panel
     */
    destroy() {
        if (typeof EventBus !== 'undefined') {
            EventBus.off('bill:showDetail');
            EventBus.off('bill:showDetailWithData');
            if (typeof GLOBAL_EVENTS !== 'undefined') {
                EventBus.off(GLOBAL_EVENTS.BILL_SELECTED);
            }
        }
        this.container.innerHTML = '';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillDetailPanel;
} else {
    window.BillDetailPanel = BillDetailPanel;
}
