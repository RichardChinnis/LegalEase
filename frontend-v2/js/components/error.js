/**
 * Error Component - Error State Display and Handling
 * 
 * A comprehensive error component for displaying error states with retry
 * functionality, proper accessibility, and integration with the error handling system.
 * 
 * Features:
 * - Multiple error display variants
 * - Retry functionality with exponential backoff
 * - Integration with existing error-handler.js
 * - Accessibility with proper ARIA attributes
 * - Different error types and severity levels
 * - User-friendly error messages
 * - Optional technical details for debugging
 * - Error reporting capabilities
 * - Graceful degradation options
 */

// ErrorComponent assumes BaseComponent and utilities are already loaded
class ErrorComponent extends BaseComponent {
    constructor(props = {}, options = {}) {
        super(props, {
            enableAccessibility: true,
            ...options
        });
        
        // Retry management
        this.retryCount = 0;
        this.maxRetries = this.props.maxRetries || 3;
        this.retryTimeout = null;
        
        // Error tracking
        this.errorId = this.generateErrorId();
    }

    /**
     * Get default props
     * @returns {Object} Default props
     */
    getDefaultProps() {
        return {
            // Error information
            error: null, // Error object or string
            title: null, // Custom error title
            message: null, // Custom error message
            
            // Error categorization
            type: 'generic', // generic, network, validation, permission, notfound, server
            severity: 'error', // info, warning, error, critical
            
            // Display options
            variant: 'default', // default, inline, compact, banner, modal
            showIcon: true, // Show error icon
            showDetails: false, // Show technical details
            collapsible: false, // Allow expanding/collapsing details
            
            // Retry functionality
            retryable: false, // Can be retried
            retryText: 'Try Again', // Retry button text
            maxRetries: 3, // Maximum retry attempts
            retryDelay: 1000, // Initial retry delay (ms)
            exponentialBackoff: true, // Use exponential backoff
            onRetry: null, // Retry callback function
            
            // Reporting and logging
            reportable: false, // Can be reported
            reportText: 'Report Issue', // Report button text
            onReport: null, // Report callback function
            
            // Additional actions
            actions: [], // Custom action buttons
            primaryAction: null, // Primary action button
            
            // Fallback options
            fallbackContent: null, // Fallback content to show
            showFallback: false, // Show fallback instead of error
            
            // Accessibility
            ariaLabel: null, // Custom aria-label
            role: 'alert', // ARIA role
            
            // Integration
            errorHandler: null, // Custom error handler instance
            trackError: true, // Track error in analytics
            
            // Styling
            className: '',
            showBorder: true,
            closable: false, // Can be dismissed
            onClose: null // Close callback
        };
    }

    /**
     * Get initial state
     * @returns {Object} Initial state
     */
    getInitialState() {
        return {
            expanded: false,
            retryCount: 0,
            retrying: false,
            dismissed: false,
            reportSent: false
        };
    }

    /**
     * Generate unique error ID
     * @returns {string} Error ID
     */
    generateErrorId() {
        return `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get CSS classes for the component
     * @returns {Array} Array of CSS class names
     */
    getComponentClasses() {
        const classes = ['error-component'];
        
        // Variant classes
        classes.push(`error-component--${this.props.variant}`);
        
        // Type classes
        classes.push(`error-component--${this.props.type}`);
        
        // Severity classes
        classes.push(`error-component--${this.props.severity}`);
        
        // State classes
        if (this.state.expanded) classes.push('error-component--expanded');
        if (this.state.retrying) classes.push('error-component--retrying');
        if (this.state.dismissed) classes.push('error-component--dismissed');
        if (!this.props.showBorder) classes.push('error-component--no-border');
        
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
        if (this.state.dismissed && !this.props.closable) return '';
        
        if (this.props.showFallback && this.props.fallbackContent) {
            return this.renderFallback();
        }
        
        const { role, ariaLabel } = this.props;
        
        return `
            <div class="${this.getComponentClasses().join(' ')}"
                 role="${role}"
                 ${ariaLabel ? `aria-label="${ariaLabel}"` : ''}
                 data-error-id="${this.errorId}">
                
                ${this.renderErrorContent()}
                ${this.renderActions()}
                ${this.props.showDetails ? this.renderDetails() : ''}
                ${this.props.closable ? this.renderCloseButton() : ''}
            </div>
        `;
    }

    /**
     * Render main error content
     * @returns {string} Error content HTML
     */
    renderErrorContent() {
        return `
            <div class="error-component__content">
                ${this.props.showIcon ? this.renderIcon() : ''}
                <div class="error-component__text">
                    ${this.renderTitle()}
                    ${this.renderMessage()}
                </div>
            </div>
        `;
    }

    /**
     * Render error icon
     * @returns {string} Icon HTML
     */
    renderIcon() {
        const icons = {
            info: `<svg viewBox="0 0 16 16" fill="currentColor">
                     <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                     <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
                   </svg>`,
            warning: `<svg viewBox="0 0 16 16" fill="currentColor">
                       <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
                     </svg>`,
            error: `<svg viewBox="0 0 16 16" fill="currentColor">
                     <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/>
                   </svg>`,
            critical: `<svg viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
                      </svg>`
        };
        
        const iconSvg = icons[this.props.severity] || icons.error;
        
        return `
            <div class="error-component__icon" aria-hidden="true">
                ${iconSvg}
            </div>
        `;
    }

    /**
     * Render error title
     * @returns {string} Title HTML
     */
    renderTitle() {
        const title = this.props.title || this.getDefaultTitle();
        
        if (!title) return '';
        
        return `
            <h3 class="error-component__title">
                ${title}
            </h3>
        `;
    }

    /**
     * Get default title based on error type and severity
     * @returns {string} Default title
     */
    getDefaultTitle() {
        const titles = {
            network: 'Connection Problem',
            validation: 'Invalid Input',
            permission: 'Access Denied',
            notfound: 'Not Found',
            server: 'Server Error',
            generic: {
                info: 'Information',
                warning: 'Warning',
                error: 'Error',
                critical: 'Critical Error'
            }
        };
        
        if (titles[this.props.type] && typeof titles[this.props.type] === 'string') {
            return titles[this.props.type];
        }
        
        if (titles.generic[this.props.severity]) {
            return titles.generic[this.props.severity];
        }
        
        return 'Something went wrong';
    }

    /**
     * Render error message
     * @returns {string} Message HTML
     */
    renderMessage() {
        const message = this.props.message || this.getErrorMessage();
        
        if (!message) return '';
        
        return `
            <div class="error-component__message">
                ${message}
            </div>
        `;
    }

    /**
     * Get user-friendly error message
     * @returns {string} Error message
     */
    getErrorMessage() {
        if (this.props.message) return this.props.message;
        
        const error = this.props.error;
        
        // Default messages by type
        const defaultMessages = {
            network: 'Unable to connect to the server. Please check your internet connection and try again.',
            validation: 'Please check your input and try again.',
            permission: 'You don\'t have permission to access this resource.',
            notfound: 'The requested item could not be found.',
            server: 'A server error occurred. Please try again later.',
            generic: 'An unexpected error occurred. Please try again.'
        };
        
        // Try to extract user-friendly message from error object
        if (error) {
            if (typeof error === 'string') return error;
            if (error.message) return error.message;
            if (error.error) return error.error;
            if (error.description) return error.description;
        }
        
        return defaultMessages[this.props.type] || defaultMessages.generic;
    }

    /**
     * Render action buttons
     * @returns {string} Actions HTML
     */
    renderActions() {
        const actions = [];
        
        // Retry button
        if (this.props.retryable && this.state.retryCount < this.maxRetries) {
            actions.push(this.renderRetryButton());
        }
        
        // Report button
        if (this.props.reportable && !this.state.reportSent) {
            actions.push(this.renderReportButton());
        }
        
        // Primary action
        if (this.props.primaryAction) {
            actions.push(this.renderPrimaryAction());
        }
        
        // Custom actions
        this.props.actions.forEach(action => {
            actions.push(this.renderCustomAction(action));
        });
        
        // Details toggle
        if (this.props.collapsible && this.hasDetails()) {
            actions.push(this.renderDetailsToggle());
        }
        
        if (actions.length === 0) return '';
        
        return `
            <div class="error-component__actions">
                ${actions.join('')}
            </div>
        `;
    }

    /**
     * Render retry button
     * @returns {string} Retry button HTML
     */
    renderRetryButton() {
        const disabled = this.state.retrying ? 'disabled' : '';
        const text = this.state.retrying ? 'Retrying...' : this.props.retryText;
        
        return `
            <button type="button" 
                    class="btn btn--primary btn--sm"
                    data-action="retry"
                    ${disabled}
                    aria-describedby="retry-help-${this.instanceId}">
                ${this.state.retrying ? this.renderSpinner() : ''}
                ${text}
            </button>
            <div id="retry-help-${this.instanceId}" class="sr-only">
                Attempt ${this.state.retryCount + 1} of ${this.maxRetries}
            </div>
        `;
    }

    /**
     * Render small spinner for loading states
     * @returns {string} Spinner HTML
     */
    renderSpinner() {
        return `
            <span class="error-component__spinner" aria-hidden="true">
                <svg class="spinner" width="16" height="16" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" 
                            fill="none" stroke-linecap="round" 
                            stroke-dasharray="31.416" stroke-dashoffset="31.416">
                        <animate attributeName="stroke-dashoffset" dur="1s" 
                                 values="31.416;0;31.416" repeatCount="indefinite"/>
                    </circle>
                </svg>
            </span>
        `;
    }

    /**
     * Render report button
     * @returns {string} Report button HTML
     */
    renderReportButton() {
        return `
            <button type="button" 
                    class="btn btn--ghost btn--sm"
                    data-action="report">
                ${this.props.reportText}
            </button>
        `;
    }

    /**
     * Render primary action button
     * @returns {string} Primary action HTML
     */
    renderPrimaryAction() {
        const action = this.props.primaryAction;
        
        return `
            <button type="button" 
                    class="btn ${action.variant || 'btn--secondary'} btn--sm"
                    data-action="primary"
                    ${action.disabled ? 'disabled' : ''}
                    ${action.ariaLabel ? `aria-label="${action.ariaLabel}"` : ''}>
                ${action.label}
            </button>
        `;
    }

    /**
     * Render custom action button
     * @param {Object} action - Action configuration
     * @returns {string} Action button HTML
     */
    renderCustomAction(action) {
        const classes = ['btn', action.variant || 'btn--secondary', 'btn--sm'];
        if (action.className) classes.push(action.className);
        
        return `
            <button type="button" 
                    class="${classes.join(' ')}"
                    data-action="${action.action}"
                    ${action.disabled ? 'disabled' : ''}
                    ${action.ariaLabel ? `aria-label="${action.ariaLabel}"` : ''}>
                ${action.label}
            </button>
        `;
    }

    /**
     * Render details toggle button
     * @returns {string} Details toggle HTML
     */
    renderDetailsToggle() {
        const expanded = this.state.expanded;
        
        return `
            <button type="button" 
                    class="btn btn--ghost btn--sm"
                    data-action="toggle-details"
                    aria-expanded="${expanded}"
                    aria-controls="error-details-${this.instanceId}">
                ${expanded ? 'Hide' : 'Show'} Details
                <svg class="error-component__toggle-icon ${expanded ? 'error-component__toggle-icon--expanded' : ''}" 
                     width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
                </svg>
            </button>
        `;
    }

    /**
     * Render error details section
     * @returns {string} Details HTML
     */
    renderDetails() {
        if (!this.props.collapsible && !this.props.showDetails) return '';
        if (this.props.collapsible && !this.state.expanded) return '';
        
        const error = this.props.error;
        const details = [];
        
        // Error ID
        details.push(['Error ID', this.errorId]);
        
        // Timestamp
        details.push(['Time', new Date().toLocaleString()]);
        
        // Error details
        if (error) {
            if (error.name) details.push(['Type', error.name]);
            if (error.code) details.push(['Code', error.code]);
            if (error.status) details.push(['Status', error.status]);
            if (error.stack && this.options.debugMode) {
                details.push(['Stack Trace', `<pre>${error.stack}</pre>`]);
            }
        }
        
        // Retry information
        if (this.state.retryCount > 0) {
            details.push(['Retry Attempts', this.state.retryCount]);
        }
        
        return `
            <div class="error-component__details" 
                 id="error-details-${this.instanceId}"
                 ${this.props.collapsible ? `aria-hidden="${!this.state.expanded}"` : ''}>
                <div class="error-component__details-content">
                    <dl class="error-component__details-list">
                        ${details.map(([label, value]) => `
                            <dt class="error-component__details-label">${label}:</dt>
                            <dd class="error-component__details-value">${value}</dd>
                        `).join('')}
                    </dl>
                </div>
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
                    class="error-component__close"
                    data-action="close"
                    aria-label="Dismiss error">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M.293.293a1 1 0 011.414 0L8 6.586 14.293.293a1 1 0 111.414 1.414L9.414 8l6.293 6.293a1 1 0 01-1.414 1.414L8 9.414l-6.293 6.293a1 1 0 01-1.414-1.414L6.586 8 .293 1.707a1 1 0 010-1.414z"/>
                </svg>
            </button>
        `;
    }

    /**
     * Render fallback content
     * @returns {string} Fallback HTML
     */
    renderFallback() {
        return `
            <div class="error-component error-component--fallback">
                ${this.props.fallbackContent}
            </div>
        `;
    }

    /**
     * Check if error has details to show
     * @returns {boolean} Has details
     */
    hasDetails() {
        return !!(this.props.error && (
            this.props.error.stack || 
            this.props.error.code || 
            this.props.error.status ||
            this.state.retryCount > 0
        ));
    }

    /**
     * Get event bindings
     * @returns {Object} Event bindings
     */
    getEventBindings() {
        return {
            'click [data-action="retry"]': 'handleRetry',
            'click [data-action="report"]': 'handleReport',
            'click [data-action="primary"]': 'handlePrimaryAction',
            'click [data-action="close"]': 'handleClose',
            'click [data-action="toggle-details"]': 'handleToggleDetails',
            'click [data-action]': 'handleCustomAction'
        };
    }

    /**
     * Handle retry action
     * @param {Event} e - Click event
     */
    async handleRetry(e) {
        e.preventDefault();
        
        if (this.state.retrying || this.state.retryCount >= this.maxRetries) return;
        
        const retryCount = this.state.retryCount + 1;
        this.setState({ retrying: true, retryCount });
        
        try {
            // Calculate delay with exponential backoff
            const delay = this.props.exponentialBackoff ? 
                         this.props.retryDelay * Math.pow(2, this.state.retryCount) :
                         this.props.retryDelay;
            
            // Wait for delay
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Call retry handler
            if (this.props.onRetry) {
                await this.props.onRetry(retryCount);
            }
            
            this.emit('retry', { retryCount, error: this.props.error });
            
        } catch (error) {
            console.error('Retry failed:', error);
            this.handleError('retry', error);
        } finally {
            this.setState({ retrying: false });
        }
    }

    /**
     * Handle report action
     * @param {Event} e - Click event
     */
    handleReport(e) {
        e.preventDefault();
        
        if (this.state.reportSent) return;
        
        const errorInfo = {
            errorId: this.errorId,
            error: this.props.error,
            type: this.props.type,
            severity: this.props.severity,
            retryCount: this.state.retryCount,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        // Call report handler
        if (this.props.onReport) {
            this.props.onReport(errorInfo);
        }
        
        // Integrate with error handler
        const errorHandler = this.props.errorHandler || getErrorHandler();
        if (errorHandler && errorHandler.reportError) {
            errorHandler.reportError(errorInfo);
        }
        
        this.setState({ reportSent: true });
        this.emit('reported', errorInfo);
    }

    /**
     * Handle primary action
     * @param {Event} e - Click event
     */
    handlePrimaryAction(e) {
        e.preventDefault();
        
        if (this.props.primaryAction?.handler) {
            this.props.primaryAction.handler(e);
        }
        
        this.emit('primary:action', { action: this.props.primaryAction });
    }

    /**
     * Handle close action
     * @param {Event} e - Click event
     */
    handleClose(e) {
        e.preventDefault();
        
        this.setState({ dismissed: true });
        
        if (this.props.onClose) {
            this.props.onClose();
        }
        
        this.emit('closed');
    }

    /**
     * Handle toggle details
     * @param {Event} e - Click event
     */
    handleToggleDetails(e) {
        e.preventDefault();
        
        this.setState({ expanded: !this.state.expanded });
    }

    /**
     * Handle custom actions
     * @param {Event} e - Click event
     * @param {Element} target - Button element
     */
    handleCustomAction(e, target) {
        const actionName = target.dataset.action;
        const action = this.props.actions.find(a => a.action === actionName);
        
        if (action && action.handler) {
            action.handler(e, target);
        }
        
        this.emit('action', { action: actionName, event: e, target });
    }

    /**
     * Set error information
     * @param {Error|string|Object} error - Error to display
     * @param {Object} options - Display options
     */
    setError(error, options = {}) {
        this.updateProps({
            error,
            ...options
        });
        
        // Reset state
        this.setState({
            retryCount: 0,
            retrying: false,
            dismissed: false,
            reportSent: false,
            expanded: false
        });
        
        // Track error if enabled
        if (this.props.trackError) {
            this.trackError(error);
        }
    }

    /**
     * Track error for analytics
     * @param {Error|string|Object} error - Error to track
     */
    trackError(error) {
        const errorHandler = this.props.errorHandler || getErrorHandler();
        
        if (errorHandler && errorHandler.trackError) {
            errorHandler.trackError({
                errorId: this.errorId,
                error,
                type: this.props.type,
                severity: this.props.severity,
                component: 'ErrorComponent',
                timestamp: new Date().toISOString()
            });
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
        
        // Auto-focus for critical errors
        if (this.props.severity === 'critical' && this.element.querySelector('button')) {
            setTimeout(() => {
                const firstButton = this.element.querySelector('button');
                if (firstButton) firstButton.focus();
            }, 100);
        }
    }

    /**
     * Lifecycle: Component will unmount
     */
    componentWillUnmount() {
        // Clear any pending retry timeouts
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorComponent;
} else {
    window.ErrorComponent = ErrorComponent;
}