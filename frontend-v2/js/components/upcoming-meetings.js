/**
 * Upcoming Meetings Component
 *
 * Shows scheduled committee meetings with linked bills.
 * Grouped by date for a calendar-like view.
 * Replaces the spotlight panel to show "what's coming" vs "what is".
 */
class UpcomingMeetings {
    constructor(options = {}) {
        this.container = options.container;
        this.onBillClick = options.onBillClick || null;
        this.onMeetingClick = options.onMeetingClick || null;
        this.config = {
            days: 14,
            limit: 30,
            includeRecent: false,
            apiEndpoint: '/api/db/upcoming-meetings',
            ...options.config
        };

        this.state = {
            meetings: [],
            byDate: {},
            loading: false,
            error: null,
            activeBillId: null,
            expandedDates: new Set()
        };

        this.elements = {};
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
     * Set up global event listeners
     */
    setupGlobalListeners() {
        if (typeof EventBus !== 'undefined' && typeof GLOBAL_EVENTS !== 'undefined') {
            EventBus.on(GLOBAL_EVENTS.BILL_ACTIVE_CHANGED, (data) => {
                this.updateActiveBill(data.billId);
            });
        }
    }

    /**
     * Update active bill highlight
     */
    updateActiveBill(billId) {
        const normalizedId = this.normalizeBillId(billId);
        this.state.activeBillId = normalizedId;

        const allBillItems = this.container.querySelectorAll('.meeting-bill');
        allBillItems.forEach(item => item.classList.remove('is-active'));

        if (normalizedId) {
            const activeItem = this.container.querySelector(`.meeting-bill[data-bill-id="${normalizedId}"]`);
            if (activeItem) {
                activeItem.classList.add('is-active');
            }
        }
    }

    /**
     * Initialize and load data
     */
    async init() {
        if (!this.container) {
            console.error('[UpcomingMeetings] No container provided');
            return;
        }

        this.render();
        await this.loadMeetings();
    }

    /**
     * Render container structure
     */
    render() {
        this.container.innerHTML = `
            <div class="upcoming-meetings">
                <div class="upcoming-meetings__list" id="meetings-list">
                    <div class="upcoming-meetings__loading">
                        <div class="loading-spinner loading-spinner--sm"></div>
                        <span>Loading schedule...</span>
                    </div>
                </div>
            </div>
        `;

        this.elements.list = this.container.querySelector('#meetings-list');
    }

    /**
     * Load meetings from API
     */
    async loadMeetings() {
        this.state.loading = true;
        this.state.error = null;
        this.renderLoading();

        try {
            const params = new URLSearchParams({
                days: this.config.days,
                limit: this.config.limit,
                includeRecent: this.config.includeRecent
            });

            const response = await fetch(`${this.config.apiEndpoint}?${params}`);
            if (!response.ok) {
                throw new Error('Failed to load upcoming meetings');
            }

            const data = await response.json();
            this.state.meetings = data.meetings || [];
            this.state.byDate = data.byDate || {};
            this.state.loading = false;

            // Auto-expand first 3 dates
            const dates = Object.keys(this.state.byDate).sort();
            dates.slice(0, 3).forEach(d => this.state.expandedDates.add(d));

            this.renderMeetingsList();

        } catch (error) {
            console.error('[UpcomingMeetings] Error loading meetings:', error);
            this.state.error = error.message;
            this.state.loading = false;
            this.renderError();
        }
    }

    /**
     * Format date for display
     */
    formatDate(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const isToday = date.toDateString() === today.toDateString();
        const isTomorrow = date.toDateString() === tomorrow.toDateString();

        if (isToday) return 'Today';
        if (isTomorrow) return 'Tomorrow';

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
    }

    /**
     * Format time for display
     */
    formatTime(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    /**
     * Get meeting type badge
     */
    getMeetingTypeBadge(type) {
        const typeConfig = {
            'Markup': { class: 'badge--markup', icon: '📋', label: 'Markup' },
            'Hearing': { class: 'badge--hearing', icon: '🎤', label: 'Hearing' },
            'Meeting': { class: 'badge--meeting', icon: '📅', label: 'Meeting' }
        };
        const config = typeConfig[type] || typeConfig['Meeting'];
        return `<span class="meeting-type-badge ${config.class}" title="${config.label}">${config.icon} ${config.label}</span>`;
    }

    /**
     * Get chamber badge
     */
    getChamberBadge(chamber) {
        const isHouse = chamber?.toLowerCase() === 'house';
        return `<span class="chamber-badge ${isHouse ? 'chamber-badge--house' : 'chamber-badge--senate'}">${isHouse ? 'H' : 'S'}</span>`;
    }

    /**
     * Render the meetings list grouped by date
     */
    renderMeetingsList() {
        if (!this.elements.list) return;

        const dates = Object.keys(this.state.byDate).sort();

        if (dates.length === 0) {
            this.elements.list.innerHTML = `
                <div class="upcoming-meetings__empty">
                    <div class="empty-icon">📅</div>
                    <p>No upcoming meetings scheduled</p>
                    <p class="empty-subtext">Check back later for the congressional calendar</p>
                </div>
            `;
            return;
        }

        const html = dates.map(dateKey => {
            const meetings = this.state.byDate[dateKey];
            const isExpanded = this.state.expandedDates.has(dateKey);
            const meetingCount = meetings.length;
            const markupCount = meetings.filter(m => m.type === 'Markup').length;

            return `
                <div class="date-group ${isExpanded ? 'is-expanded' : ''}" data-date="${dateKey}">
                    <div class="date-group__header" data-action="toggle-date">
                        <div class="date-group__title">
                            <span class="date-group__date">${this.formatDate(dateKey)}</span>
                            <span class="date-group__count">${meetingCount} meeting${meetingCount !== 1 ? 's' : ''}${markupCount > 0 ? ` · ${markupCount} markup${markupCount !== 1 ? 's' : ''}` : ''}</span>
                        </div>
                        <span class="date-group__toggle">${isExpanded ? '−' : '+'}</span>
                    </div>
                    <div class="date-group__content" ${!isExpanded ? 'style="display: none;"' : ''}>
                        ${meetings.map(meeting => this.renderMeeting(meeting)).join('')}
                    </div>
                </div>
            `;
        }).join('');

        this.elements.list.innerHTML = html;
        this.bindEvents();
    }

    /**
     * Render a single meeting
     */
    renderMeeting(meeting) {
        const time = this.formatTime(meeting.date);
        const typeBadge = this.getMeetingTypeBadge(meeting.type);
        const chamberBadge = this.getChamberBadge(meeting.chamber);

        // Get committee name (first one if multiple)
        const committeeName = meeting.committees?.[0]?.name || 'Committee TBD';
        const shortCommittee = this.truncateText(committeeName, 50);

        // Render bills if any
        const billsHtml = meeting.bills?.length > 0
            ? `<div class="meeting__bills">
                ${meeting.bills.slice(0, 5).map(bill => `
                    <button class="meeting-bill" data-bill-id="${this.escapeHtml(bill.billId)}" title="${this.escapeHtml(bill.shortTitle || bill.title)}">
                        <span class="meeting-bill__id">${bill.billType} ${bill.billNumber}</span>
                    </button>
                `).join('')}
                ${meeting.bills.length > 5 ? `<span class="meeting-bills__more">+${meeting.bills.length - 5} more</span>` : ''}
               </div>`
            : '';

        const locationHtml = meeting.location?.room
            ? `<span class="meeting__location" title="${meeting.location.building || ''}">${meeting.location.room}</span>`
            : '';

        return `
            <div class="meeting" data-meeting-id="${meeting.meetingId}">
                <div class="meeting__header">
                    <span class="meeting__time">${time}</span>
                    ${chamberBadge}
                    ${typeBadge}
                    ${locationHtml}
                </div>
                <div class="meeting__committee" title="${this.escapeHtml(committeeName)}">${this.escapeHtml(shortCommittee)}</div>
                ${meeting.title && meeting.title !== committeeName ? `<div class="meeting__title">${this.escapeHtml(this.truncateText(meeting.title, 100))}</div>` : ''}
                ${billsHtml}
            </div>
        `;
    }

    /**
     * Truncate text with ellipsis
     */
    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
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
     * Bind event listeners
     */
    bindEvents() {
        // Date group toggle
        this.elements.list.querySelectorAll('[data-action="toggle-date"]').forEach(header => {
            header.addEventListener('click', (e) => {
                const group = header.closest('.date-group');
                const dateKey = group.dataset.date;
                this.toggleDate(dateKey);
            });
        });

        // Bill clicks
        this.elements.list.querySelectorAll('.meeting-bill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const billId = btn.dataset.billId;
                if (billId) {
                    this.openBillDetail(billId);
                }
            });
        });

        // Meeting clicks (for future expansion - could show meeting detail modal)
        this.elements.list.querySelectorAll('.meeting').forEach(meetingEl => {
            meetingEl.addEventListener('click', (e) => {
                // Only if not clicking a bill
                if (!e.target.closest('.meeting-bill')) {
                    const meetingId = meetingEl.dataset.meetingId;
                    if (this.onMeetingClick) {
                        const meeting = this.state.meetings.find(m => m.meetingId == meetingId);
                        if (meeting) {
                            this.onMeetingClick(meeting);
                        }
                    }
                }
            });
        });
    }

    /**
     * Toggle date group expansion
     */
    toggleDate(dateKey) {
        const group = this.elements.list.querySelector(`.date-group[data-date="${dateKey}"]`);
        if (!group) return;

        const isExpanded = this.state.expandedDates.has(dateKey);

        if (isExpanded) {
            this.state.expandedDates.delete(dateKey);
            group.classList.remove('is-expanded');
            group.querySelector('.date-group__content').style.display = 'none';
            group.querySelector('.date-group__toggle').textContent = '+';
        } else {
            this.state.expandedDates.add(dateKey);
            group.classList.add('is-expanded');
            group.querySelector('.date-group__content').style.display = '';
            group.querySelector('.date-group__toggle').textContent = '−';
        }
    }

    /**
     * Open bill detail
     */
    openBillDetail(billId) {
        if (this.onBillClick) {
            this.onBillClick({ billId });
        }

        if (typeof EventBus !== 'undefined') {
            EventBus.emit('bill:showDetail', { billId, context: { source: 'upcoming-meetings' } });
        }
    }

    /**
     * Render loading state
     */
    renderLoading() {
        if (this.elements.list) {
            this.elements.list.innerHTML = `
                <div class="upcoming-meetings__loading">
                    <div class="loading-spinner loading-spinner--sm"></div>
                    <span>Loading schedule...</span>
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
                <div class="upcoming-meetings__error">
                    <p>Error loading schedule</p>
                    <button class="btn btn--ghost btn--sm" id="retry-meetings">Retry</button>
                </div>
            `;

            const retryBtn = this.elements.list.querySelector('#retry-meetings');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.loadMeetings());
            }
        }
    }

    /**
     * Refresh data
     */
    async refresh() {
        await this.loadMeetings();
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
    module.exports = UpcomingMeetings;
} else {
    window.UpcomingMeetings = UpcomingMeetings;
}
