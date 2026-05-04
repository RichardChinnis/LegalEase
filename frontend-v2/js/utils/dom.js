/**
 * DOM Manipulation Utilities
 * 
 * Provides safe, performant DOM manipulation utilities with error handling
 * and accessibility support built-in.
 */

/**
 * Safe DOM manipulation utilities
 */
const DOMUtils = {

    /**
     * Safely query elements with error handling
     * @param {string} selector - CSS selector
     * @param {Element} [context=document] - Context element to search within
     * @returns {Element|null} First matching element or null
     */
    querySelector(selector, context = document) {
        try {
            return context.querySelector(selector);
        } catch (error) {
            console.warn(`Invalid selector: ${selector}`, error);
            return null;
        }
    },

    /**
     * Safely query multiple elements with error handling
     * @param {string} selector - CSS selector
     * @param {Element} [context=document] - Context element to search within
     * @returns {NodeList|Array} NodeList of matching elements or empty array
     */
    querySelectorAll(selector, context = document) {
        try {
            return context.querySelectorAll(selector);
        } catch (error) {
            console.warn(`Invalid selector: ${selector}`, error);
            return [];
        }
    },

    /**
     * Create element with attributes, classes, and content
     * @param {string} tagName - HTML tag name
     * @param {Object} options - Element options
     * @param {Object} [options.attributes] - HTML attributes to set
     * @param {string|Array} [options.className] - CSS classes to add
     * @param {string|Node} [options.content] - Text content or child nodes
     * @param {Object} [options.data] - Data attributes to set
     * @param {Object} [options.events] - Event listeners to attach
     * @returns {Element} Created element
     */
    createElement(tagName, options = {}) {
        const element = document.createElement(tagName);

        // Set attributes
        if (options.attributes) {
            this.setAttributes(element, options.attributes);
        }

        // Add classes
        if (options.className) {
            this.addClass(element, options.className);
        }

        // Set content
        if (options.content !== undefined) {
            if (typeof options.content === 'string') {
                element.textContent = options.content;
            } else if (options.content instanceof Node) {
                element.appendChild(options.content);
            } else if (Array.isArray(options.content)) {
                options.content.forEach(child => {
                    if (typeof child === 'string') {
                        element.appendChild(document.createTextNode(child));
                    } else if (child instanceof Node) {
                        element.appendChild(child);
                    }
                });
            }
        }

        // Set data attributes
        if (options.data) {
            this.setDataAttributes(element, options.data);
        }

        // Attach event listeners
        if (options.events) {
            this.attachEvents(element, options.events);
        }

        return element;
    },

    /**
     * Create element from HTML string with safety checks
     * @param {string} html - HTML string
     * @param {boolean} [sanitize=true] - Whether to sanitize HTML
     * @returns {Element|DocumentFragment} Created element or fragment
     */
    createFromHTML(html, sanitize = true) {
        if (sanitize) {
            html = this.sanitizeHTML(html);
        }

        const template = document.createElement('template');
        template.innerHTML = html.trim();
        
        return template.content.childElementCount === 1 
            ? template.content.firstElementChild 
            : template.content;
    },

    /**
     * Basic HTML sanitization (removes script tags and event handlers)
     * @param {string} html - HTML string to sanitize
     * @returns {string} Sanitized HTML
     */
    sanitizeHTML(html) {
        // Remove script tags
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        
        // Remove event handler attributes
        html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
        html = html.replace(/\s*on\w+\s*=\s*[^>\s]+/gi, '');
        
        // Remove javascript: URLs
        html = html.replace(/javascript:/gi, '');
        
        return html;
    },

    /**
     * Set multiple attributes on an element
     * @param {Element} element - Target element
     * @param {Object} attributes - Attributes to set
     */
    setAttributes(element, attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
            if (value === null || value === undefined) {
                element.removeAttribute(key);
            } else {
                element.setAttribute(key, value);
            }
        });
    },

    /**
     * Set data attributes on an element
     * @param {Element} element - Target element
     * @param {Object} data - Data attributes to set
     */
    setDataAttributes(element, data) {
        Object.entries(data).forEach(([key, value]) => {
            element.dataset[key] = value;
        });
    },

    /**
     * Attach event listeners to an element
     * @param {Element} element - Target element
     * @param {Object} events - Event listeners object
     */
    attachEvents(element, events) {
        Object.entries(events).forEach(([event, handler]) => {
            if (typeof handler === 'function') {
                element.addEventListener(event, handler);
            } else if (typeof handler === 'object' && handler.handler) {
                element.addEventListener(event, handler.handler, handler.options || {});
            }
        });
    },

    /**
     * Add class(es) to element
     * @param {Element} element - Target element
     * @param {string|Array} className - Class name(s) to add
     */
    addClass(element, className) {
        if (Array.isArray(className)) {
            element.classList.add(...className);
        } else if (typeof className === 'string') {
            element.classList.add(...className.split(' ').filter(cls => cls));
        }
    },

    /**
     * Remove class(es) from element
     * @param {Element} element - Target element
     * @param {string|Array} className - Class name(s) to remove
     */
    removeClass(element, className) {
        if (Array.isArray(className)) {
            element.classList.remove(...className);
        } else if (typeof className === 'string') {
            element.classList.remove(...className.split(' ').filter(cls => cls));
        }
    },

    /**
     * Toggle class(es) on element
     * @param {Element} element - Target element
     * @param {string|Array} className - Class name(s) to toggle
     * @param {boolean} [force] - Force add/remove
     */
    toggleClass(element, className, force) {
        if (Array.isArray(className)) {
            className.forEach(cls => element.classList.toggle(cls, force));
        } else if (typeof className === 'string') {
            className.split(' ').filter(cls => cls).forEach(cls => {
                element.classList.toggle(cls, force);
            });
        }
    },

    /**
     * Check if element has class
     * @param {Element} element - Target element
     * @param {string} className - Class name to check
     * @returns {boolean} Whether element has class
     */
    hasClass(element, className) {
        return element.classList.contains(className);
    },

    /**
     * Show element (removes hidden attribute and display: none)
     * @param {Element} element - Element to show
     */
    show(element) {
        element.removeAttribute('hidden');
        if (element.style.display === 'none') {
            element.style.display = '';
        }
        element.setAttribute('aria-hidden', 'false');
    },

    /**
     * Hide element (adds hidden attribute)
     * @param {Element} element - Element to hide
     */
    hide(element) {
        element.setAttribute('hidden', '');
        element.setAttribute('aria-hidden', 'true');
    },

    /**
     * Toggle element visibility
     * @param {Element} element - Element to toggle
     * @param {boolean} [force] - Force show/hide
     */
    toggle(element, force) {
        if (force === true || (force === undefined && element.hasAttribute('hidden'))) {
            this.show(element);
        } else {
            this.hide(element);
        }
    },

    /**
     * Empty element (remove all children)
     * @param {Element} element - Element to empty
     */
    empty(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    },

    /**
     * Replace element content
     * @param {Element} element - Target element
     * @param {string|Node|Array} content - New content
     */
    setContent(element, content) {
        this.empty(element);
        
        if (typeof content === 'string') {
            element.textContent = content;
        } else if (content instanceof Node) {
            element.appendChild(content);
        } else if (Array.isArray(content)) {
            content.forEach(item => {
                if (typeof item === 'string') {
                    element.appendChild(document.createTextNode(item));
                } else if (item instanceof Node) {
                    element.appendChild(item);
                }
            });
        }
    },

    /**
     * Insert element after another element
     * @param {Element} newElement - Element to insert
     * @param {Element} referenceElement - Reference element
     */
    insertAfter(newElement, referenceElement) {
        referenceElement.parentNode.insertBefore(newElement, referenceElement.nextSibling);
    },

    /**
     * Insert element before another element
     * @param {Element} newElement - Element to insert
     * @param {Element} referenceElement - Reference element
     */
    insertBefore(newElement, referenceElement) {
        referenceElement.parentNode.insertBefore(newElement, referenceElement);
    },

    /**
     * Get element dimensions and position
     * @param {Element} element - Target element
     * @returns {Object} Dimensions and position data
     */
    getElementInfo(element) {
        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);
        
        return {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right,
            x: rect.x,
            y: rect.y,
            offsetWidth: element.offsetWidth,
            offsetHeight: element.offsetHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
            computedStyle
        };
    },

    /**
     * Check if element is visible in viewport
     * @param {Element} element - Element to check
     * @param {number} [threshold=0] - Visibility threshold (0-1)
     * @returns {boolean} Whether element is visible
     */
    isInViewport(element, threshold = 0) {
        const rect = element.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const windowWidth = window.innerWidth || document.documentElement.clientWidth;
        
        const vertInView = (rect.top <= windowHeight * (1 - threshold)) && 
                          ((rect.top + rect.height) >= windowHeight * threshold);
        const horInView = (rect.left <= windowWidth * (1 - threshold)) && 
                         ((rect.left + rect.width) >= windowWidth * threshold);
        
        return vertInView && horInView;
    },

    /**
     * Smooth scroll to element
     * @param {Element} element - Target element
     * @param {Object} [options] - Scroll options
     */
    scrollToElement(element, options = {}) {
        const defaultOptions = {
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest'
        };
        
        element.scrollIntoView({ ...defaultOptions, ...options });
    },

    /**
     * Find closest parent element matching selector
     * @param {Element} element - Starting element
     * @param {string} selector - CSS selector to match
     * @returns {Element|null} Matching parent element or null
     */
    closest(element, selector) {
        try {
            return element.closest(selector);
        } catch (error) {
            console.warn(`Invalid selector in closest: ${selector}`, error);
            return null;
        }
    },

    /**
     * Wait for element to appear in DOM
     * @param {string} selector - CSS selector
     * @param {Element} [context=document] - Context to search within
     * @param {number} [timeout=5000] - Timeout in milliseconds
     * @returns {Promise<Element>} Promise resolving to element
     */
    waitForElement(selector, context = document, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const element = this.querySelector(selector, context);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver((mutations, obs) => {
                const element = this.querySelector(selector, context);
                if (element) {
                    obs.disconnect();
                    clearTimeout(timeoutId);
                    resolve(element);
                }
            });

            observer.observe(context, {
                childList: true,
                subtree: true
            });

            const timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element not found within timeout: ${selector}`));
            }, timeout);
        });
    },

    /**
     * Batch DOM updates to improve performance
     * @param {Function} callback - Function containing DOM updates
     */
    batchUpdates(callback) {
        // Use requestAnimationFrame for smoother updates
        requestAnimationFrame(() => {
            callback();
        });
    },

    /**
     * Debounce function calls
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @param {boolean} [immediate=false] - Execute immediately
     * @returns {Function} Debounced function
     */
    debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(this, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(this, args);
        };
    },

    /**
     * Throttle function calls
     * @param {Function} func - Function to throttle
     * @param {number} limit - Limit in milliseconds
     * @returns {Function} Throttled function
     */
    throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DOMUtils;
} else {
    window.DOMUtils = DOMUtils;
}