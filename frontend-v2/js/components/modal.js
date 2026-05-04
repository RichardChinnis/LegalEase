/**
 * Modal Component - Reusable Modal Container
 * 
 * A fully featured modal component with accessibility, keyboard navigation,
 * focus trapping, and mobile responsive design. Used for onboarding,
 * bill details, member profiles, and other overlay content.
 * 
 * Features:
 * - Focus trapping and restoration
 * - Keyboard navigation (ESC to close, Tab cycling)
 * - ARIA attributes for screen readers
 * - Backdrop click to close
 * - Animation support (fade in/out, scale)
 * - Mobile responsive design
 * - Scroll lock on body
 * - Multiple size variants
 * - Header, body, and footer sections
 */

// ModalComponent assumes BaseComponent and utilities are already loaded
class ModalComponent extends BaseComponent {
    constructor(props = {}, options = {}) {
        super(props, {
            enableAccessibility: true,
            autoRender: false, // Modals should be manually rendered
            ...options
        });
        
        // Focus management
        this.previousActiveElement = null;
        this.focusableElements = [];
        this.firstFocusableElement = null;
        this.lastFocusableElement = null;
        
        // Animation state
        this.isAnimating = false;
        this.animationDuration = 300;
        
        // Global event listeners
        this.boundHandleKeydown = this.handleKeydown.bind(this);
        this.boundHandleResize = this.handleResize.bind(this);
    }

    /**
     * Get default props
     * @returns {Object} Default props
     */
    getDefaultProps() {
        return {
            // Modal configuration
            open: false,
            title: '',
            
            // Content sections
            header: {
                show: true,
                title: '',
                showCloseButton: true,
                content: null // Custom header content HTML
            },
            
            body: {
                content: '', // Main content HTML
                scrollable: true,
                padding: true
            },
            
            footer: {
                show: false,
                content: null, // Custom footer content HTML
                actions: [] // Array of action buttons
            },
            
            // Behavior options
            closable: true, // Can be closed by user
            closeOnBackdrop: true, // Close when clicking backdrop
            closeOnEsc: true, // Close when pressing ESC
            focusTrap: true, // Trap focus within modal
            scrollLock: true, // Prevent body scrolling
            
            // Styling options
            size: 'default', // sm, default, lg, xl, full
            variant: 'default', // default, centered, drawer
            animation: 'fade', // fade, slide, scale, none
            backdrop: true, // Show backdrop
            
            // Custom styling
            className: '',
            headerClassName: '',
            bodyClassName: '',
            footerClassName: '',
            
            // Accessibility
            ariaLabel: null,
            ariaLabelledBy: null,
            ariaDescribedBy: null,
            
            // Event handlers
            onOpen: null,
            onClose: null,
            onBackdropClick: null
        };
    }

    /**
     * Get initial state
     * @returns {Object} Initial state
     */
    getInitialState() {
        return {
            isOpen: this.props.open,
            isVisible: false, // For animation states
            isAnimating: false
        };
    }

    /**
     * Get CSS classes for the modal
     * @returns {Array} Array of CSS class names
     */
    getComponentClasses() {
        const classes = ['modal'];
        
        // Size variants
        classes.push(`modal--${this.props.size}`);
        
        // Style variants
        if (this.props.variant !== 'default') {
            classes.push(`modal--${this.props.variant}`);
        }
        
        // Animation classes
        if (this.props.animation !== 'none') {
            classes.push(`modal--${this.props.animation}`);
        }
        
        // State classes
        if (this.state.isVisible) classes.push('show');
        if (this.state.isAnimating) classes.push('modal--animating');
        
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
        if (!this.state.isOpen) {
            return '<div class="modal-wrapper" style="display: none;"></div>';
        }

        const { header, body, footer, backdrop, ariaLabel, ariaLabelledBy, ariaDescribedBy } = this.props;

        return `
            <div class="modal-wrapper" style="display: block;">
                <!-- Backdrop -->
                ${backdrop ? this.renderBackdrop() : ''}
                
                <!-- Modal -->
                <div class="${this.getComponentClasses().join(' ')}"
                     role="dialog"
                     aria-modal="true"
                     ${ariaLabel ? `aria-label="${ariaLabel}"` : ''}
                     ${ariaLabelledBy ? `aria-labelledby="${ariaLabelledBy}"` : ''}
                     ${ariaDescribedBy ? `aria-describedby="${ariaDescribedBy}"` : ''}
                     tabindex="-1">
                    
                    <div class="modal__content">
                        <!-- Header -->
                        ${header.show ? this.renderHeader() : ''}
                        
                        <!-- Body -->
                        ${this.renderBody()}
                        
                        <!-- Footer -->
                        ${footer.show ? this.renderFooter() : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render modal backdrop
     * @returns {string} Backdrop HTML
     */
    renderBackdrop() {
        return `
            <div class="modal-backdrop ${this.state.isVisible ? 'show' : ''}"
                 data-modal-backdrop="true"
                 aria-hidden="true">
            </div>
        `;
    }

    /**
     * Render modal header
     * @returns {string} Header HTML
     */
    renderHeader() {
        const { header, title } = this.props;
        
        // Use custom header content if provided
        if (header.content) {
            return `
                <div class="modal__header ${this.props.headerClassName || ''}">
                    ${header.content}
                </div>
            `;
        }
        
        // Default header with title and close button
        const headerTitle = header.title || title;
        const headerId = `modal-title-${this.instanceId}`;
        
        return `
            <div class="modal__header ${this.props.headerClassName || ''}">
                <h2 class="modal__title" id="${headerId}">
                    ${headerTitle}
                </h2>
                ${header.showCloseButton ? this.renderCloseButton() : ''}
            </div>
        `;
    }

    /**
     * Render close button
     * @returns {string} Close button HTML
     */
    renderCloseButton() {
        return `
            <button type="button" 
                    class="modal__close btn btn--ghost"
                    data-modal-close="true"
                    aria-label="Close modal"
                    title="Close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M.293.293a1 1 0 011.414 0L8 6.586 14.293.293a1 1 0 111.414 1.414L9.414 8l6.293 6.293a1 1 0 01-1.414 1.414L8 9.414l-6.293 6.293a1 1 0 01-1.414-1.414L6.586 8 .293 1.707a1 1 0 010-1.414z"/>
                </svg>
            </button>
        `;
    }

    /**
     * Render modal body
     * @returns {string} Body HTML
     */
    renderBody() {
        const { body } = this.props;
        const bodyId = `modal-body-${this.instanceId}`;
        
        const classes = ['modal__body'];
        if (!body.scrollable) classes.push('modal__body--no-scroll');
        if (!body.padding) classes.push('modal__body--no-padding');
        if (this.props.bodyClassName) classes.push(this.props.bodyClassName);
        
        return `
            <div class="${classes.join(' ')}" id="${bodyId}">
                ${body.content || ''}
            </div>
        `;
    }

    /**
     * Render modal footer
     * @returns {string} Footer HTML
     */
    renderFooter() {
        const { footer } = this.props;
        
        // Use custom footer content if provided
        if (footer.content) {
            return `
                <div class="modal__footer ${this.props.footerClassName || ''}">
                    ${footer.content}
                </div>
            `;
        }
        
        // Render action buttons
        if (footer.actions && footer.actions.length > 0) {
            const actionsHtml = footer.actions.map(action => {
                const classes = ['btn', action.variant || 'btn--secondary'];
                if (action.className) classes.push(action.className);
                
                return `
                    <button type="${action.type || 'button'}"
                            class="${classes.join(' ')}"
                            data-action="${action.action || ''}"
                            ${action.disabled ? 'disabled' : ''}
                            ${action.ariaLabel ? `aria-label="${action.ariaLabel}"` : ''}>
                        ${action.label}
                    </button>
                `;
            }).join('');
            
            return `
                <div class="modal__footer ${this.props.footerClassName || ''}">
                    ${actionsHtml}
                </div>
            `;
        }
        
        return '';
    }

    /**
     * Get event bindings
     * @returns {Object} Event bindings
     */
    getEventBindings() {
        return {
            'click [data-modal-close]': 'handleCloseClick',
            'click [data-modal-backdrop]': 'handleBackdropClick',
            'click [data-action]': 'handleActionClick'
        };
    }

    /**
     * Handle close button click
     * @param {Event} e - Click event
     */
    handleCloseClick(e) {
        e.preventDefault();
        if (this.props.closable) {
            this.close();
        }
    }

    /**
     * Handle backdrop click
     * @param {Event} e - Click event
     */
    handleBackdropClick(e) {
        if (!this.props.closeOnBackdrop || !this.props.closable) return;
        
        // Only close if clicking directly on backdrop, not its children
        if (e.target === e.currentTarget) {
            if (this.props.onBackdropClick) {
                this.props.onBackdropClick(e);
            }
            this.close();
        }
    }

    /**
     * Handle action button click
     * @param {Event} e - Click event
     * @param {Element} target - Button element
     */
    handleActionClick(e, target) {
        const action = target.dataset.action;
        
        // Emit generic action event
        this.emit('action:clicked', {
            action: action,
            element: target,
            event: e
        });
        
        // Emit specific action event (this is what enables action-specific listeners)
        if (action) {
            this.emit(`action:${action}`, {
                element: target,
                event: e
            });
        }
        
        // Close modal after action if it's a close action
        if (action === 'close' || action === 'cancel') {
            this.close();
        }
    }

    /**
     * Handle keyboard events (global)
     * @param {KeyboardEvent} e - Keyboard event
     */
    handleKeydown(e) {
        if (!this.state.isOpen) return;
        
        switch (e.key) {
            case 'Escape':
                if (this.props.closeOnEsc && this.props.closable) {
                    e.preventDefault();
                    this.close();
                }
                break;
                
            case 'Tab':
                if (this.props.focusTrap) {
                    this.handleTabKey(e);
                }
                break;
        }
    }

    /**
     * Handle Tab key for focus trapping
     * @param {KeyboardEvent} e - Keyboard event
     */
    handleTabKey(e) {
        if (this.focusableElements.length === 0) return;
        
        const currentIndex = this.focusableElements.indexOf(document.activeElement);
        
        if (e.shiftKey) {
            // Shift+Tab - go to previous element
            if (currentIndex <= 0) {
                e.preventDefault();
                this.lastFocusableElement.focus();
            }
        } else {
            // Tab - go to next element
            if (currentIndex >= this.focusableElements.length - 1) {
                e.preventDefault();
                this.firstFocusableElement.focus();
            }
        }
    }

    /**
     * Handle window resize
     */
    handleResize() {
        if (this.state.isOpen) {
            this.updateFocusableElements();
        }
    }

    /**
     * Open the modal
     * @param {Object} options - Additional options
     */
    async open(options = {}) {
        console.log('[Modal] open() called, isOpen:', this.state.isOpen, 'isAnimating:', this.isAnimating, 'element:', this.element);
        if (this.state.isOpen || this.isAnimating) {
            console.log('[Modal] Already open or animating, returning early');
            return;
        }
        
        // Update props if provided
        if (Object.keys(options).length > 0) {
            this.updateProps(options);
        }
        
        this.isAnimating = true;
        
        // Set initial state
        this.setState({ 
            isOpen: true, 
            isAnimating: true 
        });
        
        // Re-render to show modal
        this.render();
        console.log('[Modal] After render, element:', this.element, 'isMounted:', this.isMounted);

        // Mount to body if not already mounted
        if (!this.isMounted) {
            console.log('[Modal] Not mounted, mounting to body');
            this.mount(document.body);
        }

        // Force remount if element is not in DOM
        if (this.element && !document.contains(this.element)) {
            console.log('[Modal] Element not in DOM, remounting');
            this.isMounted = false;
            this.mount(document.body);
        }

        console.log('[Modal] Final element in DOM:', this.element, document.contains(this.element));
        
        // Prepare for animation
        this.setupModal();
        
        // Trigger animation
        requestAnimationFrame(() => {
            this.setState({ isVisible: true });
            this.render(); // Re-render to apply show class
            
            setTimeout(() => {
                this.isAnimating = false;
                this.setState({ isAnimating: false });
                
                // Emit open event
                this.emit('modal:opened');
                if (this.props.onOpen) {
                    this.props.onOpen();
                }
                
                EventBus.emit(GLOBAL_EVENTS.MODAL_OPENED, {
                    modalId: this.instanceId,
                    modal: this
                });
            }, this.animationDuration);
        });
    }

    /**
     * Close the modal
     */
    async close() {
        if (!this.state.isOpen || this.isAnimating) return;
        
        this.isAnimating = true;
        this.setState({ isAnimating: true });
        
        // Start close animation
        this.setState({ isVisible: false });
        
        setTimeout(() => {
            this.setState({ 
                isOpen: false, 
                isAnimating: false 
            });
            
            this.cleanupModal();
            this.isAnimating = false;
            
            // Emit close event
            this.emit('modal:closed');
            if (this.props.onClose) {
                this.props.onClose();
            }
            
            EventBus.emit(GLOBAL_EVENTS.MODAL_CLOSED, {
                modalId: this.instanceId,
                modal: this
            });
            
            // Re-render to hide
            this.render();
            
        }, this.animationDuration);
    }

    /**
     * Toggle modal open/close state
     */
    toggle() {
        if (this.state.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Setup modal (focus, scroll lock, etc.)
     */
    setupModal() {
        // Save current active element
        this.previousActiveElement = document.activeElement;
        
        // Add global event listeners
        document.addEventListener('keydown', this.boundHandleKeydown, true);
        window.addEventListener('resize', this.boundHandleResize);
        
        // Lock body scroll
        if (this.props.scrollLock) {
            document.body.style.overflow = 'hidden';
            document.body.setAttribute('data-modal-open', 'true');
        }
        
        // Setup focus trapping
        if (this.props.focusTrap) {
            this.setupFocusTrap();
        }
    }

    /**
     * Cleanup modal (restore focus, remove scroll lock, etc.)
     */
    cleanupModal() {
        // Remove global event listeners
        document.removeEventListener('keydown', this.boundHandleKeydown, true);
        window.removeEventListener('resize', this.boundHandleResize);
        
        // Restore body scroll
        if (this.props.scrollLock) {
            document.body.style.overflow = '';
            document.body.removeAttribute('data-modal-open');
        }
        
        // Restore focus
        if (this.previousActiveElement && this.props.focusTrap) {
            this.previousActiveElement.focus();
            this.previousActiveElement = null;
        }
    }

    /**
     * Setup focus trapping
     */
    setupFocusTrap() {
        this.updateFocusableElements();
        
        // Focus first element
        if (this.firstFocusableElement) {
            setTimeout(() => {
                this.firstFocusableElement.focus();
            }, 50);
        }
    }

    /**
     * Update list of focusable elements
     */
    updateFocusableElements() {
        if (!this.element) return;
        
        const focusableSelectors = [
            'button:not([disabled])',
            'input:not([disabled]):not([type="hidden"])',
            'textarea:not([disabled])',
            'select:not([disabled])',
            'a[href]',
            '[tabindex]:not([tabindex="-1"])',
            '[contenteditable="true"]'
        ];
        
        this.focusableElements = Array.from(
            this.element.querySelectorAll(focusableSelectors.join(', '))
        );
        
        this.firstFocusableElement = this.focusableElements[0] || null;
        this.lastFocusableElement = this.focusableElements[this.focusableElements.length - 1] || null;
    }

    /**
     * Update modal content
     * @param {Object} content - New content
     */
    updateContent(content = {}) {
        const updates = {};

        if (content.title !== undefined) updates.title = content.title;
        if (content.header !== undefined) updates.header = { ...this.props.header, ...content.header };
        if (content.body !== undefined) updates.body = { ...this.props.body, ...content.body };
        if (content.footer !== undefined) updates.footer = { ...this.props.footer, ...content.footer };

        this.updateProps(updates);

        // Update focusable elements if modal is open
        if (this.state.isOpen) {
            setTimeout(() => this.updateFocusableElements(), 0);
        }
    }

    /**
     * Update modal body content (convenience method)
     * @param {string} bodyContent - New body HTML content
     */
    updateBody(bodyContent) {
        this.updateContent({
            body: { content: bodyContent }
        });
    }

    /**
     * Lifecycle: Component will unmount
     */
    componentWillUnmount() {
        // Clean up if modal is still open
        if (this.state.isOpen) {
            this.cleanupModal();
        }
    }

    /**
     * Apply accessibility features
     */
    applyAccessibility() {
        super.applyAccessibility();
        
        if (!this.element) return;
        
        const modalElement = this.element.querySelector('.modal');
        if (!modalElement) return;
        
        // Set ARIA attributes
        modalElement.setAttribute('role', 'dialog');
        modalElement.setAttribute('aria-modal', 'true');
        
        // Auto-set aria-labelledby if header title exists
        const titleElement = modalElement.querySelector('.modal__title');
        if (titleElement && !this.props.ariaLabelledBy && !this.props.ariaLabel) {
            modalElement.setAttribute('aria-labelledby', titleElement.id);
        }
        
        // Auto-set aria-describedby if body exists
        const bodyElement = modalElement.querySelector('.modal__body');
        if (bodyElement && !this.props.ariaDescribedBy) {
            modalElement.setAttribute('aria-describedby', bodyElement.id);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModalComponent;
} else {
    window.ModalComponent = ModalComponent;
}