/**
 * Dashboard Page Component
 * 
 * Main dashboard implementation for the Congressional Activity Application.
 * Orchestrates the feed, sidebar modules, and user onboarding flow.
 * 
 * Features:
 * - Congressional Feed with real-time data
 * - My Members sidebar module
 * - National Spotlight module  
 * - Explore Topics navigation
 * - Location-based personalization
 * - Progressive loading and error handling
 */

class DashboardPage {
    constructor() {
        this.components = {
            onboardingModal: null,
            todaysSpotlight: null,
            repActivityPanel: null,
            congressionalFeed: null,
            followingSidebar: null,
            billDetailModal: null,
            billDetailPanel: null,    // NEW: Standalone bill detail panel
            allBillsPanel: null
        };
        
        this.state = {
            isInitialized: false,
            currentView: 'feed', // 'feed' or 'billDetail'
            userLocation: null,
            userReps: null,
            feedLoading: false,
            feedError: null,
            hasSeenOnboarding: false
        };
        
        // Bind methods
        this.init = this.init.bind(this);
        this.handleLocationSet = this.handleLocationSet.bind(this);
        this.handleFeedRefresh = this.handleFeedRefresh.bind(this);
        this.handleTopicClick = this.handleTopicClick.bind(this);
    }
    
    /**
     * Initialize the dashboard
     */
    async init() {
        if (this.state.isInitialized) return;
        
        
        // Track dashboard initialization
        if (typeof analytics !== 'undefined') {
            analytics.track('dashboard_init', {
                hasOnboarded: this.state.hasSeenOnboarding,
                timestamp: Date.now()
            });
        }
        
        try {
            // Check if user has completed onboarding
            await this.checkOnboardingStatus();
            
            // Initialize components
            await this.initializeComponents();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Load initial data
            await this.loadInitialData();
            
            this.state.isInitialized = true;
            
            // Track successful initialization
            if (typeof analytics !== 'undefined') {
                analytics.track('dashboard_ready', {
                    initializationTime: Date.now() - (performance.now() + performance.timeOrigin),
                    hasRepresentatives: this.state.userReps && this.state.userReps.length > 0
                });
            }
            
        } catch (error) {
            console.error('[Dashboard] Failed to initialize dashboard:', error);
            
            // Track initialization error
            if (typeof analytics !== 'undefined') {
                analytics.trackError(error, 'dashboard_initialization');
            }
            
            this.handleError('Failed to initialize dashboard', error);
        }
    }
    
    /**
     * Check onboarding status and show modal if needed
     */
    async checkOnboardingStatus() {
        // Check localStorage for onboarding completion
        const onboardingComplete = localStorage.getItem('congress-tracker-onboarded');
        const userLocation = localStorage.getItem('congress-tracker-location');
        
        this.state.hasSeenOnboarding = !!onboardingComplete;
        
        if (userLocation) {
            try {
                this.state.userLocation = JSON.parse(userLocation);
                this.state.userReps = JSON.parse(localStorage.getItem('congress-tracker-reps') || 'null');
            } catch (error) {
                console.error('[Dashboard] Error parsing stored location data:', error);
            }
        }
        
        // Show onboarding if not completed
        if (!this.state.hasSeenOnboarding) {
            setTimeout(() => this.showOnboardingModal(), 500);
        }
    }
    
    /**
     * Initialize all dashboard components
     */
    async initializeComponents() {

        // Initialize onboarding modal
        this.initOnboardingModal();

        // Initialize Upcoming Meetings (calendar view)
        this.initUpcomingMeetings();

        // Initialize Rep Activity Panel (master-detail for rep activities)
        this.initRepActivityPanel();

        // Initialize feed component
        this.initCongressionalFeed();

        // Initialize sidebar modules
        this.initFollowingSidebarModule();

        // Initialize All Bills Panel (browse all bills with search)
        this.initAllBillsPanel();

        // Initialize Bill Detail Panel (inline panel for viewing bills - replaces modal)
        this.initBillDetailPanel();

        // NOTE: Modal initialization disabled - BillDetailPanel is now primary
        // this.initBillDetailModal();

        // Initialize How Bills Work modal
        this.initHowBillsWorkModal();
    }

    /**
     * Initialize Upcoming Meetings - calendar view of scheduled committee meetings
     */
    initUpcomingMeetings() {
        const container = document.getElementById('upcoming-meetings');
        if (!container) {
            console.warn('[Dashboard] Upcoming Meetings container not found');
            return;
        }

        this.components.upcomingMeetings = new UpcomingMeetings({
            container: container,
            config: {
                days: 14,
                limit: 30
            },
            onBillClick: (data) => {
                EventBus.emit(GLOBAL_EVENTS.BILL_SELECTED, { billId: data.billId, source: 'upcoming-meetings' });
            },
            onMeetingClick: (meeting) => {
                // If meeting has bills, show first bill
                if (meeting.bills && meeting.bills.length > 0) {
                    const firstBill = meeting.bills[0];
                    EventBus.emit(GLOBAL_EVENTS.BILL_SELECTED, { billId: firstBill.billId, source: 'upcoming-meetings' });
                }
            }
        });
    }

    /**
     * Initialize onboarding modal
     */
    initOnboardingModal() {
        const modalContainer = document.getElementById('onboarding-modal-container');
        
        // Create container if it doesn't exist
        if (!modalContainer) {
            const container = document.createElement('div');
            container.id = 'onboarding-modal-container';
            document.body.appendChild(container);
        }
        
        // Create modal using ModalComponent
        this.components.onboardingModal = new ModalComponent({
            open: false,
            title: 'Welcome to CongressTracker',
            closable: false,
            closeOnBackdrop: false,
            closeOnEsc: false,
            scrollLock: false, // Don't lock scroll for onboarding - allow users to explore the page
            size: 'lg',
            header: {
                show: false  // We'll use custom content in body
            },
            body: {
                content: this.getOnboardingContent(),
                padding: true
            },
            footer: {
                show: false
            }
        });
        
        // Mount to container
        const container = document.getElementById('onboarding-modal-container') || document.body;
        this.components.onboardingModal.mount(container);

        // Set up onboarding event listeners using event delegation on document
        // This ensures buttons work even after modal content is dynamically updated
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            if (action === 'find-reps') {
                this.handleFindReps();
            } else if (action === 'manual-select') {
                this.handleManualSelect();
            }
        });
    }
    
    /**
     * Get onboarding modal content
     */
    getOnboardingContent() {
        return `
            <div class="onboarding-content">
                <h2 class="onboarding-title">See what your representatives are doing for you.</h2>
                <p class="onboarding-subtitle">Enter your address to personalize your feed with your local representative and senators.</p>
                
                <div class="onboarding-form">
                    <div class="form-group">
                        <input 
                            type="text" 
                            id="onboarding-address-input" 
                            class="form-input form-input--large"
                            placeholder="Enter your street address (e.g., 123 Main St, Anytown, ST 12345)"
                            autocomplete="street-address"
                        >
                    </div>
                    
                    <div class="form-actions">
                        <button 
                            type="button" 
                            class="btn btn--primary btn--large"
                            data-action="find-reps"
                            id="onboarding-find-reps-btn">
                            Find My Representatives
                        </button>
                    </div>
                    
                    <div class="onboarding-alternative">
                        <button 
                            type="button" 
                            class="btn btn--ghost btn--small"
                            data-action="manual-select">
                            Or, select your state and district manually
                        </button>
                    </div>
                    
                    <div class="privacy-note">
                        <small>Your address is only used for finding your district and is not stored on our servers.</small>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Show onboarding modal
     */
    showOnboardingModal() {
        console.log('[Dashboard] showOnboardingModal called, modal exists:', !!this.components.onboardingModal);
        if (this.components.onboardingModal) {
            // Ensure modal has onboarding content (in case it was changed to profile content)
            this.components.onboardingModal.updateBody(this.getOnboardingContent());
            console.log('[Dashboard] Opening onboarding modal...');
            this.components.onboardingModal.open();
        } else {
            console.error('[Dashboard] Onboarding modal component not initialized!');
        }
    }
    
    /**
     * Handle find representatives action
     */
    async handleFindReps() {
        const addressInput = document.getElementById('onboarding-address-input');
        const address = addressInput?.value?.trim();
        
        if (!address) {
            this.showError('Please enter your address');
            
            // Track validation error
            if (typeof analytics !== 'undefined') {
                analytics.track('onboarding_error', {
                    step: 'address_input',
                    error: 'empty_address'
                });
            }
            return;
        }
        
        // Track onboarding attempt
        if (typeof analytics !== 'undefined') {
            analytics.track('onboarding_attempt', {
                step: 'find_representatives',
                addressLength: address.length,
                hasStateCode: /\b[A-Z]{2}\b/.test(address)
            });
        }
        
        const findRepsBtn = document.getElementById('onboarding-find-reps-btn');
        const originalText = findRepsBtn?.textContent;
        const startTime = Date.now();
        
        try {
            // Show loading state
            if (findRepsBtn) {
                findRepsBtn.textContent = 'Finding Representatives...';
                findRepsBtn.disabled = true;
            }
            
            // Call geocoding and representative lookup APIs
            const locationData = await this.geocodeAddress(address);
            const representatives = await this.findRepresentatives(locationData);
            
            // Store results
            this.state.userLocation = locationData;
            this.state.userReps = representatives;
            
            // Save to localStorage
            localStorage.setItem('congress-tracker-location', JSON.stringify(locationData));
            localStorage.setItem('congress-tracker-reps', JSON.stringify(representatives));
            localStorage.setItem('congress-tracker-onboarded', 'true');
            
            // Track successful onboarding
            if (typeof analytics !== 'undefined') {
                analytics.track('onboarding_success', {
                    step: 'representatives_found',
                    representativeCount: representatives.length,
                    state: locationData.state,
                    district: locationData.district,
                    processingTime: Date.now() - startTime,
                    geocodingSource: locationData.source || 'unknown'
                });
            }
            
            // Close onboarding and refresh dashboard
            this.components.onboardingModal.close();
            this.state.hasSeenOnboarding = true;
            
            // Reload dashboard with personalized data
            await this.loadInitialData();
            
            this.showSuccess(`Found ${representatives.length} representatives for your area!`);
            
        } catch (error) {
            console.error('[Dashboard] Error finding representatives:', error);
            
            // Track onboarding error
            if (typeof analytics !== 'undefined') {
                analytics.trackError(error, 'onboarding_find_representatives');
                analytics.track('onboarding_error', {
                    step: 'find_representatives',
                    error: error.message,
                    processingTime: Date.now() - startTime
                });
            }
            
            this.showError('Unable to find representatives. Please try again or select manually.');
        } finally {
            // Restore button state
            if (findRepsBtn) {
                findRepsBtn.textContent = originalText;
                findRepsBtn.disabled = false;
            }
        }
    }
    
    /**
     * Handle manual representative selection - show state/district selector
     */
    handleManualSelect() {
        // Directly update the modal body content in the DOM
        const modalBody = document.querySelector('.modal__body');
        if (modalBody) {
            modalBody.innerHTML = this.getManualSelectContent();
        }

        // Set up event listeners for the manual selection form
        setTimeout(() => {
            const stateSelect = document.getElementById('manual-state-select');
            const districtSelect = document.getElementById('manual-district-select');
            const submitBtn = document.getElementById('manual-submit-btn');
            const backBtn = document.getElementById('manual-back-btn');

            if (stateSelect) {
                stateSelect.addEventListener('change', (e) => this.handleStateChange(e.target.value));
            }
            if (submitBtn) {
                submitBtn.addEventListener('click', () => this.handleManualSubmit());
            }
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    const modalBody = document.querySelector('.modal__body');
                    if (modalBody) {
                        modalBody.innerHTML = this.getOnboardingContent();
                    }
                });
            }
        }, 100);
    }

    /**
     * Get manual selection modal content
     */
    getManualSelectContent() {
        return `
            <div class="onboarding-content">
                <h2 class="onboarding-title">Select Your State & District</h2>
                <p class="onboarding-subtitle">Choose your state and congressional district to see your representatives.</p>

                <div class="onboarding-form">
                    <div class="form-group">
                        <label for="manual-state-select" class="form-label">State</label>
                        <select id="manual-state-select" class="form-select form-select--large">
                            <option value="">Select your state...</option>
                            ${this.getStateOptions()}
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="manual-district-select" class="form-label">Congressional District</label>
                        <select id="manual-district-select" class="form-select form-select--large" disabled>
                            <option value="">First select a state...</option>
                        </select>
                        <small class="form-help">Not sure of your district? <a href="https://www.house.gov/representatives/find-your-representative" target="_blank" rel="noopener">Look it up here</a></small>
                    </div>

                    <div class="form-actions">
                        <button
                            type="button"
                            class="btn btn--primary btn--large"
                            id="manual-submit-btn"
                            disabled>
                            Find My Representatives
                        </button>
                    </div>

                    <div class="onboarding-alternative">
                        <button
                            type="button"
                            class="btn btn--ghost btn--small"
                            id="manual-back-btn">
                            &larr; Back to address lookup
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Get state options for dropdown
     */
    getStateOptions() {
        const states = [
            { code: 'AL', name: 'Alabama', districts: 7 },
            { code: 'AK', name: 'Alaska', districts: 1 },
            { code: 'AZ', name: 'Arizona', districts: 9 },
            { code: 'AR', name: 'Arkansas', districts: 4 },
            { code: 'CA', name: 'California', districts: 52 },
            { code: 'CO', name: 'Colorado', districts: 8 },
            { code: 'CT', name: 'Connecticut', districts: 5 },
            { code: 'DE', name: 'Delaware', districts: 1 },
            { code: 'FL', name: 'Florida', districts: 28 },
            { code: 'GA', name: 'Georgia', districts: 14 },
            { code: 'HI', name: 'Hawaii', districts: 2 },
            { code: 'ID', name: 'Idaho', districts: 2 },
            { code: 'IL', name: 'Illinois', districts: 17 },
            { code: 'IN', name: 'Indiana', districts: 9 },
            { code: 'IA', name: 'Iowa', districts: 4 },
            { code: 'KS', name: 'Kansas', districts: 4 },
            { code: 'KY', name: 'Kentucky', districts: 6 },
            { code: 'LA', name: 'Louisiana', districts: 6 },
            { code: 'ME', name: 'Maine', districts: 2 },
            { code: 'MD', name: 'Maryland', districts: 8 },
            { code: 'MA', name: 'Massachusetts', districts: 9 },
            { code: 'MI', name: 'Michigan', districts: 13 },
            { code: 'MN', name: 'Minnesota', districts: 8 },
            { code: 'MS', name: 'Mississippi', districts: 4 },
            { code: 'MO', name: 'Missouri', districts: 8 },
            { code: 'MT', name: 'Montana', districts: 2 },
            { code: 'NE', name: 'Nebraska', districts: 3 },
            { code: 'NV', name: 'Nevada', districts: 4 },
            { code: 'NH', name: 'New Hampshire', districts: 2 },
            { code: 'NJ', name: 'New Jersey', districts: 12 },
            { code: 'NM', name: 'New Mexico', districts: 3 },
            { code: 'NY', name: 'New York', districts: 26 },
            { code: 'NC', name: 'North Carolina', districts: 14 },
            { code: 'ND', name: 'North Dakota', districts: 1 },
            { code: 'OH', name: 'Ohio', districts: 15 },
            { code: 'OK', name: 'Oklahoma', districts: 5 },
            { code: 'OR', name: 'Oregon', districts: 6 },
            { code: 'PA', name: 'Pennsylvania', districts: 17 },
            { code: 'RI', name: 'Rhode Island', districts: 2 },
            { code: 'SC', name: 'South Carolina', districts: 7 },
            { code: 'SD', name: 'South Dakota', districts: 1 },
            { code: 'TN', name: 'Tennessee', districts: 9 },
            { code: 'TX', name: 'Texas', districts: 38 },
            { code: 'UT', name: 'Utah', districts: 4 },
            { code: 'VT', name: 'Vermont', districts: 1 },
            { code: 'VA', name: 'Virginia', districts: 11 },
            { code: 'WA', name: 'Washington', districts: 10 },
            { code: 'WV', name: 'West Virginia', districts: 2 },
            { code: 'WI', name: 'Wisconsin', districts: 8 },
            { code: 'WY', name: 'Wyoming', districts: 1 },
            { code: 'DC', name: 'District of Columbia', districts: 0 },
            { code: 'PR', name: 'Puerto Rico', districts: 0 },
            { code: 'GU', name: 'Guam', districts: 0 },
            { code: 'VI', name: 'U.S. Virgin Islands', districts: 0 },
            { code: 'AS', name: 'American Samoa', districts: 0 },
            { code: 'MP', name: 'Northern Mariana Islands', districts: 0 }
        ];

        // Store for use in district selection
        this.stateData = states;

        return states.map(s => `<option value="${s.code}" data-districts="${s.districts}">${s.name}</option>`).join('');
    }

    /**
     * Handle state selection change
     */
    handleStateChange(stateCode) {
        const districtSelect = document.getElementById('manual-district-select');
        const submitBtn = document.getElementById('manual-submit-btn');

        if (!stateCode) {
            districtSelect.innerHTML = '<option value="">First select a state...</option>';
            districtSelect.disabled = true;
            submitBtn.disabled = true;
            return;
        }

        const stateInfo = this.stateData?.find(s => s.code === stateCode);
        const numDistricts = stateInfo?.districts || 0;

        if (numDistricts === 0) {
            // Territories with non-voting delegates
            districtSelect.innerHTML = '<option value="0">At-Large (Non-voting Delegate)</option>';
            districtSelect.disabled = true;
            submitBtn.disabled = false;
        } else if (numDistricts === 1) {
            // At-large states
            districtSelect.innerHTML = '<option value="1">At-Large</option>';
            districtSelect.disabled = true;
            submitBtn.disabled = false;
        } else {
            // Multiple districts
            let options = '<option value="">Select your district...</option>';
            for (let i = 1; i <= numDistricts; i++) {
                options += `<option value="${i}">District ${i}</option>`;
            }
            districtSelect.innerHTML = options;
            districtSelect.disabled = false;
            submitBtn.disabled = true;

            // Enable submit when district is selected
            districtSelect.addEventListener('change', () => {
                submitBtn.disabled = !districtSelect.value;
            }, { once: true });
        }
    }

    /**
     * Handle manual selection form submission
     */
    async handleManualSubmit() {
        const stateSelect = document.getElementById('manual-state-select');
        const districtSelect = document.getElementById('manual-district-select');
        const submitBtn = document.getElementById('manual-submit-btn');

        const state = stateSelect?.value;
        const district = districtSelect?.value || '0';

        if (!state) {
            this.showError('Please select a state');
            return;
        }

        const originalText = submitBtn?.textContent;

        try {
            if (submitBtn) {
                submitBtn.textContent = 'Finding Representatives...';
                submitBtn.disabled = true;
            }

            // Create location data from selection
            const locationData = {
                state: state,
                district: district,
                source: 'manual'
            };

            // Look up representatives
            const representatives = await this.findRepresentatives(locationData);

            // Store results
            this.state.userLocation = locationData;
            this.state.userReps = representatives;

            // Save to localStorage
            localStorage.setItem('congress-tracker-location', JSON.stringify(locationData));
            localStorage.setItem('congress-tracker-reps', JSON.stringify(representatives));
            localStorage.setItem('congress-tracker-onboarded', 'true');

            // Close modal and refresh data
            this.components.onboardingModal.close();
            this.state.hasSeenOnboarding = true;

            // Refresh the feed and members module
            await this.loadInitialData();

            // Re-render My Members module with new data
            if (this.components.myMembers) {
                this.components.myMembers.representatives = this.state.userReps;
                this.components.myMembers.render();
            }

        } catch (error) {
            console.error('[Dashboard] Manual selection error:', error);
            this.showError('Failed to find representatives. Please try again.');

            if (submitBtn) {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }
    }
    
    /**
     * Geocode address to get district information
     */
    async geocodeAddress(address) {
        try {
            // First attempt: Try to use a real geocoding service
            // For production, you'd use Google Maps API, MapBox, or similar
            const locationData = await this.performGeocodingLookup(address);
            
            if (locationData) {
                return locationData;
            }
            
            // Fallback: Parse address for state information
            const parsedLocation = this.parseAddressForLocation(address);
            return parsedLocation;
            
        } catch (error) {
            console.warn('[Dashboard] Geocoding failed, using parsed address:', error);
            return this.parseAddressForLocation(address);
        }
    }
    
    /**
     * Perform geocoding lookup using external service
     * Integration with real geocoding service (requires backend /api/geocode endpoint)
     */
    async performGeocodingLookup(address) {
        try {
            // Try to use the backend geocoding service
            const response = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
            const data = await response.json();
            
            if (data.success) {
                return {
                    address: address,
                    state: data.state,
                    district: data.district,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    source: 'geocoding_service'
                };
            }
            
            throw new Error('Geocoding service returned no results');
            
        } catch (error) {
            console.warn('[Dashboard] External geocoding service failed:', error);
            return null;
        }
    }
    
    /**
     * Extract state information from address
     */
    extractStateFromAddress(address) {
        // Common patterns for state identification
        const statePatterns = {
            // Full state names (case insensitive)
            'alabama': { code: 'AL', lat: 32.318, lng: -86.902 },
            'alaska': { code: 'AK', lat: 64.068, lng: -152.193 },
            'arizona': { code: 'AZ', lat: 34.168, lng: -111.930 },
            'arkansas': { code: 'AR', lat: 35.201, lng: -91.831 },
            'california': { code: 'CA', lat: 36.778, lng: -119.417 },
            'colorado': { code: 'CO', lat: 39.113, lng: -105.358 },
            'connecticut': { code: 'CT', lat: 41.767, lng: -72.677 },
            'delaware': { code: 'DE', lat: 38.910, lng: -75.527 },
            'florida': { code: 'FL', lat: 27.766, lng: -81.686 },
            'georgia': { code: 'GA', lat: 33.247, lng: -83.441 },
            'hawaii': { code: 'HI', lat: 21.094, lng: -157.498 },
            'idaho': { code: 'ID', lat: 44.068, lng: -114.742 },
            'illinois': { code: 'IL', lat: 40.633, lng: -89.398 },
            'indiana': { code: 'IN', lat: 40.551, lng: -85.602 },
            'iowa': { code: 'IA', lat: 42.032, lng: -93.581 },
            'kansas': { code: 'KS', lat: 39.011, lng: -98.484 },
            'kentucky': { code: 'KY', lat: 37.839, lng: -84.270 },
            'louisiana': { code: 'LA', lat: 30.391, lng: -92.329 },
            'maine': { code: 'ME', lat: 45.367, lng: -68.972 },
            'maryland': { code: 'MD', lat: 39.045, lng: -76.641 },
            'massachusetts': { code: 'MA', lat: 42.407, lng: -71.382 },
            'michigan': { code: 'MI', lat: 44.182, lng: -84.506 },
            'minnesota': { code: 'MN', lat: 46.392, lng: -94.636 },
            'mississippi': { code: 'MS', lat: 32.354, lng: -89.398 },
            'missouri': { code: 'MO', lat: 38.573, lng: -92.603 },
            'montana': { code: 'MT', lat: 46.965, lng: -109.533 },
            'nebraska': { code: 'NE', lat: 41.493, lng: -99.901 },
            'nevada': { code: 'NV', lat: 39.161, lng: -116.767 },
            'new hampshire': { code: 'NH', lat: 43.193, lng: -71.549 },
            'new jersey': { code: 'NJ', lat: 40.221, lng: -74.756 },
            'new mexico': { code: 'NM', lat: 34.307, lng: -106.018 },
            'new york': { code: 'NY', lat: 43.000, lng: -75.000 },
            'north carolina': { code: 'NC', lat: 35.771, lng: -78.638 },
            'north dakota': { code: 'ND', lat: 47.650, lng: -100.437 },
            'ohio': { code: 'OH', lat: 40.367, lng: -82.996 },
            'oklahoma': { code: 'OK', lat: 35.482, lng: -97.535 },
            'oregon': { code: 'OR', lat: 44.931, lng: -123.029 },
            'pennsylvania': { code: 'PA', lat: 40.269, lng: -76.875 },
            'rhode island': { code: 'RI', lat: 41.677, lng: -71.557 },
            'south carolina': { code: 'SC', lat: 33.836, lng: -81.163 },
            'south dakota': { code: 'SD', lat: 44.445, lng: -100.336 },
            'tennessee': { code: 'TN', lat: 35.860, lng: -86.660 },
            'texas': { code: 'TX', lat: 31.106, lng: -97.563 },
            'utah': { code: 'UT', lat: 39.321, lng: -111.093 },
            'vermont': { code: 'VT', lat: 44.563, lng: -72.580 },
            'virginia': { code: 'VA', lat: 37.926, lng: -78.024 },
            'washington': { code: 'WA', lat: 47.751, lng: -120.740 },
            'west virginia': { code: 'WV', lat: 38.468, lng: -80.954 },
            'wisconsin': { code: 'WI', lat: 44.268, lng: -89.616 },
            'wyoming': { code: 'WY', lat: 43.075, lng: -107.290 }
        };
        
        const addressLower = address.toLowerCase();
        
        // Try to match full state names first
        for (const [stateName, stateInfo] of Object.entries(statePatterns)) {
            if (addressLower.includes(stateName)) {
                return {
                    state: stateInfo.code,
                    latitude: stateInfo.lat + (Math.random() - 0.5) * 2, // Add some variance
                    longitude: stateInfo.lng + (Math.random() - 0.5) * 2
                };
            }
        }
        
        // Try to match state codes
        const stateCodeMatch = address.match(/\b([A-Z]{2})\b/);
        if (stateCodeMatch) {
            const stateCode = stateCodeMatch[1];
            const stateInfo = Object.values(statePatterns).find(s => s.code === stateCode);
            if (stateInfo) {
                return {
                    state: stateCode,
                    latitude: stateInfo.lat + (Math.random() - 0.5) * 2,
                    longitude: stateInfo.lng + (Math.random() - 0.5) * 2
                };
            }
        }
        
        // Default to California if no state found
        return {
            state: 'CA',
            latitude: 36.778 + (Math.random() - 0.5) * 4,
            longitude: -119.417 + (Math.random() - 0.5) * 4
        };
    }
    
    /**
     * Assign a realistic district number based on state
     */
    assignDistrictByState(state) {
        const districtCounts = {
            'CA': 52, 'TX': 38, 'FL': 28, 'NY': 26, 'PA': 17, 'IL': 17, 'OH': 15,
            'MI': 13, 'NC': 14, 'GA': 14, 'NJ': 12, 'VA': 11, 'WA': 10, 'TN': 9,
            'AZ': 9, 'IN': 9, 'MA': 9, 'MD': 8, 'MN': 8, 'MO': 8, 'WI': 8,
            'AL': 7, 'CO': 8, 'SC': 7, 'LA': 6, 'KY': 6, 'OR': 6, 'OK': 5,
            'CT': 5, 'IA': 4, 'AR': 4, 'KS': 4, 'MS': 4, 'NV': 4, 'UT': 4,
            'NE': 3, 'WV': 2, 'ID': 2, 'HI': 2, 'ME': 2, 'NH': 2, 'RI': 2,
            'AK': 1, 'DE': 1, 'MT': 1, 'ND': 1, 'SD': 1, 'VT': 1, 'WY': 1
        };
        
        const maxDistrict = districtCounts[state] || 1;
        return Math.floor(Math.random() * maxDistrict) + 1;
    }
    
    /**
     * Parse address for basic location information (fallback)
     * Note: Without geocoding service, can only extract state - no accurate district mapping
     */
    parseAddressForLocation(address) {
        const stateData = this.extractStateFromAddress(address);
        
        return {
            address: address,
            state: stateData.state,
            district: null, // Cannot determine district without proper geocoding
            latitude: stateData.latitude,
            longitude: stateData.longitude,
            source: 'address_parsing_limited',
            warning: 'District information not available - install geocoding service for complete functionality'
        };
    }
    
    /**
     * Find representatives for a location
     */
    async findRepresentatives(locationData) {
        try {
            const startTime = Date.now();
            const representatives = await congressionalDataService.findRepresentatives(locationData);
            
            // Track API performance
            if (typeof analytics !== 'undefined') {
                analytics.trackAPICall('congressional-data-service/findRepresentatives', Date.now() - startTime, true);
            }
            
            return representatives;
        } catch (error) {
            console.error('[Dashboard] Error finding representatives:', error);
            
            // Track API error
            if (typeof analytics !== 'undefined') {
                analytics.trackAPICall('congressional-data-service/findRepresentatives', 0, false, error.message);
            }
            
            throw error;
        }
    }
    
    /**
     * Initialize Rep Activity Panel - master-detail for representative activities
     */
    initRepActivityPanel() {
        const container = document.getElementById('rep-activity-section');
        if (!container) {
            console.warn('[Dashboard] Rep Activity Panel container not found');
            return;
        }

        // Only initialize if RepActivityPanel class exists
        if (typeof RepActivityPanel === 'undefined') {
            console.warn('[Dashboard] RepActivityPanel class not loaded');
            return;
        }

        this.components.repActivityPanel = new RepActivityPanel({
            container: container
        });
    }

    /**
     * Initialize congressional feed component
     */
    initCongressionalFeed() {
        this.components.congressionalFeed = new CongressionalFeed({
            container: document.getElementById('congressional-feed'),
            userReps: this.state.userReps,
            autoLoad: false
        });
    }
    
    /**
     * Initialize Following Sidebar module
     */
    initFollowingSidebarModule() {
        this.components.followingSidebar = new FollowingSidebarModule({
            container: document.getElementById('following-sidebar')
        });

        // Listen for bill follow/unfollow events to update sidebar
        EventBus.on('bill:followed', (data) => {
            if (this.components.followingSidebar && data.bill) {
                this.components.followingSidebar.addBill(data.bill);
            }
        });

        // Listen for unfollows from other components (e.g., spotlight star)
        EventBus.on('bill:unfollowed', (data) => {
            if (this.components.followingSidebar) {
                const billId = data.billId || data.bill?.id || data.bill?.bill_id;
                if (billId) {
                    this.components.followingSidebar.removeBill(billId);
                }
            }
        });
    }

    /**
     * Initialize Bill Detail Modal (global modal for viewing any bill)
     * Note: Deprecated in favor of BillDetailPanel, kept as fallback
     */
    initBillDetailModal() {
        if (typeof BillDetailModal === 'undefined') {
            console.warn('[Dashboard] BillDetailModal class not loaded');
            return;
        }

        this.components.billDetailModal = new BillDetailModal();

        // Make globally accessible for other components
        window.billDetailModal = this.components.billDetailModal;
    }

    /**
     * Initialize Bill Detail Panel (inline panel replacing modal)
     */
    initBillDetailPanel() {
        const container = document.getElementById('bill-detail-section');
        if (!container) {
            console.warn('[Dashboard] Bill Detail Panel container not found');
            return;
        }

        if (typeof BillDetailPanel === 'undefined') {
            console.warn('[Dashboard] BillDetailPanel class not loaded');
            return;
        }

        this.components.billDetailPanel = new BillDetailPanel({
            container: container
        });

        // Make globally accessible for other components
        window.billDetailPanel = this.components.billDetailPanel;
    }

    /**
     * Initialize How Bills Work interactive modal
     */
    initHowBillsWorkModal() {
        if (typeof HowBillsWorkModal === 'undefined') {
            console.warn('[Dashboard] HowBillsWorkModal class not loaded');
            return;
        }

        this.components.howBillsWorkModal = new HowBillsWorkModal();
    }

    /**
     * Initialize All Bills Panel in sidebar
     */
    initAllBillsPanel() {
        const container = document.getElementById('all-bills-panel');
        if (!container) {
            console.warn('[Dashboard] All Bills Panel container not found');
            return;
        }

        if (typeof AllBillsPanel === 'undefined') {
            console.warn('[Dashboard] AllBillsPanel class not loaded');
            return;
        }

        this.components.allBillsPanel = new AllBillsPanel({
            container: container
        });
    }

    /**
     * Set up global event listeners
     */
    setupEventListeners() {
        // Listen for location changes
        EventBus.on('dashboard:location-set', this.handleLocationSet);

        // Listen for feed refresh requests
        EventBus.on('dashboard:refresh-feed', this.handleFeedRefresh);

        // Listen for bill selection events (from spotlight, tracking, all bills panels)
        EventBus.on(GLOBAL_EVENTS.BILL_SELECTED, this.handleBillSelected.bind(this));

        // Listen for bill:showDetail events (from RepActivityPanel and other sources)
        EventBus.on('bill:showDetail', this.handleBillShowDetail.bind(this));

        // Listen for bill:showDetailWithData events (pre-loaded data)
        EventBus.on('bill:showDetailWithData', this.handleBillShowDetailWithData.bind(this));

        // Listen for bill view close events
        EventBus.on(GLOBAL_EVENTS.BILL_VIEW_CLOSED, this.handleBillViewClosed.bind(this));

        // Learn section - How Bills Work
        document.addEventListener('click', (e) => {
            const learnItem = e.target.closest('[data-learn="how-bills-work"]');
            if (learnItem) {
                e.preventDefault();
                if (this.components.howBillsWorkModal) {
                    this.components.howBillsWorkModal.open();
                }
            }
        });

        // Profile button click - show location/settings
        const profileBtn = document.getElementById('profile-btn');
        console.log('[Dashboard] Setting up profile button:', profileBtn);
        if (profileBtn) {
            profileBtn.addEventListener('click', () => {
                console.log('[Dashboard] Profile button clicked');
                this.handleProfileClick();
            });
        } else {
            console.warn('[Dashboard] Profile button not found in DOM');
        }
    }

    /**
     * Handle profile button click
     * Shows onboarding modal to allow user to update their location
     */
    handleProfileClick() {
        console.log('[Dashboard] handleProfileClick called, userLocation:', this.state.userLocation);
        console.log('[Dashboard] onboardingModal exists:', !!this.components.onboardingModal);

        // If user has location set, show their current info and option to change
        if (this.state.userLocation) {
            // Update modal content to show current location with change option
            if (this.components.onboardingModal) {
                this.components.onboardingModal.updateBody(this.getProfileModalContent());
                this.components.onboardingModal.open();

                // Add event listeners for profile modal buttons (after DOM updates)
                setTimeout(() => {
                    const changeBtn = document.getElementById('change-location-btn');
                    const closeBtn = document.getElementById('close-profile-btn');

                    if (changeBtn) {
                        changeBtn.addEventListener('click', () => {
                            // Switch to onboarding content
                            this.components.onboardingModal.updateBody(this.getOnboardingContent());
                            // Re-setup the find reps button listener
                            this.setupOnboardingButtonListeners();
                        });
                    }

                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => {
                            this.components.onboardingModal.close();
                        });
                    }
                }, 0);
            }
        } else {
            // No location set - show full onboarding
            this.showOnboardingModal();
        }
    }

    /**
     * Setup event listeners for onboarding form buttons
     */
    setupOnboardingButtonListeners() {
        setTimeout(() => {
            const findRepsBtn = document.getElementById('onboarding-find-reps-btn');
            if (findRepsBtn) {
                findRepsBtn.addEventListener('click', () => this.handleFindReps());
            }
        }, 0);
    }

    /**
     * Get profile modal content showing current location with change option
     */
    getProfileModalContent() {
        const location = this.state.userLocation || {};
        const reps = this.state.userReps || [];

        let repsHtml = '';
        if (reps.length > 0) {
            repsHtml = `
                <div class="current-reps">
                    <h4>Your Representatives:</h4>
                    <ul class="reps-list">
                        ${reps.map(rep => `
                            <li class="rep-item">
                                <span class="rep-name">${rep.fullName || rep.firstName + ' ' + rep.lastName}</span>
                                <span class="rep-info">${rep.chamber} - ${rep.partyName || rep.party}${rep.district ? ` - District ${rep.district}` : ''}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        return `
            <div class="profile-modal-content">
                <h3>Your Location</h3>
                <div class="current-location">
                    <p><strong>State:</strong> ${location.stateName || location.state || 'Not set'}</p>
                    ${location.district ? `<p><strong>District:</strong> ${location.district}</p>` : ''}
                </div>
                ${repsHtml}
                <div class="profile-actions">
                    <button class="btn btn--primary" id="change-location-btn">Change Location</button>
                    <button class="btn btn--secondary" id="close-profile-btn">Close</button>
                </div>
            </div>
        `;
    }
    
    /**
     * Load initial dashboard data
     */
    async loadInitialData() {

        this.state.feedLoading = true;
        this.updateLoadingState();

        try {
            // Load feed data in parallel
            const promises = [];

            // Load Upcoming Meetings first (above the fold)
            if (this.components.upcomingMeetings) {
                promises.push(this.components.upcomingMeetings.init());
            }

            // Initialize Rep Activity Panel
            if (this.components.repActivityPanel) {
                promises.push(this.components.repActivityPanel.init());
            }

            if (this.components.congressionalFeed) {
                promises.push(this.components.congressionalFeed.loadFeed());
            }

            if (this.components.followingSidebar) {
                promises.push(this.components.followingSidebar.loadFollowedBills());
            }

            // Initialize All Bills Panel
            if (this.components.allBillsPanel) {
                promises.push(this.components.allBillsPanel.init());
            }

            await Promise.allSettled(promises);

            this.state.feedLoading = false;
            this.state.feedError = null;

        } catch (error) {
            console.error('[Dashboard] Error loading initial data:', error);
            this.state.feedLoading = false;
            this.state.feedError = error.message;
            this.handleError('Failed to load dashboard data', error);
        }

        this.updateLoadingState();
    }
    
    /**
     * Update loading state UI
     */
    updateLoadingState() {
        const feedContainer = document.getElementById('congressional-feed');
        
        if (this.state.feedLoading) {
            if (feedContainer && !feedContainer.querySelector('.loading-message')) {
                feedContainer.innerHTML = `
                    <div class="loading-message">
                        <div class="loading-spinner"></div>
                        <p>Loading your congressional feed...</p>
                    </div>
                `;
            }
        } else if (this.state.feedError) {
            if (feedContainer) {
                feedContainer.innerHTML = `
                    <div class="error-message">
                        <p>Unable to load congressional feed.</p>
                        <button class="btn btn--secondary btn--small" onclick="dashboard.handleFeedRefresh()">
                            Try Again
                        </button>
                    </div>
                `;
            }
        }
    }
    
    /**
     * Handle location set event
     */
    handleLocationSet(locationData) {
        this.state.userLocation = locationData.location;
        this.state.userReps = locationData.representatives;

        // Update components with new data
        if (this.components.congressionalFeed) {
            this.components.congressionalFeed.updateUserReps(this.state.userReps);
        }

        // Reload feed
        this.loadInitialData();
    }
    
    /**
     * Handle feed refresh
     */
    async handleFeedRefresh() {
        await this.loadInitialData();
    }
    
    /**
     * Handle topic click
     */
    handleTopicClick(event) {
        event.preventDefault();
        const topic = event.currentTarget.dataset.topic;
        
        if (topic) {
            // In full implementation, would navigate to topic page
            EventBus.emit('navigation:topic', { topic });
        }
    }
    
    /**
     * Handle bill selection - opens bill in the inline panel (or falls back to modal)
     */
    handleBillSelected(data) {
        const bill = data.bill;
        if (!bill) return;

        // Construct bill ID if not provided
        let billId = bill.id || bill.bill_id || bill.billId;
        if (!billId && bill.congress && bill.type && bill.number) {
            billId = `${bill.congress}-${bill.type.toUpperCase()}-${bill.number}`;
        }
        if (!billId && bill.congress_id && bill.bill_type && bill.bill_number) {
            billId = `${bill.congress_id}-${bill.bill_type.toUpperCase()}-${bill.bill_number}`;
        }

        // Build context from source (for rep action callout)
        const context = data.context || null;

        // Primary: Open in inline panel
        if (this.components.billDetailPanel && billId) {
            this.components.billDetailPanel.showBill(billId, context);
        } else if (window.billDetailPanel && billId) {
            window.billDetailPanel.showBill(billId, context);
        }
        // Fallback: Open in modal if panel not available
        else if (this.components.billDetailModal && billId) {
            this.components.billDetailModal.openWithBillId(billId, context);
        } else if (window.billDetailModal && billId) {
            window.billDetailModal.openWithBillId(billId, context);
        } else {
            console.warn('[Dashboard] Neither BillDetailPanel nor BillDetailModal available, billId:', billId);
        }

        // Emit active bill changed event for highlighting in lists
        if (billId) {
            EventBus.emit(GLOBAL_EVENTS.BILL_ACTIVE_CHANGED, { billId: billId.toUpperCase() });
        }

        // Track bill interaction
        if (typeof analytics !== 'undefined') {
            analytics.trackBillInteraction('view', billId, bill.type || bill.bill_type);
            analytics.track('bill_click', {
                billId: billId,
                billType: bill.type || bill.bill_type,
                source: data.source || 'dashboard',
                billTitle: bill.title?.substring(0, 100)
            });
        }
    }

    /**
     * Handle bill:showDetail event - direct bill ID lookup
     * Emitted by RepActivityPanel and other components
     */
    handleBillShowDetail(data) {
        const { billId, context } = data;
        if (!billId) {
            console.warn('[Dashboard] handleBillShowDetail called without billId');
            return;
        }

        // Open in inline panel
        if (this.components.billDetailPanel) {
            this.components.billDetailPanel.showBill(billId, context);
        } else if (window.billDetailPanel) {
            window.billDetailPanel.showBill(billId, context);
        }
        // Fallback to modal
        else if (this.components.billDetailModal) {
            this.components.billDetailModal.openWithBillId(billId, context);
        } else if (window.billDetailModal) {
            window.billDetailModal.openWithBillId(billId, context);
        } else {
            console.warn('[Dashboard] No bill detail component available');
        }

        // Emit active bill changed event for highlighting in lists
        EventBus.emit(GLOBAL_EVENTS.BILL_ACTIVE_CHANGED, { billId: billId.toUpperCase() });

        // Track interaction
        if (typeof analytics !== 'undefined') {
            analytics.track('bill_show_detail', {
                billId: billId,
                source: context?.source || 'unknown'
            });
        }
    }

    /**
     * Handle bill:showDetailWithData event - pre-loaded bill data
     * For cases where caller already has bill/journey/summary data
     */
    handleBillShowDetailWithData(data) {
        const { bill, journey, summaries, context } = data;
        if (!bill) {
            console.warn('[Dashboard] handleBillShowDetailWithData called without bill data');
            return;
        }

        // Open in inline panel with pre-loaded data
        if (this.components.billDetailPanel && typeof this.components.billDetailPanel.showBillWithData === 'function') {
            this.components.billDetailPanel.showBillWithData(bill, journey, summaries, context);
        } else if (window.billDetailPanel && typeof window.billDetailPanel.showBillWithData === 'function') {
            window.billDetailPanel.showBillWithData(bill, journey, summaries, context);
        }
        // Fallback to standard showBill with just the bill ID
        else {
            const billId = bill.bill_id || bill.id || bill.billId;
            this.handleBillShowDetail({ billId, context });
        }
    }

    /**
     * Handle bill view closed
     * Note: With the modal approach, this is largely unused but kept for compatibility
     */
    handleBillViewClosed() {
        // Modal handles its own close state
        // This handler is kept for any legacy integrations
    }
    
    /**
     * Show success message
     */
    showSuccess(message) {
        if (typeof ErrorHandler !== 'undefined') {
            ErrorHandler.showSuccess(message);
        } else {
        }
    }
    
    /**
     * Show error message
     */
    showError(message) {
        if (typeof ErrorHandler !== 'undefined') {
            ErrorHandler.showError(message);
        } else {
            console.error('[Error]', message);
        }
    }
    
    /**
     * Handle errors with proper logging and user feedback
     */
    handleError(message, error) {
        console.error(`[Dashboard] ${message}:`, error);
        this.showError(message);
    }
    
    /**
     * Cleanup dashboard
     */
    destroy() {
        // Remove event listeners
        EventBus.off('dashboard:location-set', this.handleLocationSet);
        EventBus.off('dashboard:refresh-feed', this.handleFeedRefresh);
        
        // Destroy components
        Object.values(this.components).forEach(component => {
            if (component && typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        
        this.state.isInitialized = false;
    }
}

/**
 * Congressional Feed Component
 * Manages the left column feed of congressional actions
 */
class CongressionalFeed {
    constructor(options = {}) {
        this.container = options.container;
        this.userReps = options.userReps || [];
        this.autoLoad = options.autoLoad !== false;
        
        this.state = {
            actions: [],
            loading: false,
            error: null,
            hasMore: true
        };
        
        if (this.autoLoad) {
            this.loadFeed();
        }
    }
    
    /**
     * Load congressional feed data
     */
    async loadFeed() {
        if (!this.container) return;
        
        this.state.loading = true;
        this.renderLoadingState();
        
        try {
            // In real implementation, would call congress API
            const actions = await this.fetchCongressionalActions();
            
            this.state.actions = actions;
            this.state.loading = false;
            this.state.error = null;
            
            this.renderFeed();
            
        } catch (error) {
            console.error('[CongressionalFeed] Error loading feed:', error);
            this.state.loading = false;
            this.state.error = error.message;
            this.renderErrorState();
        }
    }
    
    /**
     * Fetch congressional actions using data service
     */
    async fetchCongressionalActions() {
        try {
            return await congressionalDataService.getCongressionalActions(this.userReps, {
                limit: 20,
                days: 30
            });
        } catch (error) {
            console.error('[CongressionalFeed] Error fetching actions:', error);
            throw error;
        }
    }
    
    /**
     * Render the congressional feed
     */
    renderFeed() {
        if (!this.container || this.state.actions.length === 0) {
            this.renderEmptyState();
            return;
        }
        
        // Clear container
        this.container.innerHTML = '';
        
        // Create cards for each action
        this.state.actions.forEach(action => {
            const card = new CardComponent({
                legislator: action.legislator,
                action: action.action,
                bill: action.bill,
                llmSnippet: action.llmSnippet,
                clickable: true,
                showPartyBadge: true,
                showTimestamp: true,
                showSnippet: true
            });
            
            card.mount(this.container);
        });
    }
    
    /**
     * Render loading state
     */
    renderLoadingState() {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="feed-loading">
                <div class="loading-spinner"></div>
                <p>Loading your congressional feed...</p>
            </div>
        `;
    }
    
    /**
     * Render error state
     */
    renderErrorState() {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="feed-error">
                <p>Unable to load congressional activities.</p>
                <button class="btn btn--secondary btn--small" onclick="dashboard.components.congressionalFeed.loadFeed()">
                    Try Again
                </button>
            </div>
        `;
    }
    
    /**
     * Render empty state
     */
    renderEmptyState() {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="feed-empty">
                <p>No congressional activities found.</p>
                <p class="text-muted">Try completing the onboarding to see personalized content.</p>
            </div>
        `;
    }
    
    /**
     * Update user representatives
     */
    updateUserReps(representatives) {
        this.userReps = representatives || [];
        this.loadFeed(); // Reload with new data
    }
}

/**
 * My Members Module
 * Shows user's representatives in the sidebar
 */
class MyMembersModule {
    constructor(options = {}) {
        this.container = options.container;
        this.representatives = options.representatives || [];
    }
    
    /**
     * Render the module
     */
    async render() {
        if (!this.container) return;
        
        if (!this.representatives || this.representatives.length === 0) {
            this.renderEmptyState();
            return;
        }
        
        // Clear container
        this.container.innerHTML = '';
        
        // Create member cards
        this.representatives.forEach(rep => {
            const memberCard = this.createMemberCard(rep);
            this.container.appendChild(memberCard);
        });
    }
    
    /**
     * Create a member card element
     */
    createMemberCard(representative) {
        const card = document.createElement('div');
        card.className = 'member-card';

        // Derive title from chamber if not provided
        const title = representative.title || (representative.chamber === 'Senate' ? 'Sen.' : 'Rep.');

        card.innerHTML = `
            <div class="member-card__avatar">
                ${representative.photoUrl ?
                  `<img src="${representative.photoUrl}" alt="${representative.firstName} ${representative.lastName}" />` :
                  `<div class="member-card__avatar-fallback">${representative.firstName?.charAt(0) || ''}${representative.lastName?.charAt(0) || ''}</div>`
                }
            </div>
            <div class="member-card__info">
                <h4 class="member-card__name">${title} ${representative.firstName} ${representative.lastName}</h4>
                <p class="member-card__details">${representative.party} - ${representative.state}${representative.district ? `-${representative.district}` : ''}</p>
            </div>
        `;
        
        // Add click handler
        card.addEventListener('click', () => {
            
            // Track representative interaction
            if (typeof analytics !== 'undefined') {
                analytics.trackRepresentativeInteraction('view', representative.bioguideId || representative.id, representative.chamber);
                analytics.track('representative_click', {
                    representativeId: representative.bioguideId || representative.id,
                    chamber: representative.chamber,
                    party: representative.party,
                    state: representative.state,
                    source: 'my_members_sidebar'
                });
            }
            
            EventBus.emit('navigation:member', { member: representative });
        });
        
        return card;
    }
    
    /**
     * Render empty state
     */
    renderEmptyState() {
        this.container.innerHTML = `
            <div class="module-empty">
                <p>Complete onboarding to see your representatives</p>
            </div>
        `;
    }
    
    /**
     * Update representatives
     */
    updateRepresentatives(representatives) {
        this.representatives = representatives || [];
        this.render();
    }
}

/**
 * Following Sidebar Module
 * Shows bills the user is following with status updates
 */
class FollowingSidebarModule {
    constructor(options = {}) {
        this.container = options.container;
        this.userId = options.userId || this.getUserId();
        this.state = {
            bills: [],
            loading: false,
            error: null
        };
    }

    /**
     * Get or create user ID
     */
    getUserId() {
        let userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) {
            userId = 'user-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('congress-tracker-user-id', userId);
        }
        return userId;
    }

    /**
     * Load followed bills
     */
    async loadFollowedBills() {
        if (!this.container) return;

        this.state.loading = true;
        this.renderLoadingState();

        try {
            const response = await fetch(`/api/db/user/${this.userId}/follows/bills`);
            const data = await response.json();

            if (data.success) {
                this.state.bills = data.bills || [];
            } else {
                this.state.bills = [];
            }

            this.state.loading = false;
            this.state.error = null;
            this.render();

        } catch (error) {
            console.error('[FollowingSidebarModule] Error loading followed bills:', error);
            this.state.loading = false;
            this.state.error = error.message;
            this.renderErrorState();
        }
    }

    /**
     * Render the module
     */
    render() {
        if (!this.container) return;

        if (this.state.bills.length === 0) {
            this.renderEmptyState();
            return;
        }

        this.container.innerHTML = '';

        const billsList = document.createElement('div');
        billsList.className = 'following-bills';

        this.state.bills.forEach(bill => {
            const billItem = this.createBillItem(bill);
            billsList.appendChild(billItem);
        });

        this.container.appendChild(billsList);
    }

    /**
     * Create bill item element
     */
    createBillItem(bill) {
        const item = document.createElement('div');
        item.className = 'following-bill-item';
        item.dataset.billId = bill.bill_id || bill.billId;

        // Format bill number
        const billNumber = this.formatBillNumber(bill);

        // Check if there are recent updates (within last 7 days)
        const hasRecentUpdate = this.hasRecentUpdate(bill);

        item.innerHTML = `
            <div class="following-bill-item__content">
                <div class="following-bill-item__header">
                    <span class="following-bill-item__number">
                        ${billNumber}
                        ${hasRecentUpdate ? '<span class="following-bill-item__badge" title="Recent activity">●</span>' : ''}
                    </span>
                    <span class="following-bill-item__status">${this.getStatusBadge(bill)}</span>
                </div>
                <p class="following-bill-item__title">${this.truncateTitle(bill.title || 'Untitled Bill')}</p>
            </div>
            <button class="following-bill-item__unfollow" data-action="unfollow" data-bill-id="${bill.bill_id || bill.billId}" title="Unfollow">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        `;

        // Add click handler for viewing bill details
        item.querySelector('.following-bill-item__content').addEventListener('click', () => {
            EventBus.emit(GLOBAL_EVENTS.BILL_SELECTED, {
                bill: {
                    id: bill.bill_id || bill.billId,
                    type: bill.bill_type || bill.type,
                    number: bill.bill_number || bill.number,
                    congress: bill.congress,
                    title: bill.title
                },
                source: 'following-sidebar'
            });
        });

        // Add unfollow handler
        item.querySelector('.following-bill-item__unfollow').addEventListener('click', (e) => {
            e.stopPropagation();
            this.unfollowBill(bill.bill_id || bill.billId);
        });

        return item;
    }

    /**
     * Format bill number for display
     */
    formatBillNumber(bill) {
        const type = (bill.bill_type || bill.type || '').toUpperCase();
        const number = bill.bill_number || bill.number || '';
        return `${type} ${number}`;
    }

    /**
     * Check if bill has recent update
     */
    hasRecentUpdate(bill) {
        if (!bill.latest_action_date && !bill.latestActionDate) return false;
        const lastUpdate = new Date(bill.latest_action_date || bill.latestActionDate);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return lastUpdate > sevenDaysAgo;
    }

    /**
     * Truncate title for display
     */
    truncateTitle(title, maxLength = 60) {
        if (title.length <= maxLength) return title;
        return title.substring(0, maxLength).trim() + '...';
    }

    /**
     * Get status badge HTML
     */
    getStatusBadge(bill) {
        // Try to get status from progress_stage first, then compute from latest_action_text
        let status = bill.progress_stage || bill.progressStage;

        if (!status) {
            // Compute from latest action text
            status = this.computeStatusFromAction(bill.latest_action_text || bill.latestActionText);
        }

        const statusConfig = {
            'introduced': { label: 'Introduced', class: 'status--introduced' },
            'in_committee': { label: 'In Committee', class: 'status--committee' },
            'passed_one_chamber': { label: 'Passed Chamber', class: 'status--passed-one' },
            'passed_both_chambers': { label: 'Passed Congress', class: 'status--passed-both' },
            'to_president': { label: 'To President', class: 'status--president' },
            'became_law': { label: 'Became Law', class: 'status--law' },
            'vetoed': { label: 'Vetoed', class: 'status--vetoed' }
        };

        const config = statusConfig[status] || statusConfig.introduced;
        return `<span class="status-badge ${config.class}">${config.label}</span>`;
    }

    /**
     * Compute bill status from latest action text
     */
    computeStatusFromAction(actionText) {
        if (!actionText) return 'introduced';

        const text = actionText.toLowerCase();

        if (text.includes('became public law') || text.includes('signed by president')) {
            return 'became_law';
        } else if (text.includes('vetoed')) {
            return 'vetoed';
        } else if (text.includes('presented to president') || text.includes('sent to president')) {
            return 'to_president';
        } else if ((text.includes('passed house') && text.includes('passed senate')) ||
                   text.includes('passed both') || text.includes('resolving differences')) {
            return 'passed_both_chambers';
        } else if (text.includes('passed house') || text.includes('passed senate') ||
                   text.includes('passed by') || text.includes('agreed to in')) {
            return 'passed_one_chamber';
        } else if (text.includes('committee') || text.includes('referred to')) {
            return 'in_committee';
        }

        return 'introduced';
    }

    /**
     * Unfollow a bill
     */
    async unfollowBill(billId) {
        if (!billId) {
            console.error('[FollowingSidebarModule] Cannot unfollow - billId is missing');
            return;
        }

        try {
            const response = await fetch(`/api/db/user/${this.userId}/follow`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    follow_type: 'bill',
                    target_id: billId
                })
            });

            if (response.ok) {
                // Remove from local state and re-render
                this.state.bills = this.state.bills.filter(b =>
                    (b.bill_id || b.billId) !== billId
                );
                this.render();

                // Emit event for other components
                EventBus.emit('bill:unfollowed', { billId });
            } else {
                const data = await response.json();
                console.error('[FollowingSidebarModule] Failed to unfollow bill:', data);
            }
        } catch (error) {
            console.error('[FollowingSidebarModule] Error unfollowing bill:', error);
        }
    }

    /**
     * Add a bill to following (called externally)
     */
    addBill(bill) {
        // Normalize bill ID - ensure we have bill_id set
        const billId = bill.bill_id || bill.billId || bill.id;

        // Check if already following
        const exists = this.state.bills.some(b =>
            (b.bill_id || b.billId || b.id) === billId
        );

        if (!exists && billId) {
            // Normalize the bill object to ensure bill_id is set
            const normalizedBill = {
                ...bill,
                bill_id: billId
            };
            this.state.bills.unshift(normalizedBill);
            this.render();
        }
    }

    /**
     * Remove a bill from following (called externally via events)
     */
    removeBill(billId) {
        const initialLength = this.state.bills.length;
        this.state.bills = this.state.bills.filter(b =>
            (b.bill_id || b.billId || b.id) !== billId
        );

        // Only re-render if we actually removed something
        if (this.state.bills.length < initialLength) {
            this.render();
        }
    }

    /**
     * Render loading state
     */
    renderLoadingState() {
        this.container.innerHTML = `
            <div class="module-loading">
                <div class="loading-skeleton" style="height: 60px; margin-bottom: 0.5em;"></div>
                <div class="loading-skeleton" style="height: 60px; margin-bottom: 0.5em;"></div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    renderErrorState() {
        this.container.innerHTML = `
            <div class="module-error">
                <p class="text-muted">Unable to load followed bills</p>
            </div>
        `;
    }

    /**
     * Render empty state
     */
    renderEmptyState() {
        this.container.innerHTML = `
            <div class="module-empty following-empty">
                <p class="text-muted">You're not following any bills yet.</p>
                <p class="text-muted text-small">Click the bookmark icon on any bill to follow it.</p>
            </div>
        `;
    }
}

// Create global dashboard instance
const dashboard = new DashboardPage();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DashboardPage,
        CongressionalFeed,
        MyMembersModule,
        FollowingSidebarModule,
        dashboard
    };
} else {
    // Make available globally
    window.DashboardPage = DashboardPage;
    window.CongressionalFeed = CongressionalFeed;
    window.MyMembersModule = MyMembersModule;
    window.FollowingSidebarModule = FollowingSidebarModule;
    window.dashboard = dashboard;
}