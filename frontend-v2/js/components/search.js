/**
 * Search Component
 * 
 * Universal search with autocomplete dropdown, keyboard navigation,
 * and integration with Congress API services.
 * Follows NEW_FRONTEND.md specifications for search functionality.
 */

class Search extends BaseComponent {
    constructor(props = {}, options = {}) {
        super(props, options);
        
        // Search state management
        this.searchTimeout = null;
        this.searchController = null;
        this.currentQuery = '';
        this.selectedIndex = -1;
        
        // Child components
        this.dropdownComponent = null;
        
        // Performance tracking
        this.searchCache = new Map();
        this.maxCacheSize = 50;
    }

    /**
     * Get default props
     */
    getDefaultProps() {
        return {
            placeholder: "Search for bills (e.g., 'H.R. 5376'), members, or topics...",
            className: 'search',
            debounceMs: 300,
            minQueryLength: 2,
            maxResults: 10,
            showClearButton: true,
            autoFocus: false
        };
    }

    /**
     * Get initial state
     */
    getInitialState() {
        return {
            query: '',
            isSearching: false,
            isDropdownOpen: false,
            results: [],
            error: null,
            selectedIndex: -1,
            recentSearches: this.loadRecentSearches()
        };
    }

    /**
     * Component lifecycle - mount
     */
    componentDidMount() {
        // Initialize dropdown component
        this.initializeDropdown();
        
        // Setup keyboard navigation
        this.setupKeyboardNavigation();
        
        // Setup click outside behavior
        this.setupClickOutside();
        
        // Auto-focus if specified
        if (this.props.autoFocus) {
            this.focusInput();
        }
    }

    /**
     * Initialize dropdown component
     */
    initializeDropdown() {
        const dropdownContainer = this.element.querySelector('.search__dropdown-container');
        if (dropdownContainer && typeof SearchDropdown !== 'undefined') {
            this.dropdownComponent = new SearchDropdown({
                onSelect: this.handleResultSelect.bind(this),
                onClose: this.handleDropdownClose.bind(this)
            });
            
            this.dropdownComponent.mount(dropdownContainer);
            this.addChild(this.dropdownComponent);
        }
    }

    /**
     * Setup keyboard navigation
     */
    setupKeyboardNavigation() {
        const input = this.element.querySelector('.search__input');
        if (input) {
            input.addEventListener('keydown', this.handleKeyDown.bind(this));
        }
    }

    /**
     * Setup click outside behavior
     */
    setupClickOutside() {
        document.addEventListener('click', this.handleDocumentClick.bind(this));
    }

    /**
     * Handle document click (close dropdown when clicking outside)
     */
    handleDocumentClick(event) {
        if (!this.element.contains(event.target)) {
            this.closeDropdown();
        }
    }

    /**
     * Load recent searches from localStorage
     */
    loadRecentSearches() {
        try {
            const saved = localStorage.getItem('congress-recent-searches');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.warn('Failed to load recent searches:', error);
            return [];
        }
    }

    /**
     * Save recent searches to localStorage
     */
    saveRecentSearches(searches) {
        try {
            localStorage.setItem('congress-recent-searches', JSON.stringify(searches.slice(0, 5)));
        } catch (error) {
            console.warn('Failed to save recent searches:', error);
        }
    }

    /**
     * Add to recent searches
     */
    addToRecentSearches(query) {
        if (!query || query.length < 2) return;
        
        const recent = this.state.recentSearches.filter(s => s !== query);
        recent.unshift(query);
        
        this.setState({ recentSearches: recent });
        this.saveRecentSearches(recent);
    }

    /**
     * Focus the search input
     */
    focusInput() {
        const input = this.element.querySelector('.search__input');
        if (input) {
            input.focus();
        }
    }

    /**
     * Handle input change
     */
    handleInputChange(event) {
        const query = event.target.value;
        this.setState({ query });
        
        // Clear previous timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        
        // If query is too short, close dropdown
        if (query.length < this.props.minQueryLength) {
            this.closeDropdown();
            return;
        }
        
        // Debounce search
        this.searchTimeout = setTimeout(() => {
            this.performSearch(query);
        }, this.props.debounceMs);
    }

    /**
     * Handle input focus
     */
    handleInputFocus() {
        const { query, recentSearches } = this.state;
        
        if (query.length >= this.props.minQueryLength) {
            // Re-open dropdown with current results
            this.setState({ isDropdownOpen: true });
        } else if (recentSearches.length > 0) {
            // Show recent searches
            this.showRecentSearches();
        }
    }

    /**
     * Show recent searches
     */
    showRecentSearches() {
        const recentResults = this.state.recentSearches.map(query => ({
            type: 'recent',
            title: query,
            query: query,
            icon: 'clock'
        }));

        this.setState({
            results: recentResults,
            isDropdownOpen: true
        });

        this.updateDropdown();
    }

    /**
     * Handle keyboard navigation
     */
    handleKeyDown(event) {
        const { isDropdownOpen, results, selectedIndex } = this.state;
        
        if (!isDropdownOpen || results.length === 0) {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.handleEnterKey();
            }
            return;
        }
        
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.navigateDown();
                break;
                
            case 'ArrowUp':
                event.preventDefault();
                this.navigateUp();
                break;
                
            case 'Enter':
                event.preventDefault();
                this.selectCurrentResult();
                break;
                
            case 'Escape':
                event.preventDefault();
                this.closeDropdown();
                break;
                
            case 'Tab':
                // Allow tab to close dropdown
                this.closeDropdown();
                break;
        }
    }

    /**
     * Navigate down in results
     */
    navigateDown() {
        const maxIndex = this.state.results.length - 1;
        const newIndex = this.state.selectedIndex < maxIndex ? this.state.selectedIndex + 1 : 0;
        
        this.setState({ selectedIndex: newIndex });
        this.updateDropdownSelection(newIndex);
    }

    /**
     * Navigate up in results
     */
    navigateUp() {
        const maxIndex = this.state.results.length - 1;
        const newIndex = this.state.selectedIndex > 0 ? this.state.selectedIndex - 1 : maxIndex;
        
        this.setState({ selectedIndex: newIndex });
        this.updateDropdownSelection(newIndex);
    }

    /**
     * Select current highlighted result
     */
    selectCurrentResult() {
        const { results, selectedIndex } = this.state;
        
        if (selectedIndex >= 0 && selectedIndex < results.length) {
            const selectedResult = results[selectedIndex];
            this.handleResultSelect(selectedResult);
        } else {
            this.handleEnterKey();
        }
    }

    /**
     * Handle Enter key when no result is selected
     */
    handleEnterKey() {
        const query = this.state.query.trim();
        if (query) {
            this.addToRecentSearches(query);
            this.performGeneralSearch(query);
        }
    }

    /**
     * Perform general search (fallback)
     */
    performGeneralSearch(query) {
        this.emit('search:general', { query });
        
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('search:general', { query });
        }
        
        this.closeDropdown();
    }

    /**
     * Update dropdown selection highlighting
     */
    updateDropdownSelection(selectedIndex) {
        if (this.dropdownComponent) {
            this.dropdownComponent.updateSelection(selectedIndex);
        }
    }

    /**
     * Perform search API call
     */
    async performSearch(query) {
        // Check cache first
        const cacheKey = query.toLowerCase().trim();
        if (this.searchCache.has(cacheKey)) {
            const cached = this.searchCache.get(cacheKey);
            this.setState({
                results: cached,
                isDropdownOpen: true,
                selectedIndex: -1
            });
            this.updateDropdown();
            return;
        }
        
        this.setState({ isSearching: true, error: null });
        this.currentQuery = query;
        
        // Cancel previous request
        if (this.searchController) {
            this.searchController.abort();
        }
        
        this.searchController = new AbortController();
        
        try {
            const results = await this.searchAPI(query, this.searchController.signal);
            
            // Only update if this is still the current query
            if (this.currentQuery === query) {
                // Cache results
                this.cacheResults(cacheKey, results);
                
                this.setState({
                    results,
                    isSearching: false,
                    isDropdownOpen: true,
                    selectedIndex: -1
                });
                
                this.updateDropdown();
            }
            
        } catch (error) {
            if (error.name !== 'AbortError' && this.currentQuery === query) {
                console.error('Search error:', error);
                this.setState({
                    error: error.message,
                    isSearching: false,
                    results: [],
                    isDropdownOpen: false
                });
            }
        } finally {
            this.searchController = null;
        }
    }

    /**
     * Search API integration - uses /api/db/search endpoint
     */
    async searchAPI(query, signal) {
        try {
            // Build search params - search bills, hearings, and laws
            // Note: members are not supported by the search API
            const searchParams = new URLSearchParams({
                q: query,
                sortBy: 'relevance'
                // Omit contentTypes to search all valid types (bills, hearings, laws, actions)
            });

            const response = await fetch(`/api/db/search?${searchParams}`, {
                signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json();
            const searchResults = data?.data?.results || [];

            // Transform results to dropdown format
            const results = searchResults.map(item => this.transformSearchResult(item));

            // Sort and limit results
            return this.sortAndLimitResults(results);

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Search API error:', error);
            }
            return [];
        }
    }

    /**
     * Transform a search result into dropdown display format
     */
    transformSearchResult(item) {
        // Handle different content types from search results
        const contentType = item.type || item.contentType || 'bill';

        if (contentType === 'member') {
            return {
                type: 'member',
                id: item.bioguideId || item.bioguide_id || item.id,
                title: item.name || `${item.firstName || item.first_name || ''} ${item.lastName || item.last_name || ''}`.trim(),
                subtitle: `${item.state || ''} • ${item.party || ''}`.replace(/^ • | • $/g, ''),
                description: item.chamber === 'House' || item.chamber === 'house' ? 'Representative' : 'Senator',
                url: `/member/${item.bioguideId || item.bioguide_id || item.id}`,
                data: item,
                avatar: item.depiction?.imageUrl || item.imageUrl || item.image_url
            };
        }

        // Default to bill format
        const billType = item.billType || item.bill_type || item.type || '';
        const billNumber = item.billNumber || item.bill_number || item.number || '';
        const congress = item.congress || item.congress_id || 119;
        const displayNumber = billType && billNumber ? `${billType.toUpperCase()} ${billNumber}` : item.bill_id || '';

        return {
            type: 'bill',
            id: item.bill_id || `${congress}-${billType}-${billNumber}`,
            title: item.title || 'Untitled Bill',
            subtitle: `${displayNumber} • ${congress}th Congress`,
            description: item.latestAction?.text || item.latest_action_text || item.summary || '',
            url: this.getBillUrl(item),
            data: item
        };
    }

    /**
     * Get bill URL from item data
     */
    getBillUrl(item) {
        const congress = item.congress || item.congress_id || 119;
        const billType = (item.billType || item.bill_type || item.type || 'hr').toLowerCase();
        const billNumber = item.billNumber || item.bill_number || item.number || '';

        if (billNumber) {
            return `/bill/${congress}/${billType}/${billNumber}`;
        }

        // Fallback: parse from bill_id if available
        if (item.bill_id) {
            const parts = item.bill_id.split('-');
            if (parts.length >= 3) {
                return `/bill/${parts[0]}/${parts[1].toLowerCase()}/${parts[2]}`;
            }
        }

        return '#';
    }

    /**
     * Search bills (legacy method - now uses unified search)
     */
    async searchBills(query, signal) {
        // This method is kept for backwards compatibility but now defers to searchAPI
        return [];
    }

    /**
     * Search members (legacy method - now uses unified search)
     */
    async searchMembers(query, signal) {
        // This method is kept for backwards compatibility but now defers to searchAPI
        return [];
    }

    /**
     * Search topics - returns matching topics from predefined list
     */
    async searchTopics(query, signal) {
        // Topics are not currently in the search API, so we filter locally
        const commonTopics = [
            { id: 'healthcare', name: 'Healthcare', icon: '⚕️' },
            { id: 'environment', name: 'Environment', icon: '🌱' },
            { id: 'economy', name: 'Economy', icon: '💰' },
            { id: 'defense', name: 'Defense', icon: '🛡️' },
            { id: 'education', name: 'Education', icon: '📚' },
            { id: 'immigration', name: 'Immigration', icon: '🌎' }
        ];

        const matchingTopics = commonTopics.filter(topic =>
            topic.name.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 2);

        return matchingTopics.map(topic => ({
            type: 'topic',
            id: topic.id,
            title: topic.name,
            subtitle: 'Topic',
            description: `Bills related to ${topic.name.toLowerCase()}`,
            url: `/topic/${topic.id}`,
            icon: topic.icon,
            data: topic
        }));
    }

    /**
     * Sort and limit search results
     */
    sortAndLimitResults(results) {
        // Sort by type priority: bills, members, topics
        const typePriority = { bill: 0, member: 1, topic: 2, recent: 3 };
        
        results.sort((a, b) => {
            const priorityDiff = typePriority[a.type] - typePriority[b.type];
            if (priorityDiff !== 0) return priorityDiff;
            
            // Secondary sort by relevance (placeholder)
            return a.title.localeCompare(b.title);
        });
        
        return results.slice(0, this.props.maxResults);
    }

    /**
     * Cache search results
     */
    cacheResults(key, results) {
        // Limit cache size
        if (this.searchCache.size >= this.maxCacheSize) {
            const firstKey = this.searchCache.keys().next().value;
            this.searchCache.delete(firstKey);
        }
        
        this.searchCache.set(key, results);
    }

    /**
     * Update dropdown component
     */
    updateDropdown() {
        if (this.dropdownComponent) {
            this.dropdownComponent.updateProps({
                results: this.state.results,
                isLoading: this.state.isSearching,
                isOpen: this.state.isDropdownOpen,
                selectedIndex: this.state.selectedIndex,
                query: this.state.query
            });
        }
    }

    /**
     * Handle result selection
     */
    handleResultSelect(result) {
        if (result.type === 'recent') {
            // Handle recent search selection
            this.setState({ query: result.query });
            this.performSearch(result.query);
            return;
        }
        
        // Add to recent searches
        this.addToRecentSearches(this.state.query);
        
        // Close dropdown
        this.closeDropdown();
        
        // Clear input
        this.setState({ query: '' });
        
        // Emit selection event
        this.emit('search:select', { type: result.type, item: result.data });
        
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('search:select', { type: result.type, item: result.data });
        }
    }

    /**
     * Handle dropdown close
     */
    handleDropdownClose() {
        this.closeDropdown();
    }

    /**
     * Close dropdown
     */
    closeDropdown() {
        this.setState({
            isDropdownOpen: false,
            selectedIndex: -1
        });
        this.updateDropdown();
    }

    /**
     * Clear search
     */
    clearSearch() {
        this.setState({
            query: '',
            results: [],
            isDropdownOpen: false,
            selectedIndex: -1
        });
        
        this.focusInput();
    }

    /**
     * Get event bindings
     */
    getEventBindings() {
        return {
            'input .search__input': this.handleInputChange.bind(this),
            'focus .search__input': this.handleInputFocus.bind(this),
            'click .search__clear': this.clearSearch.bind(this)
        };
    }

    /**
     * Get component CSS classes
     */
    getComponentClasses() {
        const classes = super.getComponentClasses();
        
        if (this.state.isDropdownOpen) classes.push('search--open');
        if (this.state.isSearching) classes.push('search--searching');
        if (this.state.query) classes.push('search--has-query');
        
        return classes;
    }

    /**
     * Component template
     */
    template() {
        const { placeholder, showClearButton } = this.props;
        const { query, isSearching, isDropdownOpen } = this.state;

        return `
            <div class="${this.getComponentClasses().join(' ')}" role="combobox" aria-expanded="${isDropdownOpen}" aria-haspopup="listbox">
                <div class="search__input-container">
                    <!-- Search Icon -->
                    <svg class="search__icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M21 21L16.514 16.506M19 10.5C19 15.194 15.194 19 10.5 19S2 15.194 2 10.5 5.806 2 10.5 2 19 5.806 19 10.5Z" 
                              stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
                    </svg>
                    
                    <!-- Search Input -->
                    <input 
                        type="text" 
                        class="search__input" 
                        placeholder="${placeholder}"
                        value="${this.format.text.escapeHtml(query)}"
                        aria-label="Search congress data"
                        aria-autocomplete="list"
                        aria-describedby="search-help"
                        spellcheck="false"
                        autocomplete="off"
                        role="searchbox"
                    />
                    
                    <!-- Loading Spinner -->
                    ${isSearching ? `
                        <div class="search__loading" aria-label="Searching">
                            <div class="spinner"></div>
                        </div>
                    ` : ''}
                    
                    <!-- Clear Button -->
                    ${showClearButton && query ? `
                        <button type="button" class="search__clear" aria-label="Clear search" title="Clear search">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
                
                <!-- Dropdown Container -->
                <div class="search__dropdown-container">
                    <!-- SearchDropdown component will be mounted here -->
                </div>
                
                <!-- Screen Reader Help -->
                <div id="search-help" class="sr-only">
                    Use arrow keys to navigate search results, Enter to select, Escape to close.
                </div>
            </div>
        `;
    }

    /**
     * Component cleanup
     */
    componentWillUnmount() {
        super.componentWillUnmount();
        
        // Clear timeouts
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        
        // Abort ongoing requests
        if (this.searchController) {
            this.searchController.abort();
        }
        
        // Remove event listeners
        document.removeEventListener('click', this.handleDocumentClick.bind(this));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Search;
} else {
    window.Search = Search;
}