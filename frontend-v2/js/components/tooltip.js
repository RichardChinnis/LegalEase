/**
 * Tooltip Component - Contextual Help Tooltips
 * 
 * A fully featured tooltip component with smart positioning, keyboard navigation,
 * accessibility features, and mobile support. Provides contextual help throughout
 * the application.
 * 
 * Features:
 * - Smart positioning with collision detection
 * - Keyboard navigation and focus management  
 * - Touch support for mobile devices
 * - ARIA attributes for accessibility
 * - Multiple trigger methods (hover, click, focus, manual)
 * - Rich content support (HTML, components)
 * - Animation and theming options
 * - Multiple attachment strategies
 * - Delay and timing controls
 */

// TooltipComponent assumes BaseComponent and utilities are already loaded
class TooltipComponent extends BaseComponent {
    constructor(props = {}, options = {}) {
        super(props, {
            enableAccessibility: true,
            autoRender: false, // Tooltips render on demand
            ...options
        });
        
        // Position management
        this.positionCache = null;
        this.repositionAnimationFrame = null;
        
        // Event management
        this.boundHandleScroll = this.handleScroll.bind(this);
        this.boundHandleResize = this.handleResize.bind(this);
        this.boundHandleKeydown = this.handleKeydown.bind(this);
        this.boundHandleDocumentClick = this.handleDocumentClick.bind(this);
        
        // Timer management
        this.showTimer = null;
        this.hideTimer = null;
        
        // Touch handling
        this.touchStartTime = 0;
        this.touchMoved = false;
        
        // Target element reference
        this.targetElement = null;
    }

    /**
     * Get default props
     * @returns {Object} Default props
     */
    getDefaultProps() {
        return {
            // Content
            content: '', // Tooltip content (HTML string)
            title: null, // Optional title
            
            // Positioning
            position: 'top', // top, bottom, left, right, auto
            alignment: 'center', // start, center, end
            offset: 8, // Distance from target element
            
            // Trigger behavior
            trigger: 'hover', // hover, click, focus, manual
            showDelay: 500, // Delay before showing (ms)
            hideDelay: 100, // Delay before hiding (ms)
            
            // Interaction
            interactive: false, // Allow interaction with tooltip content
            closeOnClickInside: false, // Close when clicking inside tooltip
            closeOnEscape: true, // Close when pressing ESC
            
            // Display options
            arrow: true, // Show arrow pointer
            maxWidth: '200px', // Maximum width
            theme: 'default', // default, dark, light, error, warning, info
            animation: 'fade', // fade, scale, slide, none
            
            // Mobile behavior
            touchBehavior: 'auto', // auto, hover, click, disabled
            longPressDelay: 500, // Long press duration for mobile
            
            // Accessibility
            ariaLabel: null, // Custom aria-label for trigger
            role: 'tooltip', // ARIA role
            describedBy: true, // Use aria-describedby
            
            // Advanced options
            boundary: 'viewport', // viewport, window, element, or Element
            fallbackPlacements: null, // Array of fallback positions
            preventOverflow: true, // Prevent tooltip overflow
            
            // Events
            onShow: null, // Callback when shown
            onHide: null, // Callback when hidden
            onPosition: null, // Callback when positioned
            
            // Target element
            target: null, // Target element or selector
            
            // Custom styling
            className: '',
            style: null
        };
    }

    /**
     * Get initial state
     * @returns {Object} Initial state
     */
    getInitialState() {
        return {
            visible: false,
            positioned: false,
            currentPosition: this.props.position,
            currentAlignment: this.props.alignment
        };
    }

    /**
     * Get CSS classes for the tooltip
     * @returns {Array} Array of CSS class names
     */
    getComponentClasses() {
        const classes = ['tooltip-component'];
        
        // Position classes
        classes.push(`tooltip-component--${this.state.currentPosition}`);
        classes.push(`tooltip-component--${this.state.currentAlignment}`);
        
        // Theme classes
        classes.push(`tooltip-component--${this.props.theme}`);
        
        // Animation classes
        if (this.props.animation !== 'none') {
            classes.push(`tooltip-component--${this.props.animation}`);
        }
        
        // State classes
        if (this.state.visible) classes.push('tooltip-component--visible');
        if (this.state.positioned) classes.push('tooltip-component--positioned');
        if (this.props.interactive) classes.push('tooltip-component--interactive');
        if (!this.props.arrow) classes.push('tooltip-component--no-arrow');
        
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
        const { content, title, role, maxWidth, style } = this.props;
        
        if (!this.state.visible && !this.isAnimating) {
            return '<div class="tooltip-container" style="display: none;"></div>';
        }
        
        const inlineStyles = this.getInlineStyles();
        
        return `
            <div class="tooltip-container" style="display: block;">
                <div class="${this.getComponentClasses().join(' ')}"
                     role="${role}"
                     data-tooltip-id="${this.instanceId}"
                     ${inlineStyles ? `style="${inlineStyles}"` : ''}>
                    
                    <!-- Arrow -->
                    ${this.props.arrow ? this.renderArrow() : ''}
                    
                    <!-- Content -->
                    <div class="tooltip-component__content" style="max-width: ${maxWidth};">
                        ${title ? this.renderTitle() : ''}
                        <div class="tooltip-component__body">
                            ${content}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Get inline styles for positioning
     * @returns {string} Inline styles string
     */
    getInlineStyles() {
        const styles = [];
        
        if (this.props.style) {
            Object.entries(this.props.style).forEach(([key, value]) => {
                styles.push(`${key}: ${value}`);
            });
        }
        
        // Add positioning styles if calculated
        if (this.positionCache && this.state.positioned) {
            styles.push(`left: ${this.positionCache.x}px`);
            styles.push(`top: ${this.positionCache.y}px`);
            styles.push('position: absolute');
            styles.push('z-index: var(--z-tooltip, 1050)');
        }
        
        return styles.join('; ');
    }

    /**
     * Render tooltip arrow
     * @returns {string} Arrow HTML
     */
    renderArrow() {
        return `
            <div class="tooltip-component__arrow" 
                 data-position="${this.state.currentPosition}"
                 aria-hidden="true">
            </div>
        `;
    }

    /**
     * Render tooltip title
     * @returns {string} Title HTML
     */
    renderTitle() {
        return `
            <div class="tooltip-component__title">
                ${this.props.title}
            </div>
        `;
    }

    /**
     * Get event bindings
     * @returns {Object} Event bindings
     */
    getEventBindings() {
        const events = {};
        
        if (this.props.interactive) {
            events['mouseenter'] = 'handleTooltipMouseEnter';
            events['mouseleave'] = 'handleTooltipMouseLeave';
            events['focusin'] = 'handleTooltipFocusIn';
            events['focusout'] = 'handleTooltipFocusOut';
            
            if (this.props.closeOnClickInside) {
                events['click'] = 'handleTooltipClick';
            }
        }
        
        return events;
    }

    /**
     * Attach tooltip to target element
     * @param {Element|string} target - Target element or selector
     */
    attach(target) {
        // Find target element
        this.targetElement = typeof target === 'string' ? 
                            document.querySelector(target) : target;
        
        if (!this.targetElement) {
            throw new Error(`Tooltip target not found: ${target}`);
        }
        
        // Update target in props
        this.updateProps({ target });
        
        // Attach event listeners to target
        this.attachTargetEvents();
        
        // Setup accessibility
        this.setupTargetAccessibility();
    }

    /**
     * Attach event listeners to target element
     */
    attachTargetEvents() {
        if (!this.targetElement) return;
        
        const { trigger, touchBehavior } = this.props;
        
        // Remove existing listeners
        this.detachTargetEvents();
        
        // Attach based on trigger type
        switch (trigger) {
            case 'hover':
                this.targetElement.addEventListener('mouseenter', this.handleTargetMouseEnter.bind(this));
                this.targetElement.addEventListener('mouseleave', this.handleTargetMouseLeave.bind(this));
                this.targetElement.addEventListener('focusin', this.handleTargetFocusIn.bind(this));
                this.targetElement.addEventListener('focusout', this.handleTargetFocusOut.bind(this));
                break;
                
            case 'click':
                this.targetElement.addEventListener('click', this.handleTargetClick.bind(this));
                break;
                
            case 'focus':
                this.targetElement.addEventListener('focusin', this.handleTargetFocusIn.bind(this));
                this.targetElement.addEventListener('focusout', this.handleTargetFocusOut.bind(this));
                break;
        }
        
        // Touch events for mobile
        if (touchBehavior !== 'disabled') {
            this.targetElement.addEventListener('touchstart', this.handleTargetTouchStart.bind(this), { passive: true });
            this.targetElement.addEventListener('touchmove', this.handleTargetTouchMove.bind(this), { passive: true });
            this.targetElement.addEventListener('touchend', this.handleTargetTouchEnd.bind(this), { passive: true });
        }
        
        // Keyboard navigation
        this.targetElement.addEventListener('keydown', this.handleTargetKeydown.bind(this));
    }

    /**
     * Detach event listeners from target element
     */
    detachTargetEvents() {
        if (!this.targetElement) return;
        
        // Create a new element to get all possible event types
        const events = ['mouseenter', 'mouseleave', 'click', 'focusin', 'focusout', 
                       'touchstart', 'touchmove', 'touchend', 'keydown'];
        
        events.forEach(event => {
            this.targetElement.removeEventListener(event, this[`handleTarget${event.charAt(0).toUpperCase() + event.slice(1)}`]);
        });
    }

    /**
     * Setup accessibility attributes on target
     */
    setupTargetAccessibility() {
        if (!this.targetElement) return;
        
        const tooltipId = `tooltip-${this.instanceId}`;
        
        // Set up aria-describedby relationship
        if (this.props.describedBy) {
            const existingDescribedBy = this.targetElement.getAttribute('aria-describedby');
            const describedBy = existingDescribedBy ? 
                              `${existingDescribedBy} ${tooltipId}` : 
                              tooltipId;
            
            this.targetElement.setAttribute('aria-describedby', describedBy);
        }
        
        // Set custom aria-label if provided
        if (this.props.ariaLabel) {
            this.targetElement.setAttribute('aria-label', this.props.ariaLabel);
        }
        
        // Ensure focusable if needed
        if (this.props.trigger === 'focus' && this.targetElement.tabIndex < 0) {
            this.targetElement.tabIndex = 0;
        }
    }

    /**
     * Target event handlers
     */
    handleTargetMouseEnter() {
        this.clearHideTimer();
        this.scheduleShow();
    }

    handleTargetMouseLeave() {
        if (!this.props.interactive) {
            this.clearShowTimer();
            this.scheduleHide();
        }
    }

    handleTargetClick(e) {
        e.preventDefault();
        
        if (this.state.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    handleTargetFocusIn() {
        this.clearHideTimer();
        this.scheduleShow();
    }

    handleTargetFocusOut() {
        if (!this.props.interactive) {
            this.clearShowTimer();
            this.scheduleHide();
        }
    }

    handleTargetKeydown(e) {
        if (e.key === 'Escape' && this.props.closeOnEscape) {
            this.hide();
            this.targetElement.focus();
        }
    }

    handleTargetTouchStart(e) {
        this.touchStartTime = Date.now();
        this.touchMoved = false;
        
        // Schedule long press
        if (this.props.touchBehavior === 'auto' || this.props.touchBehavior === 'hover') {
            this.longPressTimer = setTimeout(() => {
                if (!this.touchMoved) {
                    this.show();
                }
            }, this.props.longPressDelay);
        }
    }

    handleTargetTouchMove() {
        this.touchMoved = true;
        
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }

    handleTargetTouchEnd(e) {
        const touchDuration = Date.now() - this.touchStartTime;
        
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        
        // Handle as click if short tap
        if (!this.touchMoved && touchDuration < this.props.longPressDelay) {
            if (this.props.touchBehavior === 'click' || 
                (this.props.touchBehavior === 'auto' && this.props.trigger === 'click')) {
                this.handleTargetClick(e);
            }
        }
    }

    /**
     * Tooltip event handlers (for interactive tooltips)
     */
    handleTooltipMouseEnter() {
        this.clearHideTimer();
    }

    handleTooltipMouseLeave() {
        this.scheduleHide();
    }

    handleTooltipFocusIn() {
        this.clearHideTimer();
    }

    handleTooltipFocusOut() {
        this.scheduleHide();
    }

    handleTooltipClick() {
        if (this.props.closeOnClickInside) {
            this.hide();
        }
    }

    /**
     * Global event handlers
     */
    handleKeydown(e) {
        if (e.key === 'Escape' && this.props.closeOnEscape && this.state.visible) {
            this.hide();
            if (this.targetElement) {
                this.targetElement.focus();
            }
        }
    }

    handleDocumentClick(e) {
        if (!this.state.visible) return;
        
        // Hide if clicking outside tooltip and target
        if (this.element && !this.element.contains(e.target) && 
            this.targetElement && !this.targetElement.contains(e.target)) {
            this.hide();
        }
    }

    handleScroll() {
        if (this.state.visible) {
            this.updatePosition();
        }
    }

    handleResize() {
        if (this.state.visible) {
            this.updatePosition();
        }
    }

    /**
     * Timer management
     */
    scheduleShow() {
        this.clearShowTimer();
        
        if (this.props.showDelay > 0) {
            this.showTimer = setTimeout(() => {
                this.show();
            }, this.props.showDelay);
        } else {
            this.show();
        }
    }

    scheduleHide() {
        this.clearHideTimer();
        
        if (this.props.hideDelay > 0) {
            this.hideTimer = setTimeout(() => {
                this.hide();
            }, this.props.hideDelay);
        } else {
            this.hide();
        }
    }

    clearShowTimer() {
        if (this.showTimer) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
    }

    clearHideTimer() {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    /**
     * Show tooltip
     * @param {Object} options - Show options
     */
    show(options = {}) {
        if (this.state.visible) return;
        
        // Update options if provided
        if (Object.keys(options).length > 0) {
            this.updateProps(options);
        }
        
        // Render tooltip
        this.render();
        
        // Mount to body if not mounted
        if (!this.isMounted) {
            this.mount(document.body);
        }
        
        // Set visible state
        this.setState({ visible: true });
        
        // Position tooltip
        this.position();
        
        // Add global event listeners
        this.addGlobalListeners();
        
        // Emit show event
        this.emit('show');
        if (this.props.onShow) {
            this.props.onShow();
        }
    }

    /**
     * Hide tooltip
     */
    hide() {
        if (!this.state.visible) return;
        
        this.setState({ visible: false, positioned: false });
        
        // Remove global event listeners
        this.removeGlobalListeners();
        
        // Clear position cache
        this.positionCache = null;
        
        // Emit hide event
        this.emit('hide');
        if (this.props.onHide) {
            this.props.onHide();
        }
        
        // Re-render to hide
        setTimeout(() => this.render(), 0);
    }

    /**
     * Toggle tooltip visibility
     */
    toggle() {
        if (this.state.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Add global event listeners
     */
    addGlobalListeners() {
        document.addEventListener('keydown', this.boundHandleKeydown, true);
        document.addEventListener('click', this.boundHandleDocumentClick, true);
        window.addEventListener('scroll', this.boundHandleScroll, true);
        window.addEventListener('resize', this.boundHandleResize);
    }

    /**
     * Remove global event listeners
     */
    removeGlobalListeners() {
        document.removeEventListener('keydown', this.boundHandleKeydown, true);
        document.removeEventListener('click', this.boundHandleDocumentClick, true);
        window.removeEventListener('scroll', this.boundHandleScroll, true);
        window.removeEventListener('resize', this.boundHandleResize);
    }

    /**
     * Position tooltip relative to target
     */
    position() {
        if (!this.targetElement || !this.element) return;
        
        const tooltip = this.element.querySelector('.tooltip-component');
        if (!tooltip) return;
        
        // Get target and tooltip dimensions
        const targetRect = this.targetElement.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate optimal position
        const position = this.calculateOptimalPosition(targetRect, tooltipRect, viewportWidth, viewportHeight);
        
        // Cache position
        this.positionCache = position;
        
        // Update state
        this.setState({
            positioned: true,
            currentPosition: position.placement,
            currentAlignment: position.alignment
        });
        
        // Apply position
        this.render();
        
        // Emit position event
        if (this.props.onPosition) {
            this.props.onPosition(position);
        }
    }

    /**
     * Calculate optimal tooltip position
     * @param {DOMRect} targetRect - Target element bounds
     * @param {DOMRect} tooltipRect - Tooltip element bounds
     * @param {number} viewportWidth - Viewport width
     * @param {number} viewportHeight - Viewport height
     * @returns {Object} Position data
     */
    calculateOptimalPosition(targetRect, tooltipRect, viewportWidth, viewportHeight) {
        const { position, alignment, offset, preventOverflow, fallbackPlacements } = this.props;
        
        let bestPosition = position;
        let bestAlignment = alignment;
        let bestScore = -1;
        
        // Try requested position first, then fallbacks
        const positionsToTry = position === 'auto' ? 
                              ['top', 'bottom', 'left', 'right'] :
                              [position, ...(fallbackPlacements || [])];
        
        for (const pos of positionsToTry) {
            for (const align of ['start', 'center', 'end']) {
                const coords = this.calculatePosition(targetRect, tooltipRect, pos, align, offset);
                const score = this.scorePosition(coords, tooltipRect, viewportWidth, viewportHeight);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPosition = pos;
                    bestAlignment = align;
                    
                    // Perfect score found
                    if (score === 100) break;
                }
            }
            
            if (bestScore === 100) break;
        }
        
        // Calculate final coordinates
        const finalCoords = this.calculatePosition(targetRect, tooltipRect, bestPosition, bestAlignment, offset);
        
        // Apply overflow prevention
        if (preventOverflow) {
            finalCoords.x = Math.max(8, Math.min(finalCoords.x, viewportWidth - tooltipRect.width - 8));
            finalCoords.y = Math.max(8, Math.min(finalCoords.y, viewportHeight - tooltipRect.height - 8));
        }
        
        return {
            x: finalCoords.x,
            y: finalCoords.y,
            placement: bestPosition,
            alignment: bestAlignment,
            score: bestScore
        };
    }

    /**
     * Calculate position coordinates
     * @param {DOMRect} targetRect - Target bounds
     * @param {DOMRect} tooltipRect - Tooltip bounds
     * @param {string} pos - Position
     * @param {string} align - Alignment
     * @param {number} offset - Offset distance
     * @returns {Object} Coordinates
     */
    calculatePosition(targetRect, tooltipRect, pos, align, offset) {
        let x, y;
        
        // Calculate base position
        switch (pos) {
            case 'top':
                x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
                y = targetRect.top - tooltipRect.height - offset;
                break;
                
            case 'bottom':
                x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
                y = targetRect.bottom + offset;
                break;
                
            case 'left':
                x = targetRect.left - tooltipRect.width - offset;
                y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
                break;
                
            case 'right':
                x = targetRect.right + offset;
                y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
                break;
        }
        
        // Apply alignment adjustments
        if (pos === 'top' || pos === 'bottom') {
            switch (align) {
                case 'start':
                    x = targetRect.left;
                    break;
                case 'end':
                    x = targetRect.right - tooltipRect.width;
                    break;
            }
        } else if (pos === 'left' || pos === 'right') {
            switch (align) {
                case 'start':
                    y = targetRect.top;
                    break;
                case 'end':
                    y = targetRect.bottom - tooltipRect.height;
                    break;
            }
        }
        
        return { x, y };
    }

    /**
     * Score position quality (0-100)
     * @param {Object} coords - Position coordinates
     * @param {DOMRect} tooltipRect - Tooltip bounds
     * @param {number} viewportWidth - Viewport width
     * @param {number} viewportHeight - Viewport height
     * @returns {number} Position score
     */
    scorePosition(coords, tooltipRect, viewportWidth, viewportHeight) {
        const margin = 8;
        let score = 100;
        
        // Check viewport boundaries
        if (coords.x < margin) score -= 25;
        if (coords.y < margin) score -= 25;
        if (coords.x + tooltipRect.width > viewportWidth - margin) score -= 25;
        if (coords.y + tooltipRect.height > viewportHeight - margin) score -= 25;
        
        return Math.max(0, score);
    }

    /**
     * Update tooltip position (for scroll/resize)
     */
    updatePosition() {
        if (this.repositionAnimationFrame) {
            cancelAnimationFrame(this.repositionAnimationFrame);
        }
        
        this.repositionAnimationFrame = requestAnimationFrame(() => {
            this.position();
        });
    }

    /**
     * Update tooltip content
     * @param {string} content - New content
     * @param {Object} options - Additional options
     */
    updateContent(content, options = {}) {
        this.updateProps({ content, ...options });
        
        if (this.state.visible) {
            this.position(); // Reposition in case size changed
        }
    }

    /**
     * Lifecycle: Component will unmount
     */
    componentWillUnmount() {
        // Clear timers
        this.clearShowTimer();
        this.clearHideTimer();
        
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
        }
        
        if (this.repositionAnimationFrame) {
            cancelAnimationFrame(this.repositionAnimationFrame);
        }
        
        // Remove global listeners
        this.removeGlobalListeners();
        
        // Detach from target
        this.detachTargetEvents();
    }

    /**
     * Apply accessibility features
     */
    applyAccessibility() {
        super.applyAccessibility();
        
        if (!this.element) return;
        
        const tooltip = this.element.querySelector('.tooltip-component');
        if (!tooltip) return;
        
        // Set unique ID for aria-describedby
        tooltip.id = `tooltip-${this.instanceId}`;
        tooltip.setAttribute('role', this.props.role);
    }

    /**
     * Create tooltip for element
     * @param {Element|string} target - Target element or selector
     * @param {string|Object} content - Tooltip content or options
     * @param {Object} options - Additional options
     * @returns {TooltipComponent} Tooltip instance
     */
    static create(target, content, options = {}) {
        // Handle different parameter formats
        let tooltipOptions;
        
        if (typeof content === 'string') {
            tooltipOptions = { content, ...options };
        } else {
            tooltipOptions = content;
        }
        
        const tooltip = new TooltipComponent(tooltipOptions);
        tooltip.attach(target);
        
        return tooltip;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TooltipComponent;
} else {
    window.TooltipComponent = TooltipComponent;
}