/**
 * Header Component
 * 
 * Main header with logo, universal search, and user profile icon.
 * Follows NEW_FRONTEND.md specifications for clean, single-row layout.
 */

class Header extends BaseComponent {
    constructor(props = {}, options = {}) {
        super(props, options);
        
        // Initialize child components
        this.searchComponent = null;
    }

    /**
     * Get default props
     */
    getDefaultProps() {
        return {
            logoText: 'Congress Tracker',
            logoHref: '/',
            className: 'header',
            showUserProfile: true
        };
    }

    /**
     * Get initial state
     */
    getInitialState() {
        return {
            isMenuOpen: false,
            userInitials: 'U'
        };
    }

    /**
     * Component lifecycle - mount
     */
    componentDidMount() {
        // Initialize search component
        this.initializeSearch();
        
        // Setup responsive behavior
        this.setupResponsiveBehavior();
        
        // Listen for global events
        this.listenToGlobalEvents();
    }

    /**
     * Initialize search component
     */
    initializeSearch() {
        const searchContainer = this.element.querySelector('.header__search-container');
        if (searchContainer && typeof Search !== 'undefined') {
            this.searchComponent = new Search({
                placeholder: "Search for bills (e.g., 'H.R. 5376'), members, or topics...",
                className: 'header__search'
            }, { debugMode: true });
            
            this.searchComponent.mount(searchContainer);
            this.addChild(this.searchComponent);
        }
    }

    /**
     * Setup responsive behavior
     */
    setupResponsiveBehavior() {
        // Handle mobile menu toggle
        window.addEventListener('resize', this.handleResize.bind(this));
        this.handleResize(); // Initial call
    }

    /**
     * Handle window resize for responsive behavior
     */
    handleResize() {
        const isMobile = window.innerWidth <= 768;
        this.setState({ isMobile });
    }

    /**
     * Listen to global events
     */
    listenToGlobalEvents() {
        // Listen for search selections
        if (typeof EventBus !== 'undefined') {
            EventBus.on('search:select', this.handleSearchSelect.bind(this));
            EventBus.on('navigation:home', this.handleHomeNavigation.bind(this));
        }
    }

    /**
     * Handle search item selection
     */
    handleSearchSelect(data) {
        const { type, item } = data;
        
        switch (type) {
            case 'bill':
                this.navigateToBill(item);
                break;
            case 'member':
                this.navigateToMember(item);
                break;
            case 'topic':
                this.navigateToTopic(item);
                break;
            default:
                console.warn('Unknown search result type:', type);
        }
    }

    /**
     * Navigate to bill page
     */
    navigateToBill(bill) {
        const billId = bill.number || bill.id;
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('navigate:bill', { billId });
        }
        // Fallback URL navigation
        window.location.href = `/bill/${billId}`;
    }

    /**
     * Navigate to member page
     */
    navigateToMember(member) {
        const memberId = member.bioguideId || member.id;
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('navigate:member', { memberId });
        }
        // Fallback URL navigation
        window.location.href = `/member/${memberId}`;
    }

    /**
     * Navigate to topic page
     */
    navigateToTopic(topic) {
        const topicId = topic.id || topic.slug;
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('navigate:topic', { topicId });
        }
        // Fallback URL navigation
        window.location.href = `/topic/${topicId}`;
    }

    /**
     * Handle home navigation
     */
    handleHomeNavigation() {
        window.location.href = this.props.logoHref;
    }

    /**
     * Toggle mobile menu
     */
    toggleMobileMenu() {
        this.setState({ isMenuOpen: !this.state.isMenuOpen });
    }

    /**
     * Handle user profile click
     */
    handleUserProfileClick(event) {
        event.preventDefault();
        
        // For now, just emit an event - can be extended for user menu
        this.emit('user:profile-click');
        
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('user:profile-click');
        }
        
        // TODO: Show user profile dropdown or navigate to profile page
    }

    /**
     * Get event bindings
     */
    getEventBindings() {
        return {
            'click .header__logo': this.handleLogoClick.bind(this),
            'click .header__mobile-toggle': this.toggleMobileMenu.bind(this),
            'click .header__profile': this.handleUserProfileClick.bind(this)
        };
    }

    /**
     * Handle logo click
     */
    handleLogoClick(event) {
        event.preventDefault();
        this.handleHomeNavigation();
    }

    /**
     * Get component CSS classes
     */
    getComponentClasses() {
        const classes = super.getComponentClasses();
        
        if (this.state.isMobile) classes.push('header--mobile');
        if (this.state.isMenuOpen) classes.push('header--menu-open');
        
        return classes;
    }

    /**
     * Component template
     */
    template() {
        const { logoText, showUserProfile } = this.props;
        const { isMobile, isMenuOpen, userInitials } = this.state;

        return `
            <header class="${this.getComponentClasses().join(' ')}" role="banner">
                <div class="header__container">
                    <!-- Logo Section -->
                    <div class="header__logo-section">
                        <a href="${this.props.logoHref}" class="header__logo" aria-label="Go to homepage">
                            <svg class="header__logo-icon" width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L2 7V17L12 22L22 17V7L12 2ZM21 16L12 20.5L3 16V8L12 3.5L21 8V16Z"/>
                                <path d="M12 8L8 10V14L12 16L16 14V10L12 8Z"/>
                            </svg>
                            <span class="header__logo-text">${logoText}</span>
                        </a>
                        
                        ${isMobile ? `
                            <button class="header__mobile-toggle" type="button" aria-label="Toggle navigation menu" aria-expanded="${isMenuOpen}">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                </svg>
                            </button>
                        ` : ''}
                    </div>

                    <!-- Search Section -->
                    <div class="header__search-section ${isMobile && !isMenuOpen ? 'header__search-section--hidden' : ''}">
                        <div class="header__search-container" role="search">
                            <!-- Search component will be mounted here -->
                        </div>
                    </div>

                    <!-- User Profile Section -->
                    ${showUserProfile ? `
                        <div class="header__profile-section ${isMobile && !isMenuOpen ? 'header__profile-section--hidden' : ''}">
                            <button class="header__profile" type="button" aria-label="User profile menu" title="User Profile">
                                <div class="header__profile-avatar">
                                    <span class="header__profile-initials">${userInitials}</span>
                                </div>
                            </button>
                        </div>
                    ` : ''}
                </div>

                <!-- Mobile Search Overlay -->
                ${isMobile && isMenuOpen ? `
                    <div class="header__mobile-overlay">
                        <div class="header__mobile-search">
                            <!-- Mobile search will be cloned here -->
                        </div>
                    </div>
                ` : ''}
            </header>
        `;
    }

    /**
     * Component cleanup
     */
    componentWillUnmount() {
        super.componentWillUnmount();
        
        window.removeEventListener('resize', this.handleResize.bind(this));
        
        if (typeof EventBus !== 'undefined') {
            EventBus.off('search:select', this.handleSearchSelect.bind(this));
            EventBus.off('navigation:home', this.handleHomeNavigation.bind(this));
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Header;
} else {
    window.Header = Header;
}