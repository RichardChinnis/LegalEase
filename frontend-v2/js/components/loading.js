/**
 * Loading Component - Loading States and Skeleton Loaders
 * 
 * Provides multiple loading state indicators including spinners, skeleton loaders,
 * and inline loading states with proper accessibility announcements.
 * 
 * Features:
 * - Multiple loading variants (spinner, skeleton, pulse, dots)
 * - Different sizes and styles
 * - Accessibility with ARIA live regions
 * - Screen reader announcements
 * - Skeleton loaders that match content structure
 * - Inline and overlay loading states
 * - Custom messages and durations
 * - Integration with existing components
 */

// LoadingComponent assumes BaseComponent and utilities are already loaded
class LoadingComponent extends BaseComponent {
    constructor(props = {}, options = {}) {
        super(props, {
            enableAccessibility: true,
            ...options
        });
        
        // Track loading state changes for announcements
        this.lastAnnouncementTime = 0;
        this.announcementDelay = 1000; // Delay before announcing to screen readers
    }

    /**
     * Get default props
     * @returns {Object} Default props
     */
    getDefaultProps() {
        return {
            // Loading type
            variant: 'spinner', // spinner, skeleton, pulse, dots, bar, inline
            
            // Size options
            size: 'default', // sm, default, lg, xl
            
            // Content and messaging
            message: null, // Custom loading message
            showMessage: true, // Show loading text
            
            // Skeleton-specific options
            skeleton: {
                lines: 3, // Number of skeleton lines
                avatar: false, // Show avatar skeleton
                width: '100%', // Width of skeleton lines
                height: '1rem', // Height of skeleton lines
                animated: true // Animate skeleton
            },
            
            // Spinner-specific options
            spinner: {
                thickness: 2, // Border thickness
                speed: 1, // Animation speed multiplier
                color: null // Custom color
            },
            
            // Overlay options
            overlay: false, // Show as overlay
            backdrop: true, // Show backdrop for overlay
            
            // Behavior
            timeout: null, // Auto-hide after timeout (ms)
            minDuration: 0, // Minimum display duration
            announceDelay: 1000, // Delay before screen reader announcement
            
            // Accessibility
            ariaLabel: null, // Custom aria-label
            ariaLive: 'polite', // ARIA live region level
            role: 'status', // ARIA role
            
            // Custom styling
            className: '',
            style: null // Inline styles object
        };
    }

    /**
     * Get initial state
     * @returns {Object} Initial state
     */
    getInitialState() {
        return {
            visible: true,
            announced: false,
            startTime: Date.now()
        };
    }

    /**
     * Get CSS classes for the component
     * @returns {Array} Array of CSS class names
     */
    getComponentClasses() {
        const classes = ['loading-component'];
        
        // Variant classes
        classes.push(`loading-component--${this.props.variant}`);
        
        // Size classes
        if (this.props.size !== 'default') {
            classes.push(`loading-component--${this.props.size}`);
        }
        
        // Overlay classes
        if (this.props.overlay) {
            classes.push('loading-component--overlay');
            if (this.props.backdrop) {
                classes.push('loading-component--with-backdrop');
            }
        }
        
        // State classes
        if (!this.state.visible) classes.push('loading-component--hidden');
        
        // Custom classes
        if (this.props.className) {
            classes.push(...this.props.className.split(' '));
        }

        return classes.filter(cls => cls);
    }

    /**
     * Generate the component template
     * @returns {string} HTML template
     */
    template() {
        if (!this.state.visible) {
            return '<div class="loading-component loading-component--hidden" aria-hidden="true"></div>';
        }
        
        const { variant, overlay, backdrop, ariaLabel, ariaLive, role, style } = this.props;
        
        const inlineStyles = this.getInlineStyles();
        
        return `
            <div class="${this.getComponentClasses().join(' ')}"
                 role="${role}"
                 aria-live="${ariaLive}"
                 ${ariaLabel ? `aria-label="${ariaLabel}"` : ''}
                 ${inlineStyles ? `style="${inlineStyles}"` : ''}>
                
                ${backdrop && overlay ? '<div class="loading-component__backdrop"></div>' : ''}
                
                <div class="loading-component__content">
                    ${this.renderLoadingIndicator()}
                    ${this.renderMessage()}
                </div>
                
                ${this.renderScreenReaderAnnouncement()}
            </div>
        `;
    }

    /**
     * Get inline styles
     * @returns {string} Inline styles string
     */
    getInlineStyles() {
        if (!this.props.style) return '';
        
        return Object.entries(this.props.style)
            .map(([key, value]) => `${key}: ${value}`)
            .join('; ');
    }

    /**
     * Render the appropriate loading indicator
     * @returns {string} Loading indicator HTML
     */
    renderLoadingIndicator() {
        switch (this.props.variant) {
            case 'spinner':
                return this.renderSpinner();
            case 'skeleton':
                return this.renderSkeleton();
            case 'pulse':
                return this.renderPulse();
            case 'dots':
                return this.renderDots();
            case 'bar':
                return this.renderBar();
            case 'inline':
                return this.renderInline();
            default:
                return this.renderSpinner();
        }
    }

    /**
     * Render spinner loading indicator
     * @returns {string} Spinner HTML
     */
    renderSpinner() {
        const { spinner, size } = this.props;
        
        const sizeMap = {
            sm: 16,
            default: 24,
            lg: 32,
            xl: 48
        };
        
        const spinnerSize = sizeMap[size];
        const thickness = spinner.thickness;
        const color = spinner.color || 'currentColor';
        
        return `
            <div class="loading-spinner" 
                 style="width: ${spinnerSize}px; height: ${spinnerSize}px;">
                <svg class="loading-spinner__svg" 
                     viewBox="0 0 ${spinnerSize} ${spinnerSize}"
                     style="animation-duration: ${1 / spinner.speed}s;">
                    <circle class="loading-spinner__track"
                            cx="${spinnerSize / 2}"
                            cy="${spinnerSize / 2}"
                            r="${(spinnerSize - thickness) / 2}"
                            stroke-width="${thickness}"
                            fill="none"
                            stroke="rgba(0, 0, 0, 0.1)" />
                    <circle class="loading-spinner__progress"
                            cx="${spinnerSize / 2}"
                            cy="${spinnerSize / 2}"
                            r="${(spinnerSize - thickness) / 2}"
                            stroke-width="${thickness}"
                            fill="none"
                            stroke="${color}"
                            stroke-linecap="round" />
                </svg>
            </div>
        `;
    }

    /**
     * Render skeleton loading placeholder
     * @returns {string} Skeleton HTML
     */
    renderSkeleton() {
        const { skeleton } = this.props;
        const skeletonHtml = [];
        
        // Avatar skeleton
        if (skeleton.avatar) {
            skeletonHtml.push(`
                <div class="loading-skeleton loading-skeleton--avatar ${skeleton.animated ? 'loading-skeleton--animated' : ''}"
                     style="width: 48px; height: 48px; border-radius: 50%;">
                </div>
            `);
        }
        
        // Text line skeletons
        for (let i = 0; i < skeleton.lines; i++) {
            const isLastLine = i === skeleton.lines - 1;
            const lineWidth = isLastLine ? '60%' : skeleton.width;
            
            skeletonHtml.push(`
                <div class="loading-skeleton ${skeleton.animated ? 'loading-skeleton--animated' : ''}"
                     style="width: ${lineWidth}; height: ${skeleton.height}; margin-bottom: 0.5rem;">
                </div>
            `);
        }
        
        return `
            <div class="loading-skeleton-container">
                ${skeletonHtml.join('')}
            </div>
        `;
    }

    /**
     * Render pulse loading indicator
     * @returns {string} Pulse HTML
     */
    renderPulse() {
        return `
            <div class="loading-pulse">
                <div class="loading-pulse__dot"></div>
                <div class="loading-pulse__dot"></div>
                <div class="loading-pulse__dot"></div>
            </div>
        `;
    }

    /**
     * Render dots loading indicator
     * @returns {string} Dots HTML
     */
    renderDots() {
        return `
            <div class="loading-dots">
                <span class="loading-dots__dot"></span>
                <span class="loading-dots__dot"></span>
                <span class="loading-dots__dot"></span>
            </div>
        `;
    }

    /**
     * Render progress bar loading indicator
     * @returns {string} Progress bar HTML
     */
    renderBar() {
        return `
            <div class="loading-bar">
                <div class="loading-bar__progress"></div>
            </div>
        `;
    }

    /**
     * Render inline loading indicator (minimal)
     * @returns {string} Inline HTML
     */
    renderInline() {
        return `
            <span class="loading-inline">
                <span class="loading-inline__spinner"></span>
            </span>
        `;
    }

    /**
     * Render loading message
     * @returns {string} Message HTML
     */
    renderMessage() {
        if (!this.props.showMessage) return '';
        
        const message = this.props.message || this.getDefaultMessage();
        
        if (!message) return '';
        
        return `
            <div class="loading-component__message">
                ${message}
            </div>
        `;
    }

    /**
     * Get default loading message based on variant
     * @returns {string} Default message
     */
    getDefaultMessage() {
        const messages = {
            spinner: 'Loading...',
            skeleton: '', // No message for skeleton
            pulse: 'Loading...',
            dots: 'Loading...',
            bar: 'Loading...',
            inline: ''  // No message for inline
        };
        
        return messages[this.props.variant] || 'Loading...';
    }

    /**
     * Render screen reader announcement
     * @returns {string} Screen reader HTML
     */
    renderScreenReaderAnnouncement() {
        const message = this.props.ariaLabel || this.getDefaultMessage() || 'Loading content';
        
        return `
            <div class="sr-only" aria-live="${this.props.ariaLive}">
                ${this.state.announced ? message : ''}
            </div>
        `;
    }

    /**
     * Show the loading component
     * @param {Object} options - Display options
     */
    show(options = {}) {
        // Update props if provided
        if (Object.keys(options).length > 0) {
            this.updateProps(options);
        }
        
        this.setState({ 
            visible: true, 
            announced: false,
            startTime: Date.now()
        });
        
        // Schedule screen reader announcement
        this.scheduleAnnouncement();
        
        // Schedule auto-hide if timeout is set
        if (this.props.timeout) {
            setTimeout(() => {
                this.hide();
            }, this.props.timeout);
        }
    }

    /**
     * Hide the loading component
     * @param {boolean} force - Force hide even if min duration not met
     */
    hide(force = false) {
        const elapsed = Date.now() - this.state.startTime;
        
        if (!force && this.props.minDuration && elapsed < this.props.minDuration) {
            // Wait for minimum duration
            setTimeout(() => {
                this.hide(true);
            }, this.props.minDuration - elapsed);
            return;
        }
        
        this.setState({ visible: false, announced: false });
    }

    /**
     * Update loading message
     * @param {string} message - New message
     */
    updateMessage(message) {
        this.updateProps({ message });
        
        // Re-announce to screen readers
        this.setState({ announced: false });
        this.scheduleAnnouncement();
    }

    /**
     * Schedule screen reader announcement
     */
    scheduleAnnouncement() {
        const now = Date.now();
        
        // Debounce announcements
        if (now - this.lastAnnouncementTime < this.announcementDelay) {
            return;
        }
        
        setTimeout(() => {
            if (this.state.visible && !this.state.announced) {
                this.setState({ announced: true });
                this.lastAnnouncementTime = Date.now();
            }
        }, this.props.announceDelay);
    }

    /**
     * Lifecycle: Component did mount
     */
    componentDidMount() {
        // Schedule initial announcement
        if (this.state.visible) {
            this.scheduleAnnouncement();
        }
    }

    /**
     * Apply accessibility features
     */
    applyAccessibility() {
        super.applyAccessibility();
        
        if (!this.element) return;
        
        // Ensure proper ARIA attributes
        this.element.setAttribute('role', this.props.role);
        this.element.setAttribute('aria-live', this.props.ariaLive);
        
        // Hide from screen readers if not visible
        if (!this.state.visible) {
            this.element.setAttribute('aria-hidden', 'true');
        } else {
            this.element.removeAttribute('aria-hidden');
        }
        
        // Set aria-label if provided
        if (this.props.ariaLabel) {
            this.element.setAttribute('aria-label', this.props.ariaLabel);
        }
    }

    /**
     * Create a loading overlay for an element
     * @param {Element|string} target - Target element or selector
     * @param {Object} options - Loading options
     * @returns {LoadingComponent} Loading component instance
     */
    static createOverlay(target, options = {}) {
        const targetElement = typeof target === 'string' ? 
                             document.querySelector(target) : target;
        
        if (!targetElement) {
            throw new Error('Target element not found');
        }
        
        const loading = new LoadingComponent({
            overlay: true,
            backdrop: true,
            variant: 'spinner',
            size: 'lg',
            ...options
        });
        
        // Position relative to target
        targetElement.style.position = targetElement.style.position || 'relative';
        
        loading.mount(targetElement);
        loading.show();
        
        return loading;
    }

    /**
     * Create inline loading indicator
     * @param {Object} options - Loading options
     * @returns {LoadingComponent} Loading component instance
     */
    static createInline(options = {}) {
        return new LoadingComponent({
            variant: 'inline',
            showMessage: false,
            size: 'sm',
            ...options
        });
    }

    /**
     * Create skeleton loader
     * @param {Object} skeletonOptions - Skeleton configuration
     * @param {Object} options - Component options
     * @returns {LoadingComponent} Loading component instance
     */
    static createSkeleton(skeletonOptions = {}, options = {}) {
        return new LoadingComponent({
            variant: 'skeleton',
            showMessage: false,
            skeleton: {
                lines: 3,
                avatar: false,
                animated: true,
                ...skeletonOptions
            },
            ...options
        });
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LoadingComponent;
} else {
    window.LoadingComponent = LoadingComponent;
}