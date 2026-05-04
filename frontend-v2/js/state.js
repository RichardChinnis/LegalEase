// Global application state management
const AppState = {
    currentCongress: null,
    bills: new Map(), // Using Map for efficient lookups
    contentList: [], // Holds the combined list of all content for sorting and re-rendering
    detailsQueue: [],
    isLoadingDetails: false,
    errorCount: 0,
    isOnline: navigator.onLine,
    retryQueue: [],
    rateLimitState: {
        isLimited: false,
        retryAfter: null,
        activeRequests: 0
    },
    currentBillCommitteeReports: [], // Stores the list of available reports {congress, type, number}
    committeeReportTexts: new Map(),   // Caches fetched report text, mapping reportId to text
    currentChatContext: null
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppState;
} else {
    window.AppState = AppState;
}
