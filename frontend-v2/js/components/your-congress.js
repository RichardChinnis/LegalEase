/**
 * Your Congress Component
 *
 * Personalized sidebar showing user's representatives based on their location.
 * Uses LocationService for zip code storage and rep lookup API.
 *
 * Features:
 * - Location display with change option
 * - List of user's senators and representative
 * - Link to activity feed
 */
class YourCongress {
    constructor(options = {}) {
        this.container = options.container;
        this.onLocationChange = options.onLocationChange || null;
        this.onMemberClick = options.onMemberClick || null;
        this.state = {
            location: null,
            representatives: [],
            loading: false,
            error: null,
            showLocationInput: false
        };
    }

    /**
     * Initialize component
     */
    async init() {
        // Load from LocationService
        if (typeof LocationService !== 'undefined') {
            const summary = LocationService.getSummary();
            this.state.location = {
                zip: summary.zip,
                state: summary.state,
                district: summary.district
            };
            this.state.representatives = summary.representatives || [];
        }

        // If we have location but no reps, try to load them
        if (this.state.location?.state && this.state.representatives.length === 0) {
            await this.loadRepresentatives();
        }

        this.render();
    }

    /**
     * Load representatives from API
     */
    async loadRepresentatives() {
        const { state, district, zip } = this.state.location || {};

        if (!state && !zip) {
            return;
        }

        this.state.loading = true;
        this.render();

        try {
            const params = new URLSearchParams();
            if (state) params.append('state', state);
            if (district) params.append('district', district);
            if (zip) params.append('zip', zip);

            const response = await fetch(`/api/location/representatives?${params}`);

            if (response.ok) {
                const data = await response.json();
                this.state.representatives = data.representatives || [];

                // Cache in LocationService
                if (typeof LocationService !== 'undefined') {
                    LocationService.setRepresentatives(this.state.representatives);
                }
            } else {
                throw new Error('Failed to load representatives');
            }

            this.state.loading = false;
            this.state.error = null;
        } catch (error) {
            console.error('[YourCongress] Error loading representatives:', error);
            this.state.loading = false;
            this.state.error = error.message;
        }

        this.render();
    }

    /**
     * Handle zip code submission
     */
    async handleZipSubmit(zip) {
        if (!zip || !/^\d{5}$/.test(zip)) {
            this.state.error = 'Please enter a valid 5-digit zip code';
            this.render();
            return;
        }

        this.state.loading = true;
        this.state.error = null;
        this.render();

        try {
            const response = await fetch(`/api/location/representatives?zip=${zip}`);

            if (!response.ok) {
                throw new Error('Could not find representatives for this zip code');
            }

            const data = await response.json();

            // Update state
            this.state.location = {
                zip: zip,
                state: data.state,
                district: data.district
            };
            this.state.representatives = data.representatives || [];
            this.state.showLocationInput = false;

            // Save to LocationService
            if (typeof LocationService !== 'undefined') {
                LocationService.saveLocationResult({
                    zip: zip,
                    state: data.state,
                    district: data.district,
                    representatives: data.representatives
                });
            }

            // Emit change event
            if (this.onLocationChange) {
                this.onLocationChange(this.state.location, this.state.representatives);
            }

            this.state.loading = false;
            this.state.error = null;
        } catch (error) {
            console.error('[YourCongress] Error looking up zip:', error);
            this.state.loading = false;
            this.state.error = error.message;
        }

        this.render();
    }

    /**
     * Main render method
     */
    render() {
        if (!this.container) return;

        this.container.innerHTML = '';
        this.container.className = 'your-congress';

        // Header
        const header = this.createHeader();
        this.container.appendChild(header);

        // Content
        if (this.state.loading) {
            this.container.appendChild(this.createLoadingState());
        } else if (this.state.showLocationInput || !this.state.location?.state) {
            this.container.appendChild(this.createLocationInput());
        } else if (this.state.error) {
            this.container.appendChild(this.createErrorState());
        } else {
            this.container.appendChild(this.createRepresentativesList());
        }
    }

    /**
     * Create header with location display
     */
    createHeader() {
        const header = document.createElement('div');
        header.className = 'your-congress__header';

        const locationDisplay = this.state.location?.state
            ? `${this.state.location.state}${this.state.location.district ? `-${this.state.location.district}` : ''}`
            : 'Not set';

        header.innerHTML = `
            <h3 class="your-congress__title">Your Congress</h3>
            <div class="your-congress__location">
                <span class="location-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                </span>
                <span class="location-text">${locationDisplay}</span>
                <button class="location-change-btn" title="Change location">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
            </div>
        `;

        // Change location handler
        const changeBtn = header.querySelector('.location-change-btn');
        changeBtn.addEventListener('click', () => {
            this.state.showLocationInput = true;
            this.render();
        });

        return header;
    }

    /**
     * Create location input form
     */
    createLocationInput() {
        const form = document.createElement('div');
        form.className = 'your-congress__location-form';

        form.innerHTML = `
            <p class="form-label">Enter your zip code to see your representatives:</p>
            <div class="zip-input-group">
                <input
                    type="text"
                    class="zip-input"
                    placeholder="12345"
                    maxlength="5"
                    pattern="\\d{5}"
                    inputmode="numeric"
                >
                <button class="btn btn--primary btn--sm zip-submit-btn">Find</button>
            </div>
            ${this.state.error ? `<p class="form-error">${this.state.error}</p>` : ''}
            ${this.state.location?.state ? `
                <button class="btn btn--ghost btn--sm cancel-btn">Cancel</button>
            ` : ''}
        `;

        // Submit handler
        const input = form.querySelector('.zip-input');
        const submitBtn = form.querySelector('.zip-submit-btn');

        const handleSubmit = () => {
            this.handleZipSubmit(input.value.trim());
        };

        submitBtn.addEventListener('click', handleSubmit);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSubmit();
        });

        // Cancel handler
        const cancelBtn = form.querySelector('.cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.state.showLocationInput = false;
                this.state.error = null;
                this.render();
            });
        }

        // Auto-focus input
        setTimeout(() => input.focus(), 0);

        return form;
    }

    /**
     * Create representatives list
     */
    createRepresentativesList() {
        const list = document.createElement('div');
        list.className = 'your-congress__representatives';

        if (this.state.representatives.length === 0) {
            list.innerHTML = `
                <p class="no-reps-message">No representatives found for your location.</p>
            `;
            return list;
        }

        // Group by chamber
        const senators = this.state.representatives.filter(r =>
            r.chamber === 'Senate' || r.title?.includes('Sen')
        );
        const reps = this.state.representatives.filter(r =>
            r.chamber === 'House' || r.title?.includes('Rep')
        );

        // Senators
        if (senators.length > 0) {
            const senatorsSection = document.createElement('div');
            senatorsSection.className = 'reps-section';
            senatorsSection.innerHTML = `<h4 class="reps-section__title">Senators</h4>`;

            senators.forEach(sen => {
                senatorsSection.appendChild(this.createMemberCard(sen));
            });

            list.appendChild(senatorsSection);
        }

        // Representatives
        if (reps.length > 0) {
            const repsSection = document.createElement('div');
            repsSection.className = 'reps-section';
            repsSection.innerHTML = `<h4 class="reps-section__title">Representative</h4>`;

            reps.forEach(rep => {
                repsSection.appendChild(this.createMemberCard(rep));
            });

            list.appendChild(repsSection);
        }

        return list;
    }

    /**
     * Create member card
     */
    createMemberCard(member) {
        const card = document.createElement('div');
        card.className = `member-card member-card--${(member.party || 'I').toLowerCase()}`;

        const fullName = member.fullName || `${member.firstName || ''} ${member.lastName || ''}`.trim();
        const title = member.title || (member.chamber === 'Senate' ? 'Sen.' : 'Rep.');
        const partyLabel = member.partyName || member.party || '';
        const stateDistrict = member.district
            ? `${member.state}-${member.district}`
            : member.state;

        card.innerHTML = `
            <div class="member-card__photo">
                ${member.photoUrl
                    ? `<img src="${member.photoUrl}" alt="${fullName}" />`
                    : `<div class="member-card__initials">${this.getInitials(member)}</div>`
                }
            </div>
            <div class="member-card__info">
                <span class="member-card__name">${title} ${fullName}</span>
                <span class="member-card__details">${partyLabel} - ${stateDistrict}</span>
            </div>
            <div class="member-card__party-indicator"></div>
        `;

        // Click handler
        card.addEventListener('click', () => {
            if (this.onMemberClick) {
                this.onMemberClick(member);
            }
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('navigation:member', { member });
            }
        });

        return card;
    }

    /**
     * Get member initials
     */
    getInitials(member) {
        const first = member.firstName?.charAt(0) || '';
        const last = member.lastName?.charAt(0) || '';
        return (first + last).toUpperCase() || '?';
    }

    /**
     * Create loading state
     */
    createLoadingState() {
        const loading = document.createElement('div');
        loading.className = 'your-congress__loading';
        loading.innerHTML = `
            <div class="loading-skeleton" style="height: 60px; margin-bottom: 8px;"></div>
            <div class="loading-skeleton" style="height: 60px; margin-bottom: 8px;"></div>
            <div class="loading-skeleton" style="height: 60px;"></div>
        `;
        return loading;
    }

    /**
     * Create error state
     */
    createErrorState() {
        const error = document.createElement('div');
        error.className = 'your-congress__error';
        error.innerHTML = `
            <p>${this.state.error}</p>
            <button class="btn btn--secondary btn--sm retry-btn">Try Again</button>
        `;

        error.querySelector('.retry-btn').addEventListener('click', () => {
            this.state.error = null;
            this.state.showLocationInput = true;
            this.render();
        });

        return error;
    }

    /**
     * Update location externally
     */
    updateLocation(location, representatives) {
        this.state.location = location;
        this.state.representatives = representatives || [];
        this.render();
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
    module.exports = YourCongress;
} else {
    window.YourCongress = YourCongress;
}
