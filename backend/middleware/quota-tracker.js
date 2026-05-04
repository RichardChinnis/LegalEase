const { logger } = require('../logger');

/**
 * Quota Tracker - Monitors Congress API rate limit headers and manages dynamic throttling
 * 
 * Tracks the x-ratelimit-remaining header from Congress API responses to implement
 * dynamic rate limiting that allows burst requests when quota is high and throttles
 * when approaching the 5000/hour limit.
 */
class QuotaTracker {
  constructor(config = {}) {
    this.remainingRequests = 5000; // Start optimistic - assume full quota
    this.totalLimit = 5000; // Congress API limit
    this.lastUpdated = Date.now(); // Initialize with current time
    this.throttleThreshold = config.throttleThreshold || 2000;
    this.staleTimeout = config.staleTimeout || 5 * 60 * 1000; // 5 minutes
    
    logger.info('QuotaTracker initialized', {
      throttleThreshold: this.throttleThreshold,
      staleTimeout: this.staleTimeout
    });
  }
  
  /**
   * Update quota information from Congress API response headers
   * @param {Object} headers - HTTP response headers from Congress API
   */
  updateFromHeaders(headers) {
    try {
      const remaining = parseInt(headers['x-ratelimit-remaining']);
      const limit = parseInt(headers['x-ratelimit-limit']);
      
      if (!isNaN(remaining)) {
        const previousRemaining = this.remainingRequests;
        this.remainingRequests = remaining;
        this.lastUpdated = Date.now();
        
        if (!isNaN(limit)) {
          this.totalLimit = limit;
        }
        
        // Log significant quota changes
        if (Math.abs(previousRemaining - remaining) > 10 || this.shouldThrottle() !== this.wasThrottling(previousRemaining)) {
          logger.info('Quota updated', {
            remaining: this.remainingRequests,
            total: this.totalLimit,
            throttling: this.shouldThrottle(),
            percentage: ((this.remainingRequests / this.totalLimit) * 100).toFixed(1) + '%'
          });
        }
      } else {
        logger.warn('Invalid x-ratelimit-remaining header', { 
          header: headers['x-ratelimit-remaining'] 
        });
      }
    } catch (error) {
      logger.error('Error updating quota from headers', { error: error.message, headers });
    }
  }
  
  /**
   * Check if requests should be throttled based on remaining quota
   * @returns {boolean} True if throttling should be applied
   */
  shouldThrottle() {
    return this.remainingRequests < this.throttleThreshold;
  }
  
  /**
   * Helper to check if previous quota would have triggered throttling
   * @param {number} previousRemaining 
   * @returns {boolean}
   */
  wasThrottling(previousRemaining) {
    return previousRemaining < this.throttleThreshold;
  }
  
  /**
   * Check if quota data is stale and needs refresh
   * @returns {boolean} True if quota data is too old to trust
   */
  isStale() {
    return !this.lastUpdated || (Date.now() - this.lastUpdated) > this.staleTimeout;
  }
  
  /**
   * Get current quota status for logging/monitoring
   * @returns {Object} Current quota information
   */
  getStatus() {
    return {
      remaining: this.remainingRequests,
      total: this.totalLimit,
      throttling: this.shouldThrottle(),
      stale: this.isStale(),
      lastUpdated: this.lastUpdated,
      percentage: ((this.remainingRequests / this.totalLimit) * 100).toFixed(1) + '%'
    };
  }
  
  /**
   * Force throttling mode (used when Congress API returns 429)
   */
  forceThrottle() {
    logger.warn('Forcing throttle mode due to API rate limit response');
    this.remainingRequests = 0;
    this.lastUpdated = Date.now();
  }
  
  /**
   * Reset quota to full (used for testing or quota window reset)
   */
  reset() {
    logger.info('Quota tracker reset to full quota');
    this.remainingRequests = this.totalLimit;
    this.lastUpdated = Date.now();
  }
}

// Create singleton instance
let quotaTracker = null;

/**
 * Get or create the quota tracker singleton
 * @param {Object} config - Configuration options
 * @returns {QuotaTracker} The quota tracker instance
 */
function getQuotaTracker(config = {}) {
  if (!quotaTracker) {
    quotaTracker = new QuotaTracker(config);
  }
  return quotaTracker;
}

module.exports = {
  QuotaTracker,
  getQuotaTracker
};