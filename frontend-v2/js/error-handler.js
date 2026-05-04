// Enhanced error handling
const ErrorHandler = {
    notifications: new Map(),
    retryActions: new Map(),
    
    showNotification(message, type = 'error', persistent = false) {
        const id = Date.now();
        const errorLog = document.getElementById('error-log');
        
        if (!errorLog) {
            console.error('Error log element not found. Message was:', message);
            return;
        }
        
        const notification = document.createElement('div');
        notification.className = `error-notification ${type}`;
        notification.innerHTML = `
            <span class="error-message">${message}</span>
            ${persistent ? '' : '<button class="error-dismiss" onclick="ErrorHandler.dismissNotification(' + id + ')">×</button>'}
        `;
        
        // Clear existing if not persistent
        if (!persistent) {
            errorLog.innerHTML = '';
        }
        
        errorLog.appendChild(notification);
        errorLog.style.display = 'block';
        
        this.notifications.set(id, notification);
        
        if (!persistent) {
            setTimeout(() => {
                this.dismissNotification(id);
            }, type === 'success' ? 3000 : 8000);
        }
        
        return id;
    },
    
    dismissNotification(id) {
        const notification = this.notifications.get(id);
        if (notification && notification.parentNode) {
            notification.parentNode.removeChild(notification);
            this.notifications.delete(id);
            
            // Hide container if empty
            const errorLog = document.getElementById('error-log');
            if (errorLog.children.length === 0) {
                errorLog.style.display = 'none';
            }
        }
    },
    
    showRetryableError(message, retryAction) {
        const id = Date.now();
        const errorLog = document.getElementById('error-log');
        
        const notification = document.createElement('div');
        notification.className = 'error-notification error retryable';
        notification.innerHTML = `
            <span class="error-message">${message}</span>
            <button class="error-retry" onclick="ErrorHandler.handleRetry(${id})">Retry</button>
            <button class="error-dismiss" onclick="ErrorHandler.dismissNotification(${id})">×</button>
        `;
        
        errorLog.appendChild(notification);
        errorLog.style.display = 'block';
        
        this.notifications.set(id, notification);
        this.retryActions.set(id, retryAction);
        
        return id;
    },
    
    async handleRetry(id) {
        const retryAction = this.retryActions.get(id);
        if (retryAction) {
            try {
                this.dismissNotification(id);
                this.showNotification('Retrying...', 'info');
                await retryAction();
                this.showNotification('Retry successful', 'success');
            } catch (error) {
                this.showRetryableError(`Retry failed: ${error.message}`, retryAction);
            }
        }
    },
    
    // Convenience methods
    showSuccess(message) {
        return this.showNotification(message, 'success');
    },
    
    showError(message) {
        return this.showNotification(message, 'error');
    },
    
    showWarning(message) {
        return this.showNotification(message, 'warning');
    },
    
    showInfo(message) {
        return this.showNotification(message, 'info');
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorHandler;
} else {
    window.ErrorHandler = ErrorHandler;
}