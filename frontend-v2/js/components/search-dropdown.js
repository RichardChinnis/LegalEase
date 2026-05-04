/**
 * SearchDropdown Component
 * 
 * Categorized search results display with keyboard navigation support.
 * Shows bills, members, topics in organized sections.
 * Follows NEW_FRONTEND.md specifications for search dropdown.
 */

class SearchDropdown extends BaseComponent {
    constructor(props = {}, options = {}) {
        super(props, options);
        
        // Selection tracking
        this.selectedIndex = -1;
        this.flatResults = []; // Flattened results for keyboard navigation
    }

    /**
     * Get default props
     */
    getDefaultProps() {
        return {
            results: [],
            isLoading: false,
            isOpen: false,
            selectedIndex: -1,
            query: '',
            onSelect: null,
            onClose: null,
            className: 'search-dropdown',
            maxHeight: '400px',
            showIcons: true,
            showCategories: true
        };
    }

    /**
     * Get initial state
     */
    getInitialState() {
        return {
            categories: this.categorizeResults(this.props.results),
            selectedIndex: this.props.selectedIndex || -1
        };
    }

    /**
     * Component lifecycle - props update
     */
    componentWillUpdate(nextProps) {
        if (nextProps.results !== this.props.results) {
            this.setState({
                categories: this.categorizeResults(nextProps.results)
            });
        }
        
        if (nextProps.selectedIndex !== this.props.selectedIndex) {
            this.setState({ selectedIndex: nextProps.selectedIndex });
        }
    }

    /**
     * Categorize results by type
     */
    categorizeResults(results) {
        const categories = {
            bills: {
                title: 'Bills',
                icon: '📄',
                items: []
            },
            members: {
                title: 'Members',
                icon: '👤',
                items: []
            },
            topics: {
                title: 'Topics',
                icon: '🏷️',
                items: []
            },
            recent: {
                title: 'Recent Searches',
                icon: '🕒',
                items: []
            }
        };

        results.forEach((result, index) => {
            if (categories[result.type]) {
                categories[result.type].items.push({
                    ...result,
                    flatIndex: index // For keyboard navigation
                });
            }
        });

        // Build flat results array for keyboard navigation
        this.flatResults = results;

        // Filter out empty categories
        Object.keys(categories).forEach(key => {
            if (categories[key].items.length === 0) {
                delete categories[key];
            }
        });

        return categories;
    }

    /**
     * Update selection (called from parent)
     */
    updateSelection(selectedIndex) {
        this.setState({ selectedIndex });
    }

    /**
     * Handle result click
     */
    handleResultClick(event, result) {
        event.preventDefault();
        event.stopPropagation();
        
        if (this.props.onSelect) {
            this.props.onSelect(result);
        }
    }

    /**
     * Handle result mouse enter (for keyboard/mouse coordination)
     */
    handleResultMouseEnter(event, result) {
        const flatIndex = this.flatResults.findIndex(r => r === result);
        if (flatIndex >= 0) {
            this.setState({ selectedIndex: flatIndex });
        }
    }

    /**
     * Get result icon
     */
    getResultIcon(result) {
        const iconMap = {
            bill: '📄',
            member: '👤',
            topic: '🏷️',
            recent: '🕒'
        };

        if (result.icon) {
            return result.icon;
        }

        return iconMap[result.type] || '📄';
    }

    /**
     * Format result title with query highlighting
     */
    formatResultTitle(title, query) {
        if (!query || !title) return this.format.escapeHtml(title);

        const escapedTitle = this.format.escapeHtml(title);
        const escapedQuery = this.format.escapeHtml(query);

        // Simple highlighting - in a real implementation, you might want more sophisticated matching
        const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escapedTitle.replace(regex, '<mark>$1</mark>');
    }

    /**
     * Render no results message
     */
    renderNoResults() {
        const { query, isLoading } = this.props;

        if (isLoading) {
            return `
                <div class="search-dropdown__no-results">
                    <div class="search-dropdown__loading">
                        <div class="spinner"></div>
                        <span>Searching...</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="search-dropdown__no-results">
                <div class="search-dropdown__no-results-icon">🔍</div>
                <div class="search-dropdown__no-results-title">No results found</div>
                <div class="search-dropdown__no-results-subtitle">
                    ${query ? `Try searching for something else` : 'Start typing to search'}
                </div>
            </div>
        `;
    }

    /**
     * Render category section
     */
    renderCategory(categoryKey, category) {
        const { showIcons, showCategories, query } = this.props;
        const { selectedIndex } = this.state;

        return `
            <div class="search-dropdown__category" data-category="${categoryKey}">
                ${showCategories ? `
                    <div class="search-dropdown__category-header">
                        ${showIcons ? `<span class="search-dropdown__category-icon">${category.icon}</span>` : ''}
                        <span class="search-dropdown__category-title">${category.title}</span>
                        <span class="search-dropdown__category-count">${category.items.length}</span>
                    </div>
                ` : ''}
                
                <div class="search-dropdown__category-items">
                    ${category.items.map(result => `
                        <div 
                            class="search-dropdown__result ${selectedIndex === result.flatIndex ? 'search-dropdown__result--selected' : ''}" 
                            data-type="${result.type}"
                            data-index="${result.flatIndex}"
                            role="option"
                            aria-selected="${selectedIndex === result.flatIndex}"
                        >
                            <div class="search-dropdown__result-content">
                                ${showIcons ? `
                                    <div class="search-dropdown__result-icon">
                                        ${result.avatar ? `
                                            <img src="${result.avatar}" alt="${result.title}" class="search-dropdown__result-avatar" />
                                        ` : `
                                            <span class="search-dropdown__result-emoji">${this.getResultIcon(result)}</span>
                                        `}
                                    </div>
                                ` : ''}
                                
                                <div class="search-dropdown__result-details">
                                    <div class="search-dropdown__result-title">
                                        ${this.formatResultTitle(result.title, query)}
                                    </div>
                                    
                                    ${result.subtitle ? `
                                        <div class="search-dropdown__result-subtitle">
                                            ${this.format.escapeHtml(result.subtitle)}
                                        </div>
                                    ` : ''}
                                    
                                    ${result.description ? `
                                        <div class="search-dropdown__result-description">
                                            ${this.format.escapeHtml(result.description)}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            
                            <!-- Action indicator -->
                            <div class="search-dropdown__result-action">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render search suggestions/tips
     */
    renderSearchTips() {
        return `
            <div class="search-dropdown__tips">
                <div class="search-dropdown__tips-title">Search Tips:</div>
                <ul class="search-dropdown__tips-list">
                    <li>Try bill numbers like "H.R. 1234" or "S. 567"</li>
                    <li>Search by member name like "John Smith"</li>
                    <li>Use topic keywords like "healthcare" or "climate"</li>
                </ul>
            </div>
        `;
    }

    /**
     * Get event bindings
     */
    getEventBindings() {
        return {
            'click .search-dropdown__result': this.handleResultClick.bind(this),
            'mouseenter .search-dropdown__result': this.handleResultMouseEnter.bind(this)
        };
    }

    /**
     * Handle result click with proper binding
     */
    handleResultClick(event) {
        const resultElement = event.currentTarget;
        const flatIndex = parseInt(resultElement.dataset.index, 10);
        const result = this.flatResults[flatIndex];
        
        if (result) {
            this.handleResultClick(event, result);
        }
    }

    /**
     * Handle result mouse enter with proper binding
     */
    handleResultMouseEnter(event) {
        const resultElement = event.currentTarget;
        const flatIndex = parseInt(resultElement.dataset.index, 10);
        const result = this.flatResults[flatIndex];
        
        if (result) {
            this.handleResultMouseEnter(event, result);
        }
    }

    /**
     * Get component CSS classes
     */
    getComponentClasses() {
        const classes = super.getComponentClasses();
        
        if (this.props.isOpen) classes.push('search-dropdown--open');
        if (this.props.isLoading) classes.push('search-dropdown--loading');
        if (this.flatResults.length === 0) classes.push('search-dropdown--empty');
        
        return classes;
    }

    /**
     * Component template
     */
    template() {
        const { isOpen, isLoading, maxHeight } = this.props;
        const { categories } = this.state;

        if (!isOpen) {
            return `<div class="${this.getComponentClasses().join(' ')}" style="display: none;"></div>`;
        }

        const hasResults = Object.keys(categories).length > 0;

        return `
            <div 
                class="${this.getComponentClasses().join(' ')}" 
                style="max-height: ${maxHeight}"
                role="listbox"
                aria-label="Search results"
            >
                <div class="search-dropdown__content">
                    ${hasResults || isLoading ? `
                        ${Object.entries(categories).map(([key, category]) => 
                            this.renderCategory(key, category)
                        ).join('')}
                        
                        ${hasResults && !isLoading ? '' : ''}
                    ` : `
                        ${this.renderNoResults()}
                        ${!this.props.query ? this.renderSearchTips() : ''}
                    `}
                </div>
                
                <!-- Keyboard navigation hint -->
                <div class="search-dropdown__footer">
                    <div class="search-dropdown__keyboard-hint">
                        <span class="search-dropdown__key">↑↓</span> navigate
                        <span class="search-dropdown__key">↵</span> select
                        <span class="search-dropdown__key">esc</span> close
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Should component update check
     */
    shouldComponentUpdate(nextProps, nextState) {
        // Update if visibility, results, or selection changes
        return (
            nextProps.isOpen !== this.props.isOpen ||
            nextProps.results !== this.props.results ||
            nextProps.isLoading !== this.props.isLoading ||
            nextProps.selectedIndex !== this.props.selectedIndex ||
            nextProps.query !== this.props.query ||
            nextState.selectedIndex !== this.state.selectedIndex
        );
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SearchDropdown;
} else {
    window.SearchDropdown = SearchDropdown;
}