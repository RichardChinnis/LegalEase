const axios = require('axios');
const { logger } = require('../logger');
const config = require('../config');
const { AppError, BadRequestError } = require('../utils/errors');
const { getQuotaTracker } = require('../middleware/quota-tracker');

class CongressAPIClient {
  constructor(cache) {
    this.cache = cache;
    this.baseURL = config.api.congressBase;
    this.timeout = config.api.timeout;
    this.userAgent = config.api.userAgent;
    this.quotaTracker = getQuotaTracker(config.quota);

    // Retry configuration for transient errors
    this.retryConfig = {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      // Retry on these status codes (transient server errors)
      retryableStatuses: [502, 503, 504, 408],
      // Also retry on network errors
      retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND']
    };
  }

  /**
   * Sleep helper for retry delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determine if an error is retryable
   */
  isRetryable(error) {
    // Check for retryable HTTP status codes
    if (error.response?.status && this.retryConfig.retryableStatuses.includes(error.response.status)) {
      return true;
    }
    // Check for retryable network errors
    if (error.code && this.retryConfig.retryableErrors.includes(error.code)) {
      return true;
    }
    return false;
  }

  /**
   * Calculate delay for retry attempt with exponential backoff
   */
  getRetryDelay(attempt) {
    const delay = this.retryConfig.initialDelayMs * Math.pow(2, attempt - 1);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  // Generic proxy function with retry logic for transient errors
  async get(endpoint, params = {}) {
    // Create deterministic cache key by sorting parameters
    const sortedParams = Object.keys(params).sort().reduce((sorted, key) => {
      sorted[key] = params[key];
      return sorted;
    }, {});
    const cacheKey = `${endpoint}-${JSON.stringify(sortedParams)}`;

    // Check cache first
    const cachedData = this.cache.get(cacheKey);
    if (cachedData) {
      return { data: cachedData, fromCache: true };
    }

    let lastError = null;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const response = await axios.get(`${this.baseURL}${endpoint}`, {
          params: {
            ...params,
            api_key: process.env.CONGRESS_API_KEY,
            format: 'json',
          },
          timeout: this.timeout,
          headers: {
            'User-Agent': this.userAgent,
          },
        });

        // Cache the response with appropriate timeout
        const dataType = config.getDataTypeFromEndpoint(endpoint);
        const timeoutMs = config.getCacheTimeout(dataType);
        const timeoutSeconds = Math.floor(timeoutMs / 1000);
        this.cache.set(cacheKey, response.data, timeoutSeconds);

        // Update quota tracker with latest header information
        if (config.quota.enabled && response.headers) {
          this.quotaTracker.updateFromHeaders(response.headers);
        }

        // Return data with headers for rate limiting info
        return {
          data: response.data,
          fromCache: false,
          headers: {
            'x-ratelimit-remaining': response.headers['x-ratelimit-remaining'],
            'x-ratelimit-limit': response.headers['x-ratelimit-limit'],
            'x-ratelimit-reset': response.headers['x-ratelimit-reset'],
          },
        };
      } catch (error) {
        lastError = error;

        // Sanitize error message to prevent API key exposure
        const sanitizedMessage = error.message.replace(/api_key=[^&\\s]+/g, 'api_key=***');

        // Check if this error is retryable and we have attempts left
        if (this.isRetryable(error) && attempt < this.retryConfig.maxAttempts) {
          const delay = this.getRetryDelay(attempt);
          logger.warn('Congress API request failed, retrying', {
            endpoint,
            attempt,
            maxAttempts: this.retryConfig.maxAttempts,
            status: error.response?.status,
            error: sanitizedMessage,
            retryDelayMs: delay
          });
          await this.sleep(delay);
          continue;
        }

        // Non-retryable error or exhausted retries - log and throw
        if (attempt > 1) {
          logger.error('Congress API request failed after retries', {
            endpoint,
            attempts: attempt,
            error: sanitizedMessage,
            status: error.response?.status,
            statusText: error.response?.statusText,
          });
        } else {
          logger.error('Congress API request failed', {
            endpoint,
            error: sanitizedMessage,
            status: error.response?.status,
            statusText: error.response?.statusText,
          });
        }

        // Handle rate limiting specifically
        if (error.response?.status === 429) {
          // Force quota tracker to throttle mode when we hit 429
          if (config.quota.enabled) {
            this.quotaTracker.forceThrottle();
            logger.warn('Received 429 from Congress API - forced quota tracker to throttle mode');
          }

          throw new AppError(
            'Congress API rate limit exceeded. Please try again later.',
            429
          );
        }

        throw new AppError(
          `Congress API Error: ${sanitizedMessage}`,
          error.response?.status || 502
        );
      }
    }

    // This shouldn't be reached, but just in case
    throw new AppError('Congress API request failed after all retry attempts', 502);
  }
}

module.exports = { CongressAPIClient };