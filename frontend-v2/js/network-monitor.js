// Network connectivity monitoring
const NetworkMonitor = {
    init() {
        window.addEventListener('online', this.handleOnline.bind(this));
        window.addEventListener('offline', this.handleOffline.bind(this));
    },
    
    handleOnline() {
        AppState.isOnline = true;
        ErrorHandler.showNotification('Connection restored', 'success');
        this.processRetryQueue();
    },
    
    handleOffline() {
        AppState.isOnline = false;
        ErrorHandler.showNotification('No internet connection', 'warning', true);
    },
    
    async processRetryQueue() {
        if (AppState.retryQueue.length === 0) return;
        
        const retryItems = [...AppState.retryQueue];
        AppState.retryQueue = [];
        
        for (const item of retryItems) {
            try {
                await item.retry();
                ErrorHandler.showNotification('Retry successful', 'success');
            } catch (error) {
            }
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkMonitor;
} else {
    window.NetworkMonitor = NetworkMonitor;
}