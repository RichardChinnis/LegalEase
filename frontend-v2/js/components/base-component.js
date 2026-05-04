/**
 * Base Component Class
 * 
 * Provides a foundation for all UI components with lifecycle methods,
 * state management, event handling, and performance optimizations.
 */

// Import utilities (will work in both module and global contexts)
const getEventEmitter = () => {
    return (typeof EventEmitter !== 'undefined') ? EventEmitter : require('../utils/events').EventEmitter;
};

const getDOMUtils = () => {
    return (typeof DOMUtils !== 'undefined') ? DOMUtils : require('../utils/dom');
};

const getFormatUtils = () => {
    if (typeof FormatUtils !== 'undefined') {
        return FormatUtils;
    } else if (typeof require !== 'undefined') {
        return require('../utils/formatting');
    } else {
        console.error('FormatUtils not found - please ensure formatting.js is loaded');
        // Return a basic fallback to prevent crashes
        return {
            text: {
                escapeHtml: (text) => {
                    if (!text) return '';
                    return text.replace(/[&<>"']/g, function(m) {
                        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
                        return map[m];
                    });
                }
            },
            date: { relative: () => '', format: () => '' },
            political: { party: () => '', memberName: () => '' },
            bill: { number: () => '', title: () => '' },
            number: { format: () => '' },
            url: { member: () => '', bill: () => '' }
        };
    }
};

const getEventBus = () => {
    return (typeof EventBus !== 'undefined') ? EventBus : require('../utils/events').EventBus;
};

const getErrorHandler = () => {
    return (typeof ErrorHandler !== 'undefined') ? ErrorHandler : require('../error-handler');
};

/**
 * Base Component Class
 * All UI components should inherit from this class
 */
class BaseComponent extends getEventEmitter() {
    constructor(props = {}, options = {}) {
        super();

        // Core properties
        this.props = { ...this.getDefaultProps(), ...props };
        this.state = { ...this.getInitialState() };
        this.options = {
            autoRender: true,
            enableAccessibility: true,
            enableUpdates: true,
            debugMode: false,
            ...options
        };

        // Component metadata
        this.componentName = this.constructor.name;
        this.instanceId = this.generateInstanceId();
        this.isDestroyed = false;
        this.isMounted = false;

        // DOM and rendering
        this.element = null;
        this.container = null;
        this.lastRenderHash = null;

        // Event and lifecycle management
        this.eventListeners = new Map();
        this.childComponents = new Set();
        this.parentComponent = null;
        this.eventDelegators = [];
        
        // Performance tracking
        this.renderCount = 0;
        this.lastRenderTime = 0;
        this.updateQueue = [];
        this.isUpdating = false;

        // Utilities access
        this.dom = getDOMUtils();
        this.format = getFormatUtils();
        this.errorHandler = getErrorHandler();
        

        // Register with global event bus for cleanup
        getEventBus().registerComponent(this);

        // Auto-render if enabled
        if (this.options.autoRender) {
            this.render();
        }

        // Debug logging
        if (this.options.debugMode) {
            console.debug(`Component created: ${this.componentName}#${this.instanceId}`, this.props);
        }
    }

    /**
     * Generate unique instance ID
     * @returns {string} Unique ID
     */
    generateInstanceId() {
        return `${this.componentName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get default props (override in subclasses)
     * @returns {Object} Default props
     */
    getDefaultProps() {
        return {};
    }

    /**
     * Get initial state (override in subclasses)
     * @returns {Object} Initial state
     */
    getInitialState() {
        return {};
    }

    /**
     * Lifecycle: Component will mount
     * Called before component is added to DOM
     */
    componentWillMount() {
        // Override in subclasses
    }

    /**
     * Lifecycle: Component did mount
     * Called after component is added to DOM
     */
    componentDidMount() {
        // Override in subclasses
    }

    /**
     * Lifecycle: Component will update
     * Called before component updates
     * @param {Object} nextProps - New props
     * @param {Object} nextState - New state
     */
    componentWillUpdate(nextProps, nextState) {
        // Override in subclasses
    }

    /**
     * Lifecycle: Component did update
     * Called after component updates
     * @param {Object} prevProps - Previous props
     * @param {Object} prevState - Previous state
     */
    componentDidUpdate(prevProps, prevState) {
        // Override in subclasses
    }

    /**
     * Lifecycle: Component will unmount
     * Called before component is removed from DOM
     */
    componentWillUnmount() {
        // Override in subclasses
    }

    // ========================================================================
    // ANIMATION LIFECYCLE HOOKS
    // ========================================================================

    /**
     * Animation lifecycle hook - called after element is added to DOM
     * Override in subclasses to customize entrance animations
     * @returns {Promise} Resolves when animation completes
     */
    animateIn() {
        if (!this.element || this.options.disableAnimations) {
            return Promise.resolve();
        }

        // Check for reduced motion preference
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return Promise.resolve();
        }

        // Default entrance animation
        this.element.style.opacity = '0';
        this.element.classList.add('animate-fade-in-up');

        return new Promise(resolve => {
            // Get duration from CSS variable or use default
            const computedStyle = getComputedStyle(document.documentElement);
            const durationStr = computedStyle.getPropertyValue('--duration-normal') || '350ms';
            const duration = parseFloat(durationStr);

            setTimeout(() => {
                this.element.style.opacity = '';
                resolve();
            }, duration);
        });
    }

    /**
     * Animation lifecycle hook - called before element is removed from DOM
     * Override in subclasses to customize exit animations
     * @returns {Promise} Resolves when animation completes
     */
    animateOut() {
        if (!this.element || this.options.disableAnimations) {
            return Promise.resolve();
        }

        // Check for reduced motion preference
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return Promise.resolve();
        }

        // Default exit animation
        this.element.style.transition = 'opacity var(--duration-fast, 200ms) var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--duration-fast, 200ms) var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1))';
        this.element.style.opacity = '0';
        this.element.style.transform = 'translateY(-8px)';

        return new Promise(resolve => {
            setTimeout(resolve, 200);
        });
    }

    /**
     * Stagger animate children with a specific selector
     * @param {string} selector - Child element selector (default: '.animate-stagger')
     * @param {string} animationClass - Animation class to apply (default: 'animate-fade-in-up')
     */
    staggerAnimateChildren(selector = '.animate-stagger', animationClass = 'animate-fade-in-up') {
        if (!this.element) return;

        // Check for reduced motion preference
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }

        const children = this.element.querySelectorAll(selector);
        const staggerDelay = 50; // ms between each child

        children.forEach((child, index) => {
            child.style.animationDelay = `${index * staggerDelay}ms`;
            child.classList.add(animationClass);
        });
    }

    /**
     * Lifecycle: Should component update
     * Return false to skip update
     * @param {Object} nextProps - New props
     * @param {Object} nextState - New state
     * @returns {boolean} Whether component should update
     */
    shouldComponentUpdate(nextProps, nextState) {
        // Basic shallow comparison
        return !this.shallowEqual(this.props, nextProps) || 
               !this.shallowEqual(this.state, nextState);
    }

    /**
     * Shallow equality check for objects
     * @param {Object} obj1 - First object
     * @param {Object} obj2 - Second object
     * @returns {boolean} Whether objects are shallowly equal
     */
    shallowEqual(obj1, obj2) {
        if (obj1 === obj2) return true;
        if (!obj1 || !obj2) return false;

        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);

        if (keys1.length !== keys2.length) return false;

        for (const key of keys1) {
            if (obj1[key] !== obj2[key]) return false;
        }

        return true;
    }

    /**
     * Render the component
     * @returns {Element} Rendered element
     */
    render() {
        if (this.isDestroyed) {
            console.warn(`Cannot render destroyed component: ${this.componentName}#${this.instanceId}`);
            return null;
        }

        const startTime = performance.now();

        try {
            // Pre-render lifecycle
            if (!this.isMounted) {
                this.componentWillMount();
            }

            // Check if template method exists
            if (typeof this.template !== 'function') {
                throw new Error(`Component ${this.componentName} must implement template() method`);
            }
            
            // Generate template HTML
            const templateHTML = this.template();
            if (!templateHTML) {
                console.warn(`Component ${this.componentName} returned empty template`);
                return null;
            }

            // Check if update is necessary
            const renderHash = this.hashString(templateHTML);
            if (this.options.enableUpdates && this.lastRenderHash === renderHash && this.element) {
                return this.element;
            }

            // Create or update element
            if (!this.element) {
                this.element = this.dom.createFromHTML(templateHTML);
                this.element.setAttribute('data-component', this.componentName);
                this.element.setAttribute('data-instance', this.instanceId);
            } else {
                // Update existing element content
                this.updateElementContent(templateHTML);
            }

            // Bind events
            this.bindEvents();

            // Apply accessibility features
            if (this.options.enableAccessibility) {
                this.applyAccessibility();
            }

            // Post-render lifecycle
            if (!this.isMounted) {
                this.isMounted = true;
                // Use setTimeout to ensure DOM is ready
                setTimeout(() => this.componentDidMount(), 0);
            }

            // Update tracking
            this.lastRenderHash = renderHash;
            this.renderCount++;
            this.lastRenderTime = performance.now() - startTime;

            if (this.options.debugMode) {
                console.debug(`Component rendered: ${this.componentName}#${this.instanceId}`, {
                    renderTime: this.lastRenderTime,
                    renderCount: this.renderCount
                });
            }

            return this.element;

        } catch (error) {
            this.handleError('render', error);
            return this.renderErrorState(error);
        }
    }

    /**
     * Generate template HTML (override in subclasses)
     * @returns {string} HTML template
     */
    template() {
        return `<div class="${this.getComponentClasses().join(' ')}">
            <p>Base component - override template() method</p>
        </div>`;
    }

    /**
     * Get component CSS classes
     * @returns {Array} Array of CSS class names
     */
    getComponentClasses() {
        const classes = [`component-${this.componentName.toLowerCase()}`];
        
        if (this.props.className) {
            classes.push(...this.props.className.split(' '));
        }
        
        if (this.state.loading) classes.push('is-loading');
        if (this.state.error) classes.push('has-error');
        if (this.props.disabled) classes.push('is-disabled');

        return classes.filter(cls => cls);
    }

    /**
     * Update element content with DOM diffing
     * @param {string} newHTML - New HTML content
     */
    updateElementContent(newHTML) {
        // Simple approach: replace innerHTML
        // In a more sophisticated implementation, you'd do proper DOM diffing
        const tempElement = this.dom.createFromHTML(newHTML);
        
        // Copy attributes
        Array.from(tempElement.attributes).forEach(attr => {
            this.element.setAttribute(attr.name, attr.value);
        });

        // Update content
        this.element.innerHTML = tempElement.innerHTML;
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Remove existing listeners
        this.removeEventListeners();

        // Get event bindings from subclass
        const events = this.getEventBindings();
        
        Object.entries(events).forEach(([eventSelector, handler]) => {
            this.bindEvent(eventSelector, handler);
        });
    }

    /**
     * Get event bindings (override in subclasses)
     * @returns {Object} Event bindings object
     */
    getEventBindings() {
        return {};
    }

    /**
     * Bind single event
     * @param {string} eventSelector - Event selector (e.g., 'click .button')
     * @param {Function|string} handler - Event handler function or method name
     */
    bindEvent(eventSelector, handler) {
        const [eventType, selector] = eventSelector.trim().split(' ', 2);
        const handlerFn = typeof handler === 'string' ? this[handler].bind(this) : handler;

        if (!handlerFn) {
            console.warn(`Event handler not found: ${handler}`);
            return;
        }

        let target, listener;

        if (selector) {
            // Delegated event
            target = this.element;
            listener = (e) => {
                const matchedTarget = e.target.closest(selector);
                if (matchedTarget && this.element.contains(matchedTarget)) {
                    handlerFn(e, matchedTarget);
                }
            };
        } else {
            // Direct event
            target = this.element;
            listener = handlerFn;
        }

        target.addEventListener(eventType, listener);
        this.eventListeners.set(`${eventType}:${selector || 'root'}`, {
            target,
            eventType,
            listener,
            selector
        });
    }

    /**
     * Remove all event listeners
     */
    removeEventListeners() {
        this.eventListeners.forEach(({ target, eventType, listener }) => {
            target.removeEventListener(eventType, listener);
        });
        this.eventListeners.clear();
    }

    /**
     * Apply accessibility features
     */
    applyAccessibility() {
        if (!this.element) return;

        // Ensure focusable elements have proper tabindex
        const focusableElements = this.element.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
        focusableElements.forEach((el, index) => {
            if (!el.hasAttribute('tabindex') && el.tabIndex === -1) {
                el.tabIndex = 0;
            }
        });

        // Add ARIA labels if missing
        const buttonsWithoutLabels = this.element.querySelectorAll('button:not([aria-label]):not([aria-labelledby])');
        buttonsWithoutLabels.forEach(button => {
            if (!button.textContent.trim()) {
                button.setAttribute('aria-label', 'Button');
            }
        });

        // Ensure proper heading hierarchy
        const headings = this.element.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length > 0) {
            headings[0].setAttribute('role', 'heading');
        }
    }

    /**
     * Update component props
     * @param {Object} newProps - New props to merge
     */
    updateProps(newProps) {
        if (this.isDestroyed) return;

        const prevProps = { ...this.props };
        this.props = { ...this.props, ...newProps };

        if (this.shouldComponentUpdate(this.props, this.state)) {
            this.update(prevProps, this.state);
        }
    }

    /**
     * Update component state
     * @param {Object} newState - New state to merge
     * @param {Function} [callback] - Callback after state update
     */
    setState(newState, callback) {
        if (this.isDestroyed) return;

        const prevState = { ...this.state };
        this.state = { ...this.state, ...newState };

        if (this.shouldComponentUpdate(this.props, this.state)) {
            this.update(this.props, prevState);
        }

        if (callback) {
            setTimeout(callback, 0);
        }
    }

    /**
     * Force component update
     * @param {Object} [prevProps] - Previous props
     * @param {Object} [prevState] - Previous state
     */
    update(prevProps = this.props, prevState = this.state) {
        if (this.isDestroyed || this.isUpdating) return;

        this.isUpdating = true;

        try {
            this.componentWillUpdate(this.props, this.state);
            this.render();
            this.componentDidUpdate(prevProps, prevState);
        } catch (error) {
            this.handleError('update', error);
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Mount component to container
     * @param {Element|string} container - Container element or selector
     */
    mount(container) {
        if (this.isDestroyed) return;

        const targetContainer = typeof container === 'string' 
            ? this.dom.querySelector(container) 
            : container;

        if (!targetContainer) {
            throw new Error(`Mount container not found: ${container}`);
        }

        this.container = targetContainer;
        
        if (!this.element) {
            this.render();
        }

        if (this.element) {
            targetContainer.appendChild(this.element);
            this.isMounted = true;
        }
    }

    /**
     * Unmount component from container
     */
    unmount() {
        if (!this.isMounted || this.isDestroyed) return;

        this.componentWillUnmount();

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        this.isMounted = false;
    }

    /**
     * Destroy component and clean up resources
     */
    destroy() {
        if (this.isDestroyed) return;

        // Unmount if mounted
        if (this.isMounted) {
            this.unmount();
        }

        // Clean up child components
        this.childComponents.forEach(child => {
            if (child && typeof child.destroy === 'function') {
                child.destroy();
            }
        });
        this.childComponents.clear();

        // Clean up events
        this.removeEventListeners();
        this.removeAllListeners();

        // Clean up global event bus listeners
        getEventBus().cleanupComponent(this);

        // Clear references
        this.element = null;
        this.container = null;
        this.parentComponent = null;

        this.isDestroyed = true;

        if (this.options.debugMode) {
            console.debug(`Component destroyed: ${this.componentName}#${this.instanceId}`);
        }
    }

    /**
     * Add child component
     * @param {BaseComponent} component - Child component
     */
    addChild(component) {
        if (component instanceof BaseComponent) {
            this.childComponents.add(component);
            component.parentComponent = this;
        }
    }

    /**
     * Remove child component
     * @param {BaseComponent} component - Child component
     */
    removeChild(component) {
        this.childComponents.delete(component);
        if (component.parentComponent === this) {
            component.parentComponent = null;
        }
    }

    /**
     * Handle component errors
     * @param {string} context - Error context
     * @param {Error} error - Error object
     */
    handleError(context, error) {
        console.error(`Error in ${this.componentName}#${this.instanceId} (${context}):`, error);
        
        this.setState({ error: error.message });
        this.emit('error', { context, error });
        
        if (this.errorHandler && this.errorHandler.showNotification) {
            this.errorHandler.showNotification(
                `Component error: ${error.message}`,
                'error'
            );
        }
    }

    /**
     * Render error state
     * @param {Error} error - Error object
     * @returns {Element} Error element
     */
    renderErrorState(error) {
        const errorElement = this.dom.createElement('div', {
            className: 'component-error',
            content: `Error in ${this.componentName}: ${error.message}`
        });
        
        return errorElement;
    }

    /**
     * Create simple hash of string
     * @param {string} str - String to hash
     * @returns {string} Hash value
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    /**
     * Get component performance metrics
     * @returns {Object} Performance data
     */
    getPerformanceMetrics() {
        return {
            renderCount: this.renderCount,
            lastRenderTime: this.lastRenderTime,
            averageRenderTime: this.renderCount > 0 ? this.lastRenderTime / this.renderCount : 0,
            isMounted: this.isMounted,
            isDestroyed: this.isDestroyed
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaseComponent;
} else {
    window.BaseComponent = BaseComponent;
}