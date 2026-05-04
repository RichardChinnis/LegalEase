/**
 * RepActivityPanel Component
 *
 * Single-column panel showing representative selector and activity list.
 * When an activity is selected, emits an event for BillDetailPanel to handle.
 *
 * NOTE: Bill detail rendering has been moved to standalone BillDetailPanel component.
 */

class RepActivityPanel {
    constructor(options = {}) {
        this.container = options.container;
        this.state = {
            representatives: [],           // User's reps from location
            activities: [],                // Merged activity feed
            selectedRepId: null,           // Filter by rep (null = all)
            selectedActivity: null,        // Currently selected activity
            activeBillId: null,            // Currently active bill for highlighting
            loading: true,
            error: null,
            followedBills: new Set()       // Track which bills are followed
        };

        // Child component instances
        this.components = {
            repSelector: null,
            activityList: null
        };
    }

    /**
     * Initialize the panel
     */
    async init() {
        if (!this.container) {
            console.error('[RepActivityPanel] No container provided');
            return;
        }

        this.renderShell();
        this.setupEventListeners();
        this.setupGlobalListeners();
        await this.loadFollowedBills();
        await this.loadRepresentatives();
    }

    /**
     * Normalize bill ID to uppercase for consistent comparison
     */
    normalizeBillId(billId) {
        return (billId || '').toUpperCase();
    }

    /**
     * Setup global event listeners for follow/unfollow and active bill
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
     * @param {string} billId - The bill ID to highlight
     */
    updateActiveBill(billId) {
        const normalizedId = this.normalizeBillId(billId);
        this.state.activeBillId = normalizedId;

        // Remove active class from all activity items
        const allItems = this.container.querySelectorAll('.activity-item');
        allItems.forEach(item => item.classList.remove('is-active'));

        // Add active class to matching items (there may be multiple for same bill)
        if (normalizedId) {
            const activeItems = this.container.querySelectorAll(`.activity-item[data-bill-id="${normalizedId}"]`);
            activeItems.forEach(item => item.classList.add('is-active'));
        }
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
            console.error('[RepActivityPanel] Error loading followed bills:', error);
        }
    }

    /**
     * Toggle follow for a bill
     */
    async toggleFollow(billId, billData = null) {
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
                        EventBus.emit('bill:followed', {
                            billId: normalizedId,
                            bill: billData || { bill_id: normalizedId }
                        });
                    }
                }
            }
        } catch (error) {
            console.error('[RepActivityPanel] Error toggling follow:', error);
        }
    }

    /**
     * Update follow button UI for a specific bill
     */
    updateFollowButton(billId, isFollowing) {
        const btn = this.container?.querySelector(`[data-action="toggle-follow"][data-bill-id="${billId}"]`);
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
     * Render the basic shell structure
     */
    renderShell() {
        // Get location info for header
        const locationData = localStorage.getItem('congress-tracker-location');
        let locationDisplay = 'Not set';
        if (locationData) {
            try {
                const loc = JSON.parse(locationData);
                locationDisplay = loc.state
                    ? `${loc.state}${loc.district ? `-${loc.district}` : ''}`
                    : (loc.zip || 'Not set');
            } catch (e) {}
        }

        this.container.innerHTML = `
            <div class="sidebar-module">
                <h3 class="module-title">
                    <span>Your Reps</span>
                    <span class="module-location">
                        <span class="location-icon">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                            </svg>
                        </span>
                        <span class="location-text" id="location-display">${locationDisplay}</span>
                        <button class="location-change-btn" id="location-change-btn" title="Change location">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                    </span>
                </h3>
                <div class="rep-activity-panel__location-form hidden" id="location-form">
                    <input type="text" class="zip-input" id="zip-input" placeholder="Enter ZIP code" maxlength="5" pattern="\\d{5}" inputmode="numeric">
                    <button class="btn btn--primary btn--sm" id="zip-submit-btn">Find</button>
                    <button class="btn btn--ghost btn--sm" id="zip-cancel-btn">Cancel</button>
                    <span class="form-error hidden" id="zip-error"></span>
                </div>
                <div class="rep-activity-panel__content">
                    <div class="rep-selector" id="rep-selector">
                        <!-- Rep photo cards render here -->
                    </div>
                    <div class="activity-list-container">
                        <h3 class="activity-list__title">Recent Activity</h3>
                        <div class="activity-list" id="activity-list">
                            <!-- Activity items render here -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Setup location change handlers
        this.setupLocationHandlers();
    }

    /**
     * Setup location change handlers
     */
    setupLocationHandlers() {
        const changeBtn = this.container.querySelector('#location-change-btn');
        const form = this.container.querySelector('#location-form');
        const zipInput = this.container.querySelector('#zip-input');
        const submitBtn = this.container.querySelector('#zip-submit-btn');
        const cancelBtn = this.container.querySelector('#zip-cancel-btn');
        const errorSpan = this.container.querySelector('#zip-error');

        if (changeBtn) {
            changeBtn.addEventListener('click', () => {
                form.classList.remove('hidden');
                zipInput.focus();
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                form.classList.add('hidden');
                zipInput.value = '';
                errorSpan.classList.add('hidden');
            });
        }

        const handleSubmit = async () => {
            const zip = zipInput.value.trim();
            if (!/^\d{5}$/.test(zip)) {
                errorSpan.textContent = 'Please enter a valid 5-digit zip code';
                errorSpan.classList.remove('hidden');
                return;
            }

            errorSpan.classList.add('hidden');
            submitBtn.disabled = true;
            submitBtn.textContent = '...';

            try {
                const response = await fetch(`/api/location/representatives?zip=${zip}`);
                if (!response.ok) throw new Error('Could not find representatives');

                const data = await response.json();

                // Save to localStorage
                const locationData = {
                    zip: zip,
                    state: data.state,
                    district: data.district
                };
                localStorage.setItem('congress-tracker-location', JSON.stringify(locationData));
                localStorage.setItem('congress-tracker-reps', JSON.stringify(data.representatives || []));

                // Update display
                const locDisplay = this.container.querySelector('#location-display');
                if (locDisplay) {
                    locDisplay.textContent = data.state
                        ? `${data.state}${data.district ? `-${data.district}` : ''}`
                        : zip;
                }

                // Hide form
                form.classList.add('hidden');
                zipInput.value = '';

                // Reload representatives
                await this.loadRepresentatives();

                // Emit event for other components
                if (typeof EventBus !== 'undefined') {
                    EventBus.emit('dashboard:location-set', {
                        location: locationData,
                        representatives: data.representatives
                    });
                }

            } catch (error) {
                errorSpan.textContent = error.message;
                errorSpan.classList.remove('hidden');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Find';
            }
        };

        if (submitBtn) {
            submitBtn.addEventListener('click', handleSubmit);
        }
        if (zipInput) {
            zipInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleSubmit();
            });
        }
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Listen for location changes (dashboard emits this when user sets location)
        if (typeof EventBus !== 'undefined') {
            EventBus.on('dashboard:location-set', async (data) => {
                await this.loadRepresentatives();
            });

            // Listen for rep selection
            EventBus.on('rep:selected', (data) => {
                this.handleRepSelected(data.repId);
            });

            // Listen for activity selection
            EventBus.on('activity:selected', (data) => {
                this.handleActivitySelected(data.activity);
            });
        }
    }

    /**
     * Load representatives from stored location
     */
    async loadRepresentatives() {
        const locationData = localStorage.getItem('congress-tracker-location');
        const repsData = localStorage.getItem('congress-tracker-reps');

        if (!locationData) {
            this.renderNoLocationState();
            return;
        }

        try {
            // Representatives are stored separately from location
            let representatives = [];
            if (repsData) {
                representatives = JSON.parse(repsData) || [];
            } else {
                // Fallback: check if reps are embedded in location data
                const location = JSON.parse(locationData);
                representatives = location.representatives || [];
            }

            this.state.representatives = representatives;

            if (this.state.representatives.length === 0) {
                this.renderNoRepsState();
                return;
            }

            this.renderRepSelector();
            await this.loadActivities();

        } catch (error) {
            console.error('[RepActivityPanel] Error loading representatives:', error);
            this.state.error = error.message;
            this.renderErrorState();
        }
    }

    /**
     * Load activities for all representatives
     */
    async loadActivities() {
        this.state.loading = true;
        this.renderActivityLoading();

        try {
            // Fetch activities for each rep and merge
            const allActivities = [];

            for (const rep of this.state.representatives) {
                const bioguideId = rep.bioguideId || rep.id;
                if (!bioguideId) continue;

                try {
                    const activities = await this.fetchRepActivities(bioguideId, rep);
                    allActivities.push(...activities);
                } catch (err) {
                    console.warn(`[RepActivityPanel] Failed to load activities for ${bioguideId}:`, err);
                }
            }

            // Sort by latest action date descending (most recent first)
            allActivities.sort((a, b) => {
                const dateA = a.latestActionDate ? new Date(a.latestActionDate) : new Date(0);
                const dateB = b.latestActionDate ? new Date(b.latestActionDate) : new Date(0);
                return dateB - dateA;
            });

            this.state.activities = allActivities;
            this.state.loading = false;

            this.renderActivityList();

            // Auto-select first activity if available to populate BillDetailPanel
            if (allActivities.length > 0 && !this.state.selectedActivity) {
                this.handleActivitySelected(allActivities[0]);
            }

        } catch (error) {
            console.error('[RepActivityPanel] Error loading activities:', error);
            this.state.error = error.message;
            this.state.loading = false;
            this.renderActivityError();
        }
    }

    /**
     * Fetch activities for a single representative
     */
    async fetchRepActivities(bioguideId, rep) {
        const activities = [];

        // Fetch sponsored bills
        try {
            const sponsoredRes = await fetch(`/api/db/member/${bioguideId}/sponsored-bills?limit=10`);
            if (sponsoredRes.ok) {
                const data = await sponsoredRes.json();
                if (data.success !== false) {
                    const bills = data.bills || data.data || [];
                    bills.forEach(bill => {
                        activities.push({
                            id: `sponsor-${bioguideId}-${bill.bill_id || bill.billId}`,
                            type: 'sponsored',
                            rep: rep,
                            bill: bill,
                            billId: bill.bill_id || bill.billId,
                            billNumber: `${(bill.bill_type || bill.type || '').toUpperCase()} ${bill.bill_number || bill.number}`,
                            billTitle: bill.title || bill.short_title,
                            date: bill.introduced_date || bill.introducedDate || bill.latest_action_date,
                            latestActionDate: bill.latest_action_date || bill.latestActionDate,
                            description: 'Sponsored'
                        });
                    });
                }
            }
        } catch (err) {
            // Endpoint may not be available yet - continue silently
        }

        // Fetch cosponsored bills
        try {
            const cosponsoredRes = await fetch(`/api/db/member/${bioguideId}/cosponsored-bills?limit=10`);
            if (cosponsoredRes.ok) {
                const data = await cosponsoredRes.json();
                if (data.success !== false) {
                    const bills = data.bills || data.data || [];
                    bills.forEach(bill => {
                        activities.push({
                            id: `cosponsor-${bioguideId}-${bill.bill_id || bill.billId}`,
                            type: 'cosponsored',
                            rep: rep,
                            bill: bill,
                            billId: bill.bill_id || bill.billId,
                            billNumber: `${(bill.bill_type || bill.type || '').toUpperCase()} ${bill.bill_number || bill.number}`,
                            billTitle: bill.title || bill.short_title,
                            date: bill.sponsorship_date || bill.cosponsoredDate || bill.introduced_date,
                            latestActionDate: bill.latest_action_date || bill.latestActionDate,
                            description: 'Cosponsored'
                        });
                    });
                }
            }
        } catch (err) {
            // Endpoint may not be available yet - continue silently
        }

        // Fetch votes (if endpoint exists) - currently not implemented
        // Votes endpoint is not yet available, skip silently

        return activities;
    }

    /**
     * Handle rep selection (filter activities)
     */
    handleRepSelected(repId) {
        this.state.selectedRepId = repId === this.state.selectedRepId ? null : repId;
        this.renderRepSelector();
        this.renderActivityList();
    }

    /**
     * Handle activity selection - emits event for BillDetailPanel
     */
    async handleActivitySelected(activity) {
        if (!activity) return;

        this.state.selectedActivity = activity;
        this.renderActivityList(); // Update selected state

        // Emit event for BillDetailPanel to handle
        if (typeof EventBus !== 'undefined') {
            const billId = activity.billId;
            const context = {
                source: 'rep-activity',
                rep: activity.rep,
                activityType: activity.type,
                description: activity.description
            };

            // Emit the bill:showDetail event that BillDetailPanel listens for
            EventBus.emit('bill:showDetail', { billId, context });
        }
    }

    /**
     * Get filtered activities based on selected rep
     */
    getFilteredActivities() {
        if (!this.state.selectedRepId) {
            return this.state.activities;
        }
        return this.state.activities.filter(a => {
            const repId = a.rep?.bioguideId || a.rep?.id;
            return repId === this.state.selectedRepId;
        });
    }

    /**
     * Group activities by latest action date
     */
    groupActivitiesByDate(activities) {
        const groups = {
            today: [],
            thisWeek: [],
            thisMonth: [],
            earlier: []
        };

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        activities.forEach(activity => {
            // Use latestActionDate for grouping
            const dateStr = activity.latestActionDate || activity.date;
            const date = dateStr ? new Date(dateStr) : new Date(0);
            if (date >= today) {
                groups.today.push(activity);
            } else if (date >= weekAgo) {
                groups.thisWeek.push(activity);
            } else if (date >= monthAgo) {
                groups.thisMonth.push(activity);
            } else {
                groups.earlier.push(activity);
            }
        });

        return groups;
    }

    // ========== RENDER METHODS ==========

    /**
     * Render rep selector (photo cards)
     */
    renderRepSelector() {
        const container = this.container.querySelector('#rep-selector');
        if (!container) return;

        const reps = this.state.representatives;

        container.innerHTML = reps.map(rep => {
            const bioguideId = rep.bioguideId || rep.id;
            const isSelected = this.state.selectedRepId === bioguideId;
            const photoUrl = rep.depiction?.imageUrl || rep.photoUrl ||
                `https://bioguide.congress.gov/bioguide/photo/${bioguideId?.charAt(0)}/${bioguideId}.jpg`;
            const name = rep.name || rep.fullName || `${rep.firstName || ''} ${rep.lastName || ''}`.trim();
            const partyCode = (rep.partyName?.charAt(0) || rep.party || 'I').toLowerCase();
            const state = rep.state || '';
            const district = rep.district ? `-${rep.district}` : '';
            const isSenator = this.isSenator(rep);
            const title = isSenator ? 'Sen.' : 'Rep.';

            return `
                <button class="rep-card rep-card--${partyCode} ${isSelected ? 'rep-card--selected' : ''}"
                        data-rep-id="${bioguideId}"
                        title="${name} (${partyCode.toUpperCase()}-${state}${district})">
                    <div class="rep-card__party-indicator"></div>
                    <img class="rep-card__photo"
                         src="${photoUrl}"
                         alt="${name}"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22>?</text></svg>'">
                    <span class="rep-card__name">${title} ${rep.lastName || name.split(' ').pop()}</span>
                    <span class="rep-card__party">${partyCode.toUpperCase()}-${state}${district}</span>
                </button>
            `;
        }).join('');

        // Add click handlers
        container.querySelectorAll('.rep-card').forEach(card => {
            card.addEventListener('click', () => {
                const repId = card.dataset.repId;
                this.handleRepSelected(repId);
            });
        });
    }

    /**
     * Check if member is a senator
     */
    isSenator(rep) {
        // Check various properties that indicate Senate membership
        if (rep.chamber === 'Senate') return true;
        if (rep.title?.toLowerCase().includes('sen')) return true;
        if (rep.terms?.[0]?.chamber === 'Senate') return true;
        // If no district, likely a senator (senators represent whole state)
        if (rep.state && !rep.district) return true;
        return false;
    }

    /**
     * Get shortened name for rep card
     */
    getShortName(rep) {
        const lastName = rep.lastName || rep.name?.split(' ').pop() || '';
        const title = this.isSenator(rep) ? 'Sen.' : 'Rep.';
        return `${title} ${lastName}`;
    }

    /**
     * Render activity list
     */
    renderActivityList() {
        const container = this.container.querySelector('#activity-list');
        if (!container) return;

        const activities = this.getFilteredActivities();
        const grouped = this.groupActivitiesByDate(activities);

        let html = '';

        if (grouped.today.length > 0) {
            html += this.renderActivityGroup('Today', grouped.today);
        }
        if (grouped.thisWeek.length > 0) {
            html += this.renderActivityGroup('This Week', grouped.thisWeek);
        }
        if (grouped.thisMonth.length > 0) {
            html += this.renderActivityGroup('This Month', grouped.thisMonth);
        }
        if (grouped.earlier.length > 0) {
            html += this.renderActivityGroup('Earlier', grouped.earlier);
        }

        if (!html) {
            html = `
                <div class="activity-list__empty">
                    <p>No recent activity found</p>
                </div>
            `;
        }

        container.innerHTML = html;

        // Add click handlers for activity items (select activity)
        container.querySelectorAll('.activity-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking the follow button
                if (e.target.closest('[data-action="toggle-follow"]')) return;

                const activityId = item.dataset.activityId;
                const activity = this.state.activities.find(a => a.id === activityId);
                if (activity) {
                    this.handleActivitySelected(activity);
                }
            });
        });

        // Add click handlers for follow buttons
        container.querySelectorAll('.activity-item__follow-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const billId = btn.dataset.billId;
                if (billId) {
                    const activityId = btn.closest('.activity-item')?.dataset.activityId;
                    const activity = this.state.activities.find(a => a.id === activityId);
                    this.toggleFollow(billId, activity ? {
                        bill_id: billId,
                        title: activity.billTitle || activity.billNumber
                    } : null);
                }
            });
        });
    }

    /**
     * Render a group of activities
     */
    renderActivityGroup(title, activities) {
        return `
            <div class="activity-group">
                <h4 class="activity-group__title">${title}</h4>
                ${activities.map(a => this.renderActivityItem(a)).join('')}
            </div>
        `;
    }

    /**
     * Format date as m/d/yy
     */
    formatShortDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const year = date.getFullYear() % 100;
        return `${month}/${day}/${year.toString().padStart(2, '0')}`;
    }

    /**
     * Render a single activity item
     */
    renderActivityItem(activity) {
        const icon = this.getActivityIcon(activity.type, activity.votePosition);
        const rep = activity.rep;
        const repName = this.getShortName(rep);
        const billId = activity.billId || activity.bill_id;
        const normalizedBillId = this.normalizeBillId(billId);
        const isFollowing = normalizedBillId ? this.state.followedBills.has(normalizedBillId) : false;
        const isActive = this.state.activeBillId === normalizedBillId;
        const actionDate = this.formatShortDate(activity.latestActionDate);

        return `
            <div class="activity-item ${isActive ? 'is-active' : ''}"
                 data-activity-id="${activity.id}"
                 data-bill-id="${normalizedBillId || ''}">
                <span class="activity-item__icon">${icon}</span>
                <div class="activity-item__content">
                    <span class="activity-item__rep">${repName}</span>
                    <span class="activity-item__action">${activity.description}</span>
                    <span class="activity-item__bill">${activity.billNumber || 'Bill'}${actionDate ? ` <span class="activity-item__date">${actionDate}</span>` : ''}</span>
                </div>
                ${normalizedBillId ? `
                    <button class="activity-item__follow-btn ${isFollowing ? 'is-following' : ''}"
                            data-action="toggle-follow"
                            data-bill-id="${normalizedBillId}"
                            title="${isFollowing ? 'Unfollow' : 'Follow'}"
                            aria-pressed="${isFollowing}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFollowing ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
        `;
    }

    /**
     * Get icon for activity type
     */
    getActivityIcon(type, votePosition) {
        switch (type) {
            case 'vote':
                if (votePosition?.toLowerCase() === 'yes' || votePosition?.toLowerCase() === 'yea') {
                    return '<span class="vote-icon vote-icon--yes">&#10003;</span>';
                } else if (votePosition?.toLowerCase() === 'no' || votePosition?.toLowerCase() === 'nay') {
                    return '<span class="vote-icon vote-icon--no">&#10007;</span>';
                }
                return '<span class="vote-icon">&#9679;</span>';
            case 'sponsored':
                return '<span class="sponsor-icon">&#128221;</span>';
            case 'cosponsored':
                return '<span class="cosponsor-icon">&#128203;</span>';
            default:
                return '<span class="activity-icon">&#9679;</span>';
        }
    }

    // ========== STATE RENDER METHODS ==========

    renderNoLocationState() {
        const container = this.container.querySelector('#activity-list');
        if (container) {
            container.innerHTML = `
                <div class="activity-list__empty">
                    <p>Set your location to see your representatives' activity</p>
                </div>
            `;
        }
    }

    renderNoRepsState() {
        const container = this.container.querySelector('#activity-list');
        if (container) {
            container.innerHTML = `
                <div class="activity-list__empty">
                    <p>No representatives found for your location</p>
                </div>
            `;
        }
    }

    renderActivityLoading() {
        const container = this.container.querySelector('#activity-list');
        if (container) {
            container.innerHTML = `
                <div class="activity-list__loading">
                    <div class="loading-spinner"></div>
                    <p>Loading activity...</p>
                </div>
            `;
        }
    }

    renderActivityError() {
        const container = this.container.querySelector('#activity-list');
        if (container) {
            container.innerHTML = `
                <div class="activity-list__error">
                    <p>Error loading activity</p>
                    <button class="retry-btn" onclick="this.closest('.rep-activity-panel').dispatchEvent(new CustomEvent('retry'))">Retry</button>
                </div>
            `;
        }
    }

    renderErrorState() {
        this.container.innerHTML = `
            <div class="rep-activity-panel rep-activity-panel--error">
                <p>Error loading representative data</p>
                <p>${this.state.error}</p>
            </div>
        `;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RepActivityPanel;
} else {
    window.RepActivityPanel = RepActivityPanel;
}
