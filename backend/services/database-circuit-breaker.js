const { logger } = require('../logger');

/**
 * Database Circuit Breaker Implementation
 * 
 * Implements the Circuit Breaker pattern to handle database failures gracefully
 * with automatic fallback to Congress API when database is unavailable.
 * 
 * Circuit States:
 * - CLOSED: Normal operation, requests pass through to database
 * - OPEN: Database is failing, all requests are rejected or use fallback
 * - HALF_OPEN: Recovery testing, limited requests allowed through
 */
class DatabaseCircuitBreaker {
  constructor(options = {}) {
    // Circuit breaker configuration
    this.failureThreshold = options.failureThreshold || 5;        // Failures before opening
    this.resetTimeout = options.resetTimeout || 60000;           // 1 minute before trying again
    this.monitoringWindow = options.monitoringWindow || 60000;   // 1 minute failure window
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;       // Max calls in half-open state
    
    // Success criteria for closing from half-open
    this.successThreshold = options.successThreshold || 2;       // Successes needed to close
    
    // State management
    this.state = 'CLOSED';  // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.halfOpenCalls = 0;
    
    // Failure history for monitoring window
    this.failureHistory = [];
    
    // Metrics collection
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      fallbackCalls: 0,
      circuitOpens: 0,
      circuitCloses: 0,
      currentState: this.state,
      lastStateChange: this.lastStateChange
    };
    
    // Cleanup interval for failure history
    this.cleanupInterval = setInterval(() => {
      this.cleanupFailureHistory();
    }, 30000); // Clean up every 30 seconds
    
    logger.info('Database Circuit Breaker initialized', {
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
      monitoringWindow: this.monitoringWindow,
      state: this.state
    });
  }

  /**
   * Execute a database operation with circuit breaker protection
   * @param {Function} databaseOperation - The database operation to execute
   * @param {Function} fallbackOperation - Fallback operation (usually Congress API call)
   * @param {Object} context - Operation context for logging
   * @returns {Promise} Result from database or fallback operation
   */
  async execute(databaseOperation, fallbackOperation = null, context = {}) {
    this.metrics.totalCalls++;
    
    const operationStart = Date.now();
    const state = this.getState();
    
    logger.debug('Circuit breaker executing operation', {
      state,
      context,
      failures: this.failures,
      successes: this.successes
    });

    // If circuit is OPEN, skip database and use fallback
    if (state === 'OPEN') {
      if (fallbackOperation) {
        this.metrics.fallbackCalls++;
        logger.info('Circuit breaker OPEN - using fallback', { context });
        
        try {
          const result = await fallbackOperation();
          logger.debug('Fallback operation successful', { 
            context, 
            duration: Date.now() - operationStart 
          });
          return { 
            data: result, 
            source: 'congress-api', 
            circuitState: 'OPEN' 
          };
        } catch (fallbackError) {
          logger.error('Fallback operation also failed', {
            context,
            error: fallbackError.message,
            duration: Date.now() - operationStart
          });
          throw new Error(`Both database and Congress API are unavailable: ${fallbackError.message}`);
        }
      } else {
        const error = new Error('Circuit breaker is OPEN and no fallback provided');
        error.code = 'CIRCUIT_BREAKER_OPEN';
        throw error;
      }
    }

    // If circuit is HALF_OPEN, limit the number of calls
    if (state === 'HALF_OPEN') {
      this.halfOpenCalls++;
      if (this.halfOpenCalls > this.halfOpenMaxCalls) {
        // Too many calls in half-open, reject this one
        if (fallbackOperation) {
          this.metrics.fallbackCalls++;
          logger.warn('Half-open circuit breaker at capacity - using fallback', { 
            context, 
            halfOpenCalls: this.halfOpenCalls 
          });
          
          const result = await fallbackOperation();
          return { 
            data: result, 
            source: 'congress-api', 
            circuitState: 'HALF_OPEN_CAPACITY' 
          };
        } else {
          const error = new Error('Circuit breaker is HALF_OPEN and at capacity');
          error.code = 'CIRCUIT_BREAKER_HALF_OPEN_CAPACITY';
          throw error;
        }
      }
    }

    // Execute database operation
    try {
      const result = await databaseOperation();
      const duration = Date.now() - operationStart;
      
      // Success! Update metrics and state
      this.onSuccess();
      this.metrics.successfulCalls++;
      
      logger.debug('Database operation successful via circuit breaker', {
        context,
        state: this.state,
        duration: `${duration}ms`
      });

      return { 
        data: result, 
        source: 'database', 
        circuitState: this.state,
        queryTime: duration
      };

    } catch (error) {
      const duration = Date.now() - operationStart;
      
      // Failure! Update metrics and state
      this.onFailure(error);
      this.metrics.failedCalls++;

      logger.error('Database operation failed via circuit breaker', {
        context,
        state: this.state,
        error: error.message,
        errorCode: error.code,
        duration: `${duration}ms`,
        failures: this.failures
      });

      // If we have a fallback and this is a database-related error, use it
      if (fallbackOperation && this.isDatabaseError(error)) {
        this.metrics.fallbackCalls++;
        logger.info('Database operation failed - using fallback', { 
          context, 
          error: error.message 
        });

        try {
          const result = await fallbackOperation();
          logger.debug('Fallback operation successful after database failure', {
            context,
            duration: Date.now() - operationStart
          });
          
          return { 
            data: result, 
            source: 'congress-api', 
            circuitState: this.state,
            fallbackReason: error.message
          };
        } catch (fallbackError) {
          logger.error('Both database and fallback operations failed', {
            context,
            databaseError: error.message,
            fallbackError: fallbackError.message
          });
          throw fallbackError;
        }
      } else {
        // No fallback available or not a database error, re-throw original error
        throw error;
      }
    }
  }

  /**
   * Handle successful database operation
   */
  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.closeCircuit();
      }
    }
    // Always reset failure count on success
    this.failures = 0;
  }

  /**
   * Handle failed database operation
   * @param {Error} error - The error that occurred
   */
  onFailure(error) {
    const now = Date.now();
    this.lastFailureTime = now;
    this.failureHistory.push({ timestamp: now, error: error.message });

    // Count failures within monitoring window
    const recentFailures = this.failureHistory.filter(
      f => now - f.timestamp <= this.monitoringWindow
    ).length;

    this.failures = recentFailures;

    // Open circuit if failure threshold exceeded
    if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.openCircuit();
    } else if (this.state === 'HALF_OPEN') {
      // Any failure in half-open state opens the circuit
      this.openCircuit();
    }
  }

  /**
   * Open the circuit breaker
   */
  openCircuit() {
    if (this.state !== 'OPEN') {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
      this.halfOpenCalls = 0;
      this.successes = 0;
      this.metrics.circuitOpens++;
      this.metrics.currentState = this.state;
      this.metrics.lastStateChange = this.lastStateChange;

      logger.warn('Circuit breaker OPENED', {
        failures: this.failures,
        failureThreshold: this.failureThreshold,
        previousState: this.metrics.currentState
      });
    }
  }

  /**
   * Close the circuit breaker
   */
  closeCircuit() {
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
      this.failures = 0;
      this.successes = 0;
      this.halfOpenCalls = 0;
      this.metrics.circuitCloses++;
      this.metrics.currentState = this.state;
      this.metrics.lastStateChange = this.lastStateChange;

      logger.info('Circuit breaker CLOSED - normal operation restored', {
        previousState: this.state
      });
    }
  }

  /**
   * Move to half-open state
   */
  halfOpenCircuit() {
    if (this.state !== 'HALF_OPEN') {
      this.state = 'HALF_OPEN';
      this.lastStateChange = Date.now();
      this.halfOpenCalls = 0;
      this.successes = 0;
      this.metrics.currentState = this.state;
      this.metrics.lastStateChange = this.lastStateChange;

      logger.info('Circuit breaker moved to HALF_OPEN - testing recovery');
    }
  }

  /**
   * Get current circuit breaker state with automatic state transitions
   * @returns {string} Current state
   */
  getState() {
    // If circuit is OPEN, check if we should try half-open
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.resetTimeout) {
        this.halfOpenCircuit();
      }
    }
    
    return this.state;
  }

  /**
   * Determine if an error is database-related and should trigger circuit breaker
   * @param {Error} error - The error to analyze
   * @returns {boolean} True if this is a database error
   */
  isDatabaseError(error) {
    const databaseErrorCodes = [
      'ECONNREFUSED',      // Connection refused
      'ECONNRESET',        // Connection reset
      'ETIMEDOUT',         // Connection timeout
      'ENOTFOUND',         // Host not found
      'EHOSTUNREACH',      // Host unreachable
      '53300',             // PostgreSQL too many connections
      '57P01',             // PostgreSQL admin shutdown
      '57P03',             // PostgreSQL cannot connect now
      'STALE_DATA',        // Custom: Data freshness validation failed
      '42P01',             // PostgreSQL relation does not exist
      '42883'              // PostgreSQL function does not exist
    ];

    const databaseErrorMessages = [
      'connection terminated',
      'server closed the connection',
      'connection timeout',
      'too many clients',
      'database is shutting down',
      'data is stale'
    ];

    // Check error codes
    if (error.code && databaseErrorCodes.includes(error.code)) {
      return true;
    }

    // Check error messages
    const errorMessage = (error.message || '').toLowerCase();
    return databaseErrorMessages.some(msg => errorMessage.includes(msg));
  }

  /**
   * Clean up old entries from failure history
   */
  cleanupFailureHistory() {
    const cutoff = Date.now() - this.monitoringWindow * 2;
    this.failureHistory = this.failureHistory.filter(f => f.timestamp > cutoff);
  }

  /**
   * Get circuit breaker metrics
   * @returns {Object} Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      currentState: this.state,
      failures: this.failures,
      successes: this.successes,
      halfOpenCalls: this.halfOpenCalls,
      timeSinceLastFailure: this.lastFailureTime ? Date.now() - this.lastFailureTime : null,
      timeSinceStateChange: Date.now() - this.lastStateChange,
      failureHistorySize: this.failureHistory.length,
      uptime: Date.now() - this.lastStateChange
    };
  }

  /**
   * Reset circuit breaker to initial state (for testing/admin purposes)
   */
  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.halfOpenCalls = 0;
    this.failureHistory = [];
    
    // Reset metrics
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      fallbackCalls: 0,
      circuitOpens: 0,
      circuitCloses: 0,
      currentState: this.state,
      lastStateChange: this.lastStateChange
    };

    logger.info('Circuit breaker manually reset');
  }

  /**
   * Manually force circuit breaker state (for testing/admin purposes)
   * @param {string} state - State to force (CLOSED, OPEN, HALF_OPEN)
   */
  forceState(state) {
    if (['CLOSED', 'OPEN', 'HALF_OPEN'].includes(state)) {
      const previousState = this.state;
      this.state = state;
      this.lastStateChange = Date.now();
      this.metrics.currentState = state;
      this.metrics.lastStateChange = this.lastStateChange;
      
      logger.warn('Circuit breaker state manually forced', {
        previousState,
        newState: state
      });
    } else {
      throw new Error(`Invalid circuit breaker state: ${state}`);
    }
  }

  /**
   * Health check for circuit breaker
   * @returns {Object} Health status
   */
  healthCheck() {
    const metrics = this.getMetrics();
    const isHealthy = this.state === 'CLOSED' || 
                     (this.state === 'HALF_OPEN' && this.successes > 0);

    return {
      healthy: isHealthy,
      state: this.state,
      ...metrics,
      recommendations: this.getRecommendations()
    };
  }

  /**
   * Get operational recommendations based on current state
   * @returns {Array} Array of recommendation strings
   */
  getRecommendations() {
    const recommendations = [];
    
    if (this.state === 'OPEN') {
      recommendations.push('Database is currently unavailable - investigate connection issues');
      recommendations.push('Check database server health and connectivity');
    }
    
    if (this.failures > this.failureThreshold * 0.8) {
      recommendations.push('High failure rate detected - monitor database performance');
    }
    
    if (this.metrics.fallbackCalls > this.metrics.successfulCalls * 0.5) {
      recommendations.push('High fallback usage - consider database optimization');
    }
    
    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      recommendations.push('Circuit breaker testing capacity reached - results pending');
    }

    return recommendations;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    logger.info('Circuit breaker destroyed and cleaned up');
  }
}

module.exports = { DatabaseCircuitBreaker };