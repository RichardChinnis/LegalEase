/**
 * Event Bus System for Cross-Component Communication
 * 
 * Provides both global event bus and local event emitter capabilities
 * with automatic cleanup to prevent memory leaks.
 */

// Global event types for cross-component communication
const GLOBAL_EVENTS = {
    // Navigation events
    BILL_SELECTED: 'bill:selected',
    BILL_ACTIVE_CHANGED: 'bill:active:changed',
    MEMBER_SELECTED: 'member:selected',
    SEARCH_QUERY: 'search:query',
    ROUTE_CHANGED: 'route:changed',

    // State events
    LOCATION_SET: 'location:set',
    AUTH_STATE_CHANGED: 'auth:state:changed',

    // UI events
    MODAL_OPENED: 'modal:opened',
    MODAL_CLOSED: 'modal:closed',
    BILL_VIEW_CLOSED: 'bill:view:closed',
    SIDEBAR_TOGGLED: 'sidebar:toggled',
    
    // Chat events
    PERSPECTIVE_REQUESTED: 'perspective:requested',
    CHAT_MESSAGE_SENT: 'chat:message:sent',
    CHAT_CONTEXT_CHANGED: 'chat:context:changed',
    
    // Data events
    DATA_LOADED: 'data:loaded',
    DATA_ERROR: 'data:error',
    CACHE_UPDATED: 'cache:updated'
};

/**
 * Base Event Emitter class
 * Provides event handling capabilities for components
 */
class EventEmitter {
    constructor() {
        this.listeners = new Map();
        this.onceListeners = new Map();
        this._debugMode = false;
    }

    /**
     * Add event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @param {Object} options - Options (once, passive, etc.)
     */
    on(event, callback, options = {}) {
        if (typeof callback !== 'function') {
            throw new TypeError('Callback must be a function');
        }

        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }

        const listener = {
            callback,
            passive: options.passive || false,
            context: options.context || null
        };

        this.listeners.get(event).add(listener);
        
        if (this._debugMode) {
            console.debug(`Event listener added: ${event}`, listener);
        }

        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    /**
     * Add one-time event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @param {Object} options - Options
     */
    once(event, callback, options = {}) {
        if (typeof callback !== 'function') {
            throw new TypeError('Callback must be a function');
        }

        const onceWrapper = (data) => {
            this.off(event, onceWrapper);
            callback.call(options.context || null, data);
        };

        return this.on(event, onceWrapper, options);
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler to remove
     */
    off(event, callback) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;

        // Find and remove the listener
        for (const listener of listeners) {
            if (listener.callback === callback) {
                listeners.delete(listener);
                if (this._debugMode) {
                    console.debug(`Event listener removed: ${event}`, listener);
                }
                break;
            }
        }

        // Clean up empty event sets
        if (listeners.size === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Remove all listeners for an event or all events
     * @param {string} [event] - Specific event to clear, or all if undefined
     */
    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Emit event to all listeners
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;

        if (this._debugMode) {
            console.debug(`Event emitted: ${event}`, data);
        }

        // Create array to avoid modification during iteration
        const listenersArray = Array.from(listeners);
        
        for (const listener of listenersArray) {
            try {
                // Skip if listener was removed during iteration
                if (!listeners.has(listener)) continue;

                listener.callback.call(listener.context, data);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
                
                // Emit error event if this isn't already an error event
                if (event !== 'error') {
                    this.emit('error', { event, error, listener });
                }
            }
        }
    }

    /**
     * Get listener count for event
     * @param {string} event - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(event) {
        const listeners = this.listeners.get(event);
        return listeners ? listeners.size : 0;
    }

    /**
     * Get all event names with listeners
     * @returns {string[]} Array of event names
     */
    eventNames() {
        return Array.from(this.listeners.keys());
    }

    /**
     * Enable/disable debug mode
     * @param {boolean} enabled - Debug mode state
     */
    setDebugMode(enabled) {
        this._debugMode = enabled;
    }
}

/**
 * Global Event Bus for cross-component communication
 * Singleton instance shared across the application
 */
class GlobalEventBus extends EventEmitter {
    constructor() {
        super();
        this.componentInstances = new WeakMap();
        this._eventHistory = [];
        this._maxHistorySize = 100;
    }

    /**
     * Register component for automatic cleanup
     * @param {Object} component - Component instance
     */
    registerComponent(component) {
        if (!this.componentInstances.has(component)) {
            this.componentInstances.set(component, new Set());
        }
    }

    /**
     * Add event listener with automatic component cleanup tracking
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @param {Object} options - Options including component reference
     */
    on(event, callback, options = {}) {
        const unsubscribe = super.on(event, callback, options);

        // Track listener for component cleanup
        if (options.component) {
            this.registerComponent(options.component);
            const componentListeners = this.componentInstances.get(options.component);
            componentListeners.add({ event, callback, unsubscribe });
        }

        return unsubscribe;
    }

    /**
     * Clean up all listeners for a component
     * @param {Object} component - Component instance
     */
    cleanupComponent(component) {
        const componentListeners = this.componentInstances.get(component);
        if (componentListeners) {
            for (const listener of componentListeners) {
                listener.unsubscribe();
            }
            this.componentInstances.delete(component);
        }
    }

    /**
     * Emit event with history tracking
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        super.emit(event, data);

        // Track event history for debugging
        this._eventHistory.push({
            event,
            data,
            timestamp: Date.now()
        });

        // Maintain history size
        if (this._eventHistory.length > this._maxHistorySize) {
            this._eventHistory.shift();
        }
    }

    /**
     * Get event history for debugging
     * @param {number} [count] - Number of recent events to return
     * @returns {Array} Recent events
     */
    getEventHistory(count = 10) {
        return this._eventHistory.slice(-count);
    }

    /**
     * Clear event history
     */
    clearEventHistory() {
        this._eventHistory = [];
    }
}

// Create singleton instance
const EventBus = new GlobalEventBus();

/**
 * DOM Event Delegation utility
 * Provides efficient event handling for dynamic content
 */
class EventDelegator {
    constructor(container = document.body) {
        this.container = container;
        this.delegatedEvents = new Map();
    }

    /**
     * Delegate event handling to container
     * @param {string} event - Event type (click, input, etc.)
     * @param {string} selector - CSS selector for target elements
     * @param {Function} handler - Event handler
     * @param {Object} options - Event options
     */
    delegate(event, selector, handler, options = {}) {
        if (!this.delegatedEvents.has(event)) {
            this.delegatedEvents.set(event, new Map());
            
            // Add container listener
            const containerHandler = (e) => {
                const delegates = this.delegatedEvents.get(event);
                if (!delegates) return;

                for (const [sel, handlers] of delegates) {
                    const target = e.target.closest(sel);
                    if (target && this.container.contains(target)) {
                        for (const h of handlers) {
                            try {
                                h.call(target, e, target);
                            } catch (error) {
                                console.error('Error in delegated event handler:', error);
                            }
                        }
                    }
                }
            };

            this.container.addEventListener(event, containerHandler, options);
        }

        const eventMap = this.delegatedEvents.get(event);
        if (!eventMap.has(selector)) {
            eventMap.set(selector, new Set());
        }

        eventMap.get(selector).add(handler);

        // Return cleanup function
        return () => {
            const handlers = eventMap.get(selector);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    eventMap.delete(selector);
                }
            }
        };
    }

    /**
     * Remove delegated event handler
     * @param {string} event - Event type
     * @param {string} selector - CSS selector
     * @param {Function} handler - Event handler
     */
    undelegate(event, selector, handler) {
        const eventMap = this.delegatedEvents.get(event);
        if (eventMap) {
            const handlers = eventMap.get(selector);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    eventMap.delete(selector);
                }
            }
        }
    }

    /**
     * Clean up all delegated events
     */
    destroy() {
        this.delegatedEvents.clear();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EventEmitter,
        EventBus,
        EventDelegator,
        GLOBAL_EVENTS
    };
} else {
    window.EventEmitter = EventEmitter;
    window.EventBus = EventBus;
    window.EventDelegator = EventDelegator;
    window.GLOBAL_EVENTS = GLOBAL_EVENTS;
}