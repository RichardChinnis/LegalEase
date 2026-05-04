/**
 * Analytics Service for Congressional Activity Application
 * 
 * Tracks user interactions, performance metrics, and API usage
 * Privacy-focused implementation with local aggregation
 */

class AnalyticsService {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.userId = this.getUserId(); // Anonymous ID
        this.events = [];
        this.maxEventsInMemory = 100;
        this.batchSize = 10;
        this.flushInterval = 30000; // 30 seconds
        
        // Performance tracking
        this.performanceMetrics = {
            pageLoad: null,
            apiCalls: [],
            userInteractions: [],
            errors: []
        };
        
        // Feature usage tracking
        this.featureUsage = new Map();
        
        // Auto-flush events periodically
        this.startPeriodicFlush();
        
        // Track page load performance
        this.trackPageLoadPerformance();
    }
    
    /**
     * Generate anonymous session ID
     */
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    /**
     * Get or create anonymous user ID
     */
    getUserId() {
        let userId = localStorage.getItem('congress-tracker-analytics-id');
        if (!userId) {
            userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('congress-tracker-analytics-id', userId);
        }
        return userId;
    }
    
    /**
     * Track user interaction event
     */
    track(eventName, properties = {}) {
        const event = {
            id: this.generateEventId(),
            name: eventName,
            timestamp: Date.now(),
            sessionId: this.sessionId,
            userId: this.userId,
            properties: {
                ...properties,
                url: window.location.pathname,
                userAgent: navigator.userAgent,
                screenResolution: `${screen.width}x${screen.height}`,
                viewport: `${window.innerWidth}x${window.innerHeight}`
            }
        };
        
        this.events.push(event);
        
        // Update feature usage
        this.updateFeatureUsage(eventName);
        
        // Flush if we have too many events
        if (this.events.length >= this.maxEventsInMemory) {
            this.flushEvents();
        }
    }
    
    /**
     * Track page view
     */
    trackPageView(page, title = document.title) {
        this.track('page_view', {
            page,
            title,
            referrer: document.referrer,
            timestamp: Date.now()
        });
    }
    
    /**
     * Track search interaction
     */
    trackSearch(query, resultCount = 0, resultTypes = []) {
        this.track('search', {
            query: query.length > 50 ? query.substring(0, 50) + '...' : query, // Truncate long queries
            queryLength: query.length,
            resultCount,
            resultTypes: resultTypes.join(','),
            hasResults: resultCount > 0
        });
    }
    
    /**
     * Track bill interaction
     */
    trackBillInteraction(action, billId, billType = null) {
        this.track('bill_interaction', {
            action, // view, click, share, etc.
            billId,
            billType,
            context: 'dashboard' // Could be dashboard, search, etc.
        });
    }
    
    /**
     * Track representative interaction
     */
    trackRepresentativeInteraction(action, representativeId, chamber = null) {
        this.track('representative_interaction', {
            action, // view, click, contact, etc.
            representativeId,
            chamber,
            context: 'dashboard'
        });
    }
    
    /**
     * Track onboarding flow
     */
    trackOnboarding(step, action, data = {}) {
        this.track('onboarding', {
            step, // location_input, representatives_found, completed
            action, // start, complete, skip, error
            ...data
        });
    }
    
    /**
     * Track API performance
     */
    trackAPICall(endpoint, duration, success = true, errorType = null) {
        const apiEvent = {
            endpoint,
            duration,
            success,
            errorType,
            timestamp: Date.now()
        };
        
        this.performanceMetrics.apiCalls.push(apiEvent);
        
        this.track('api_call', {
            endpoint: endpoint.replace(/\/\d+/g, '/{id}'), // Normalize IDs
            duration,
            success,
            errorType,
            performanceCategory: this.categorizeAPIPerformance(duration)
        });
    }
    
    /**
     * Track errors
     */
    trackError(error, context = '', severity = 'error') {
        const errorEvent = {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'), // Truncate stack trace
            context,
            severity,
            timestamp: Date.now(),
            url: window.location.pathname
        };
        
        this.performanceMetrics.errors.push(errorEvent);
        
        this.track('error', {
            message: error.message,
            context,
            severity,
            type: error.constructor.name,
            hasStack: !!error.stack
        });
    }
    
    /**
     * Track feature usage
     */
    updateFeatureUsage(eventName) {
        const feature = this.getFeatureFromEvent(eventName);
        if (feature) {
            const currentCount = this.featureUsage.get(feature) || 0;
            this.featureUsage.set(feature, currentCount + 1);
        }
    }
    
    /**
     * Map event names to features
     */
    getFeatureFromEvent(eventName) {
        const featureMap = {
            'search': 'search',
            'bill_interaction': 'bill_details',
            'representative_interaction': 'representative_details',
            'onboarding': 'onboarding',
            'page_view': 'navigation'
        };
        
        return featureMap[eventName] || 'other';
    }
    
    /**
     * Categorize API performance
     */
    categorizeAPIPerformance(duration) {
        if (duration < 500) return 'fast';
        if (duration < 2000) return 'normal';
        if (duration < 5000) return 'slow';
        return 'very_slow';
    }
    
    /**
     * Track page load performance
     */
    trackPageLoadPerformance() {
        if (typeof performance !== 'undefined' && performance.navigation) {
            window.addEventListener('load', () => {
                setTimeout(() => {
                    const perfData = performance.getEntriesByType('navigation')[0];
                    if (perfData) {
                        this.performanceMetrics.pageLoad = {
                            loadTime: perfData.loadEventEnd - perfData.fetchStart,
                            domContentLoaded: perfData.domContentLoadedEventEnd - perfData.fetchStart,
                            firstPaint: this.getFirstPaint(),
                            timestamp: Date.now()
                        };
                        
                        this.track('page_performance', {
                            loadTime: this.performanceMetrics.pageLoad.loadTime,
                            domContentLoaded: this.performanceMetrics.pageLoad.domContentLoaded,
                            firstPaint: this.performanceMetrics.pageLoad.firstPaint,
                            performanceCategory: this.categorizePagePerformance(this.performanceMetrics.pageLoad.loadTime)
                        });
                    }
                }, 1000);
            });
        }
    }
    
    /**
     * Get first paint time
     */
    getFirstPaint() {
        if (typeof performance !== 'undefined') {
            const paintEntries = performance.getEntriesByType('paint');
            const firstPaint = paintEntries.find(entry => entry.name === 'first-paint');
            return firstPaint ? firstPaint.startTime : null;
        }
        return null;
    }
    
    /**
     * Categorize page performance
     */
    categorizePagePerformance(loadTime) {
        if (loadTime < 1000) return 'excellent';
        if (loadTime < 2000) return 'good';
        if (loadTime < 4000) return 'fair';
        return 'poor';
    }
    
    /**
     * Generate unique event ID
     */
    generateEventId() {
        return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    
    /**
     * Start periodic event flushing
     */
    startPeriodicFlush() {
        setInterval(() => {
            if (this.events.length > 0) {
                this.flushEvents();
            }
        }, this.flushInterval);
    }
    
    /**
     * Flush events (send to analytics endpoint)
     */
    async flushEvents() {
        if (this.events.length === 0) return;
        
        const eventsToFlush = this.events.splice(0, this.batchSize);
        
        try {
            // In a real implementation, you'd send to your analytics endpoint
            // For now, we'll just aggregate locally and log
            await this.sendToAnalyticsEndpoint(eventsToFlush);
        } catch (error) {
            console.warn('[Analytics] Failed to flush events:', error);
            // Put events back for retry
            this.events.unshift(...eventsToFlush);
        }
    }
    
    /**
     * Send events to analytics endpoint (placeholder)
     */
    async sendToAnalyticsEndpoint(events) {
        // In production, you might send to:
        // - Google Analytics
        // - Mixpanel
        // - Your own analytics service
        // - Local storage for privacy-focused analytics
        
        // For now, store in localStorage for demonstration
        try {
            const stored = JSON.parse(localStorage.getItem('congress-tracker-analytics') || '[]');
            stored.push(...events);
            
            // Keep only recent events (last 7 days)
            const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const recentEvents = stored.filter(event => event.timestamp > weekAgo);
            
            localStorage.setItem('congress-tracker-analytics', JSON.stringify(recentEvents));
        } catch (error) {
            console.warn('[Analytics] Failed to store events locally:', error);
        }
    }
    
    /**
     * Get analytics summary
     */
    getAnalyticsSummary() {
        const stored = JSON.parse(localStorage.getItem('congress-tracker-analytics') || '[]');
        const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const recentEvents = stored.filter(event => event.timestamp > dayAgo);
        
        const summary = {
            totalEvents: stored.length,
            recentEvents: recentEvents.length,
            featureUsage: Object.fromEntries(this.featureUsage),
            performance: this.performanceMetrics,
            topEvents: this.getTopEvents(recentEvents),
            sessionLength: Date.now() - parseInt(this.sessionId.split('_')[1])
        };
        
        return summary;
    }
    
    /**
     * Get top events by frequency
     */
    getTopEvents(events) {
        const eventCounts = {};
        events.forEach(event => {
            eventCounts[event.name] = (eventCounts[event.name] || 0) + 1;
        });
        
        return Object.entries(eventCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([name, count]) => ({ name, count }));
    }
    
    /**
     * Clear analytics data (for privacy)
     */
    clearAnalyticsData() {
        this.events = [];
        this.featureUsage.clear();
        this.performanceMetrics = {
            pageLoad: null,
            apiCalls: [],
            userInteractions: [],
            errors: []
        };
        localStorage.removeItem('congress-tracker-analytics');
    }
}

// Create global analytics instance
const analytics = new AnalyticsService();

// Track initial page view
analytics.trackPageView(window.location.pathname);

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnalyticsService;
} else {
    window.AnalyticsService = AnalyticsService;
    window.analytics = analytics;
}