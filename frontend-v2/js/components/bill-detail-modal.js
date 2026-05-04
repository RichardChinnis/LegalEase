/**
 * BillDetailModal Component
 *
 * Unified modal for viewing bill details from any source:
 * - Spotlight section
 * - Rep Activity Panel
 * - All Bills Panel
 * - Following Sidebar
 *
 * Provides consistent bill exploration experience with:
 * - Bill header and status
 * - Vertical timeline
 * - Rep position callout (optional, for rep-related context)
 * - Summary tabs (Short/Angel/Devil/Realistic)
 * - Embedded PDF text viewer
 * - Chat panel
 */

class BillDetailModal {
    constructor(options = {}) {
        this.options = options;
        this.state = {
            isOpen: false,
            bill: null,
            journeyData: null,
            summaries: null,
            context: null,  // Optional: rep/activity context
            chatExpanded: false,
            loading: false,
            error: null,
            // Cosponsors state
            cosponsorsExpanded: false,
            cosponsorsData: null,
            cosponsorsLoading: false,
            cosponsorsError: null
        };

        this.modalElement = null;
        this.boundHandleKeydown = this.handleKeydown.bind(this);
        this.boundHandleClickOutside = this.handleClickOutside.bind(this);

        this.init();
    }

    /**
     * Initialize the modal
     */
    init() {
        this.createModalElement();
        this.setupGlobalListeners();
    }

    /**
     * Create the modal DOM element
     */
    createModalElement() {
        this.modalElement = document.createElement('div');
        this.modalElement.className = 'bill-detail-modal';
        this.modalElement.innerHTML = `
            <div class="bill-detail-modal__backdrop"></div>
            <div class="bill-detail-modal__container">
                <button class="bill-detail-modal__close" aria-label="Close modal">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <div class="bill-detail-modal__content" id="bill-modal-content">
                    <!-- Content renders here -->
                </div>
            </div>
        `;

        // Add to document
        document.body.appendChild(this.modalElement);

        // Setup close button
        const closeBtn = this.modalElement.querySelector('.bill-detail-modal__close');
        closeBtn.addEventListener('click', () => this.close());

        // Setup backdrop click
        const backdrop = this.modalElement.querySelector('.bill-detail-modal__backdrop');
        backdrop.addEventListener('click', () => this.close());
    }

    /**
     * Setup global event listeners
     * NOTE: Disabled - BillDetailPanel now handles bill:showDetail events
     * Modal is kept as fallback but should only be opened explicitly
     */
    setupGlobalListeners() {
        // DISABLED: BillDetailPanel is now the primary bill display component
        // These listeners are disabled to prevent modal from opening automatically
        // Modal can still be opened directly via openWithBillId() if needed
        /*
        if (typeof EventBus !== 'undefined') {
            EventBus.on('bill:showDetail', (data) => {
                this.openWithBillId(data.billId, data.context);
            });

            EventBus.on('bill:showDetailWithData', (data) => {
                this.openWithBillData(data.bill, data.journey, data.summaries, data.context);
            });
        }
        */
    }

    /**
     * Open modal with bill ID (fetches data)
     */
    async openWithBillId(billId, context = null) {
        if (!billId) return;

        this.state.context = context;
        this.state.loading = true;
        this.state.error = null;
        this.state.cosponsorsExpanded = false;
        this.state.cosponsorsData = null;
        this.state.cosponsorsLoading = false;
        this.state.cosponsorsError = null;
        this.open();
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
            console.error('[BillDetailModal] Error loading bill:', error);
            this.state.error = error.message;
            this.state.loading = false;
            this.renderError();
        }
    }

    /**
     * Open modal with pre-loaded bill data
     */
    openWithBillData(bill, journey = null, summaries = null, context = null) {
        this.state.bill = bill;
        this.state.journeyData = journey;
        this.state.summaries = summaries;
        this.state.context = context;
        this.state.loading = false;
        this.state.error = null;
        this.state.cosponsorsExpanded = false;
        this.state.cosponsorsData = null;
        this.state.cosponsorsLoading = false;
        this.state.cosponsorsError = null;

        this.open();
        this.render();
    }

    /**
     * Open the modal
     */
    open() {
        this.state.isOpen = true;
        this.modalElement.classList.add('bill-detail-modal--open');
        document.body.style.overflow = 'hidden';
        document.body.setAttribute('data-modal-open', 'true');

        // Add keyboard listener
        document.addEventListener('keydown', this.boundHandleKeydown);
    }

    /**
     * Close the modal
     */
    close() {
        this.state.isOpen = false;
        this.modalElement.classList.remove('bill-detail-modal--open');
        document.body.style.overflow = '';
        document.body.removeAttribute('data-modal-open');

        // Remove keyboard listener
        document.removeEventListener('keydown', this.boundHandleKeydown);

        // Clear state
        this.state.bill = null;
        this.state.journeyData = null;
        this.state.summaries = null;
        this.state.context = null;
        this.state.chatExpanded = false;
        this.state.cosponsorsExpanded = false;
        this.state.cosponsorsData = null;
        this.state.cosponsorsLoading = false;
        this.state.cosponsorsError = null;

        // Emit close event
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('bill:detailClosed');
        }
    }

    /**
     * Handle keyboard events
     */
    handleKeydown(event) {
        if (event.key === 'Escape' && this.state.isOpen) {
            this.close();
        }
    }

    /**
     * Handle click outside modal
     */
    handleClickOutside(event) {
        const container = this.modalElement.querySelector('.bill-detail-modal__container');
        if (container && !container.contains(event.target)) {
            this.close();
        }
    }

    /**
     * Main render method
     */
    render() {
        const content = this.modalElement.querySelector('#bill-modal-content');
        if (!content) return;

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

        content.innerHTML = `
            <div class="bill-detail">
                <!-- Bill Header -->
                <div class="bill-detail__header">
                    <span class="bill-detail__number">${billNumber}</span>
                    <span class="bill-detail__status bill-detail__status--${status}">${this.formatStatus(status)}</span>
                </div>
                <h3 class="bill-detail__title">${this.escapeHtml(title)}</h3>

                ${context?.rep ? this.renderRepContext(context) : ''}

                <!-- Timeline and Summary Row -->
                <div class="bill-detail__main-row">
                    <!-- Vertical Timeline -->
                    <div class="bill-detail__timeline" id="modal-vertical-timeline">
                        ${this.renderVerticalTimeline(journey)}
                        ${this.renderSponsorCard(bill)}
                        ${this.renderCosponsorSection(bill)}
                    </div>

                    <!-- Summary Section -->
                    <div class="bill-detail__summary" id="modal-summary-section">
                        ${this.renderSummarySection(summaries)}
                    </div>
                </div>

                <!-- Bill Text Section -->
                <div class="bill-detail__text-section">
                    <div class="bill-detail__text-viewer" id="modal-bill-text-viewer">
                        <div class="bill-text-loading">Loading bill text...</div>
                    </div>
                </div>

                <!-- Chat Section -->
                <div class="bill-detail__chat-section">
                    <div class="bill-detail__chat-header" id="modal-chat-header">
                        <span class="bill-detail__chat-icon">&#128172;</span>
                        <span>Ask About This Bill</span>
                        <button class="bill-detail__chat-toggle" id="modal-chat-toggle">Expand</button>
                    </div>
                    <div class="bill-detail__chat-panel ${this.state.chatExpanded ? '' : 'collapsed'}" id="modal-chat-panel">
                        <div class="chat-suggestions">
                            <button class="chat-suggestion" data-question="What does this bill actually do in plain English?">What does this bill do?</button>
                            <button class="chat-suggestion" data-question="Who supports and who opposes this bill?">Who supports/opposes?</button>
                            <button class="chat-suggestion" data-question="How might this bill affect everyday citizens?">How does it affect me?</button>
                        </div>
                        <div class="chat-input-container">
                            <input type="text" class="chat-input" id="modal-chat-input" placeholder="Ask a question...">
                            <button class="chat-send-btn" id="modal-chat-send-btn">Send</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.setupEventListeners();
        this.loadBillText();
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
        // Get sponsor from bill data
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
                        <span class="sponsor-card__name">${title} ${this.escapeHtml(displayName)}</span>
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
                        aria-controls="modal-cosponsor-list">
                    <span class="cosponsor-toggle__text">Cosponsors (${count})</span>
                    <svg class="cosponsor-toggle__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                <div class="cosponsor-list-container"
                     id="modal-cosponsor-list"
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
        // If stage not found in list (e.g., vetoed), find a reasonable position
        const effectiveIndex = currentIndex >= 0 ? currentIndex : this.getStagePosition(currentStage, stages.length);

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

                    return `
                        <div class="vertical-timeline__stage vertical-timeline__stage--${stateClass}">
                            <div class="vertical-timeline__dot"></div>
                            <div class="vertical-timeline__line"></div>
                            <div class="vertical-timeline__label">
                                <span class="vertical-timeline__stage-name">${stage.label}</span>
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
                    // Normalize status names
                    if (stateClass === 'complete') stateClass = 'completed';

                    return `
                        <div class="vertical-timeline__stage vertical-timeline__stage--${stateClass}">
                            <div class="vertical-timeline__dot"></div>
                            <div class="vertical-timeline__line"></div>
                            <div class="vertical-timeline__label">
                                <span class="vertical-timeline__stage-name">${stage.label || stage.shortLabel}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    /**
     * Normalize stage name to match timeline IDs
     */
    normalizeStage(stage) {
        const mapping = {
            'passed_one_chamber': 'passed_origin',
            'passed_both_chambers': 'passed_both',
            'resolving_differences': 'passed_both' // Show as passed both, conference is between
        };
        return mapping[stage] || stage;
    }

    /**
     * Get approximate position for stages not in the standard list
     */
    getStagePosition(stage, totalStages) {
        const positions = {
            'vetoed': 6,          // After to_president
            'veto_overridden': 7, // After vetoed
            'failed': 3,          // After committee stage
            'resolving_differences': 5 // After passed_both
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
     * Setup event listeners for the modal content
     */
    setupEventListeners() {
        const content = this.modalElement.querySelector('#bill-modal-content');
        if (!content) return;

        // Summary tab switching
        content.querySelectorAll('.summary-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;

                content.querySelectorAll('.summary-tab').forEach(t => t.classList.remove('summary-tab--active'));
                tab.classList.add('summary-tab--active');

                content.querySelectorAll('.summary-content').forEach(c => c.classList.remove('summary-content--active'));
                const contentEl = content.querySelector(`.summary-content[data-content="${tabId}"]`);
                if (contentEl) contentEl.classList.add('summary-content--active');
            });
        });

        // Chat toggle
        const chatToggle = content.querySelector('#modal-chat-toggle');
        const chatPanel = content.querySelector('#modal-chat-panel');
        if (chatToggle && chatPanel) {
            chatToggle.addEventListener('click', () => {
                this.state.chatExpanded = !this.state.chatExpanded;
                chatPanel.classList.toggle('collapsed', !this.state.chatExpanded);
                chatToggle.textContent = this.state.chatExpanded ? 'Collapse' : 'Expand';
            });
        }

        // Cosponsors toggle
        const cosponsorsToggle = content.querySelector('[data-action="toggle-cosponsors"]');
        if (cosponsorsToggle) {
            cosponsorsToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleCosponsorsSection();
            });
        }

        // Chat suggestions
        content.querySelectorAll('.chat-suggestion').forEach(btn => {
            btn.addEventListener('click', () => {
                const question = btn.dataset.question;
                const input = content.querySelector('#modal-chat-input');
                if (input) {
                    input.value = question;
                }
            });
        });
    }

    /**
     * Load bill text PDF
     */
    async loadBillText() {
        const bill = this.state.bill;
        if (!bill) return;

        const viewer = this.modalElement.querySelector('#modal-bill-text-viewer');
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
                    <div class="bill-text-version-badge">
                        <span class="version-type">${latestVersion.type || 'Latest'}</span>
                        ${textVersions.length > 1 ? `
                            <select class="version-selector" id="modal-version-selector">
                                ${textVersions.map((v, i) => {
                                    const vPdf = v.formats?.find(f => f.type === 'PDF');
                                    return vPdf ? `<option value="${vPdf.url}" ${i === 0 ? 'selected' : ''}>${v.type}</option>` : '';
                                }).join('')}
                            </select>
                        ` : ''}
                    </div>
                    <iframe
                        class="bill-text-pdf-viewer"
                        src="${proxyUrl}"
                        title="Bill Text PDF"
                        frameborder="0"
                    ></iframe>
                </div>
            `;

            // Version selector change handler
            const selector = viewer.querySelector('#modal-version-selector');
            if (selector) {
                selector.addEventListener('change', (e) => {
                    const iframe = viewer.querySelector('.bill-text-pdf-viewer');
                    const newUrl = e.target.value;
                    if (iframe) {
                        iframe.src = `/api/pdf-content?url=${encodeURIComponent(newUrl)}#navpanes=0&view=FitH`;
                    }
                    const badge = viewer.querySelector('.version-type');
                    if (badge) {
                        badge.textContent = e.target.options[e.target.selectedIndex].text;
                    }
                });
            }

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
        }
    }

    /**
     * Render loading state
     */
    renderLoading() {
        const content = this.modalElement.querySelector('#bill-modal-content');
        if (content) {
            content.innerHTML = `
                <div class="bill-detail__loading">
                    <div class="loading-spinner"></div>
                    <p>Loading bill details...</p>
                </div>
            `;
        }
    }

    /**
     * Render error state
     */
    renderError(message = 'Failed to load bill details') {
        const content = this.modalElement.querySelector('#bill-modal-content');
        if (content) {
            content.innerHTML = `
                <div class="bill-detail__error">
                    <p>Error loading bill</p>
                    <p class="error-message">${this.escapeHtml(message)}</p>
                    <button class="btn btn--secondary" onclick="window.billDetailModal.close()">Close</button>
                </div>
            `;
        }
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

    /**
     * Format unknown status to title case
     */
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
     * Format summary text for display
     * Handles simple markdown: headings, paragraphs, bold
     */
    formatSummaryText(text) {
        if (!text) return '';

        // First escape HTML to prevent XSS
        let formatted = this.escapeHtml(text);

        // Convert markdown headings to styled text
        // # Heading -> <strong class="summary-heading">Heading</strong>
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

    /**
     * Toggle cosponsors section visibility
     */
    async toggleCosponsorsSection() {
        this.state.cosponsorsExpanded = !this.state.cosponsorsExpanded;

        const toggleBtn = this.modalElement.querySelector('[data-action="toggle-cosponsors"]');
        const listContainer = this.modalElement.querySelector('#modal-cosponsor-list');

        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', this.state.cosponsorsExpanded);
        }

        if (listContainer) {
            listContainer.setAttribute('aria-hidden', !this.state.cosponsorsExpanded);
        }

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

        const listContainer = this.modalElement.querySelector('#modal-cosponsor-list');
        this.state.cosponsorsLoading = true;

        if (listContainer) {
            listContainer.innerHTML = '<div class="cosponsor-list__loading">Loading cosponsors...</div>';
        }

        try {
            const congress = bill.congress_id || bill.congress;
            const type = (bill.bill_type || bill.type || '').toLowerCase();
            const number = bill.bill_number || bill.number;
            const billId = `${congress}-${type}-${number}`;

            const cosponsors = await window.congressionalDataService.getBillCosponsors(billId);
            this.state.cosponsorsData = cosponsors;
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = null;

            if (listContainer) {
                listContainer.innerHTML = this.renderCosponsorList(this.state.cosponsorsData);
            }
        } catch (error) {
            console.error('[BillDetailModal] Error loading cosponsors:', error);
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = error.message;

            if (listContainer) {
                listContainer.innerHTML = '<div class="cosponsor-list__error">Failed to load cosponsors</div>';
            }
        }
    }

    /**
     * Destroy the modal
     */
    destroy() {
        document.removeEventListener('keydown', this.boundHandleKeydown);
        if (this.modalElement && this.modalElement.parentNode) {
            this.modalElement.parentNode.removeChild(this.modalElement);
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillDetailModal;
} else {
    window.BillDetailModal = BillDetailModal;
}
