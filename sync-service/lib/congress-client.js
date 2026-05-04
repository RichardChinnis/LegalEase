const axios = require('axios');
const pLimit = require('p-limit');
const config = require('../config');
const logger = require('./logger');

/**
 * Circuit Breaker States
 */
const CircuitState = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Blocking requests
  HALF_OPEN: 'HALF_OPEN'  // Testing if service recovered
};

/**
 * Production-grade Congress.gov API client with:
 * - Direct connection to Congress.gov API (no backend proxy)
 * - Quota tracking from response headers
 * - Circuit breaker pattern for outage handling
 * - Exponential backoff with jitter
 * - Extended retryable error handling
 * - API key sanitization in logs
 */
class CongressClient {
  constructor() {
    this.baseURL = config.congressApi.baseUrl;
    this.apiKey = config.congressApi.apiKey;
    this.timeout = config.congressApi.timeout;
    this.limit = pLimit(config.congressApi.rateLimit.concurrent);

    // Request tracking
    this.requestCount = 0;
    this.lastRequestTime = Date.now();

    // Quota tracking
    this.quotaState = {
      remaining: null,
      limit: null,
      lastUpdated: null,
      isThrottled: false,
      isPaused: false
    };

    // Circuit breaker state
    this.circuitState = {
      state: CircuitState.CLOSED,
      failures: 0,
      lastFailureTime: null,
      halfOpenAttempts: 0
    };

    // Configuration shortcuts
    this.retryableErrors = config.congressApi.retryableErrors;
    this.retryableStatuses = config.congressApi.retryableStatuses;
    this.quotaConfig = config.congressApi.quota;
    this.circuitConfig = config.congressApi.circuitBreaker;
  }

  /**
   * Sanitize error messages to remove API key
   */
  sanitizeError(error) {
    if (!error) return error;

    const sanitized = { ...error };

    // Sanitize message
    if (sanitized.message && this.apiKey) {
      sanitized.message = sanitized.message.replace(
        new RegExp(this.apiKey, 'g'),
        '[API_KEY_REDACTED]'
      );
    }

    // Sanitize URL in config
    if (sanitized.config?.url && this.apiKey) {
      sanitized.config.url = sanitized.config.url.replace(
        new RegExp(this.apiKey, 'g'),
        '[API_KEY_REDACTED]'
      );
    }

    // Sanitize params
    if (sanitized.config?.params?.api_key) {
      sanitized.config.params.api_key = '[API_KEY_REDACTED]';
    }

    return sanitized;
  }

  /**
   * Calculate exponential backoff with jitter
   */
  calculateBackoff(attempt) {
    const baseDelay = config.congressApi.retryDelay;
    const maxDelay = 60000; // 60 seconds max

    // Exponential: 1s, 2s, 4s, 8s, 16s...
    const exponentialDelay = baseDelay * Math.pow(2, attempt);

    // Add jitter: ±25% randomization to prevent thundering herd
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);

    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error) {
    // Network-level errors
    if (error.code && this.retryableErrors.includes(error.code)) {
      return true;
    }

    // HTTP status codes
    if (error.response?.status && this.retryableStatuses.includes(error.response.status)) {
      return true;
    }

    // Axios timeout
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return true;
    }

    return false;
  }

  /**
   * Update quota state from response headers
   */
  updateQuotaFromHeaders(headers) {
    if (!headers) return;

    // Congress.gov uses these headers
    const remaining = headers['x-ratelimit-remaining'];
    const limit = headers['x-ratelimit-limit'];

    if (remaining !== undefined) {
      this.quotaState.remaining = parseInt(remaining, 10);
      this.quotaState.lastUpdated = Date.now();

      // Update throttle state based on thresholds
      const wasThrottled = this.quotaState.isThrottled;
      const wasPaused = this.quotaState.isPaused;

      this.quotaState.isThrottled = this.quotaState.remaining < this.quotaConfig.throttleThreshold;
      this.quotaState.isPaused = this.quotaState.remaining < this.quotaConfig.pauseThreshold;

      // Log state changes
      if (this.quotaState.isThrottled && !wasThrottled) {
        logger.warn('API quota entering throttled state', {
          remaining: this.quotaState.remaining,
          threshold: this.quotaConfig.throttleThreshold
        });
      }

      if (this.quotaState.isPaused && !wasPaused) {
        logger.error('API quota critically low - pausing sync', {
          remaining: this.quotaState.remaining,
          threshold: this.quotaConfig.pauseThreshold
        });
      }
    }

    if (limit !== undefined) {
      this.quotaState.limit = parseInt(limit, 10);
    }
  }

  /**
   * Check if quota state is stale
   */
  isQuotaStale() {
    if (!this.quotaState.lastUpdated) return true;
    return Date.now() - this.quotaState.lastUpdated > this.quotaConfig.staleTimeout;
  }

  /**
   * Circuit breaker: check if we can make a request
   */
  canMakeRequest() {
    switch (this.circuitState.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if reset timeout has passed
        const timeSinceFailure = Date.now() - this.circuitState.lastFailureTime;
        if (timeSinceFailure > this.circuitConfig.resetTimeout) {
          // Transition to half-open
          this.circuitState.state = CircuitState.HALF_OPEN;
          this.circuitState.halfOpenAttempts = 0;
          logger.info('Circuit breaker transitioning to HALF_OPEN state');
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited requests to test
        return this.circuitState.halfOpenAttempts < this.circuitConfig.halfOpenMaxAttempts;

      default:
        return true;
    }
  }

  /**
   * Circuit breaker: record a successful request
   */
  recordSuccess() {
    if (this.circuitState.state === CircuitState.HALF_OPEN) {
      // Service has recovered - close circuit
      this.circuitState.state = CircuitState.CLOSED;
      this.circuitState.failures = 0;
      this.circuitState.halfOpenAttempts = 0;
      logger.info('Circuit breaker CLOSED - service recovered');
    } else if (this.circuitState.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.circuitState.failures = 0;
    }
  }

  /**
   * Circuit breaker: record a failed request
   */
  recordFailure(error) {
    this.circuitState.failures++;
    this.circuitState.lastFailureTime = Date.now();

    if (this.circuitState.state === CircuitState.HALF_OPEN) {
      this.circuitState.halfOpenAttempts++;

      // If we've had too many failures in half-open, go back to open
      if (this.circuitState.halfOpenAttempts >= this.circuitConfig.halfOpenMaxAttempts) {
        this.circuitState.state = CircuitState.OPEN;
        logger.warn('Circuit breaker re-OPENED after half-open failures', {
          attempts: this.circuitState.halfOpenAttempts
        });
      }
    } else if (this.circuitState.state === CircuitState.CLOSED) {
      // Check if we should open the circuit
      if (this.circuitState.failures >= this.circuitConfig.failureThreshold) {
        this.circuitState.state = CircuitState.OPEN;
        logger.error('Circuit breaker OPENED due to consecutive failures', {
          failures: this.circuitState.failures,
          threshold: this.circuitConfig.failureThreshold,
          lastError: this.sanitizeError(error)?.message
        });
      }
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    return {
      circuitState: this.circuitState.state,
      consecutiveFailures: this.circuitState.failures,
      quotaRemaining: this.quotaState.remaining,
      quotaLimit: this.quotaState.limit,
      isThrottled: this.quotaState.isThrottled,
      isPaused: this.quotaState.isPaused,
      quotaStale: this.isQuotaStale(),
      totalRequests: this.requestCount
    };
  }

  /**
   * Enforce rate limiting with quota awareness
   */
  async enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Base delay from config
    let minDelay = 1000 / config.congressApi.rateLimit.requestsPerSecond;

    // If throttled, increase delay
    if (this.quotaState.isThrottled) {
      minDelay = Math.max(minDelay, 2000); // At least 2 seconds when throttled
    }

    if (timeSinceLastRequest < minDelay) {
      await this.sleep(minDelay - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Core request method with all robustness features
   */
  async makeRequest(endpoint, params = {}) {
    // Check circuit breaker
    if (!this.canMakeRequest()) {
      const error = new Error('Circuit breaker is OPEN - Congress.gov API appears unavailable');
      error.code = 'CIRCUIT_OPEN';
      throw error;
    }

    // Check quota pause state
    if (this.quotaState.isPaused && !this.isQuotaStale()) {
      const error = new Error('API quota critically low - sync paused');
      error.code = 'QUOTA_EXHAUSTED';
      throw error;
    }

    // Enforce rate limiting
    await this.enforceRateLimit();

    const url = `${this.baseURL}${endpoint}`;

    // Add API key to params (required for direct Congress.gov access)
    const requestParams = {
      ...params,
      api_key: this.apiKey,
      format: 'json'
    };

    let attempts = 0;
    let lastError = null;

    while (attempts < config.congressApi.retryAttempts) {
      try {
        const response = await axios.get(url, {
          params: requestParams,
          timeout: this.timeout,
          headers: {
            'User-Agent': 'Congress-Sync-Service/2.0'
          }
        });

        // Update quota from response headers
        this.updateQuotaFromHeaders(response.headers);

        // Record success for circuit breaker
        this.recordSuccess();

        this.requestCount++;
        return response.data;

      } catch (error) {
        lastError = error;
        attempts++;

        // Update quota from error response if available
        if (error.response?.headers) {
          this.updateQuotaFromHeaders(error.response.headers);
        }

        // Handle rate limiting (429)
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after']) || 60;
          logger.warn('Rate limit hit (429), waiting', {
            retryAfter,
            endpoint: this.sanitizeEndpoint(endpoint),
            attempt: attempts
          });
          await this.sleep(retryAfter * 1000);
          continue; // Don't count against retry limit
        }

        // Check if error is retryable
        if (this.isRetryableError(error)) {
          const delay = this.calculateBackoff(attempts);

          logger.warn('Retryable error, backing off', {
            endpoint: this.sanitizeEndpoint(endpoint),
            attempt: attempts,
            maxAttempts: config.congressApi.retryAttempts,
            errorCode: error.code,
            status: error.response?.status,
            delay: Math.round(delay)
          });

          await this.sleep(delay);
        } else {
          // Non-retryable error
          this.recordFailure(error);

          // Enhance error message
          const sanitizedError = this.sanitizeError(error);
          logger.error('Non-retryable API error', {
            endpoint: this.sanitizeEndpoint(endpoint),
            status: error.response?.status,
            message: sanitizedError.message
          });

          throw error;
        }
      }
    }

    // All retries exhausted
    this.recordFailure(lastError);

    const finalError = new Error(
      `Failed after ${config.congressApi.retryAttempts} attempts: ${this.sanitizeError(lastError)?.message}`
    );
    finalError.code = 'MAX_RETRIES_EXCEEDED';
    finalError.originalError = lastError;

    throw finalError;
  }

  /**
   * Sanitize endpoint for logging (remove any sensitive data)
   */
  sanitizeEndpoint(endpoint) {
    // Endpoints shouldn't have sensitive data, but be safe
    if (this.apiKey && endpoint.includes(this.apiKey)) {
      return endpoint.replace(this.apiKey, '[REDACTED]');
    }
    return endpoint;
  }

  // ================================================
  // BILL METHODS
  // ================================================

  async getBills(congress, params = {}) {
    const endpoint = `/bill/${congress}`;
    const defaultParams = {
      limit: 250,
      offset: 0,
      sort: 'updateDate desc',
      ...params
    };
    return this.makeRequest(endpoint, defaultParams);
  }

  async getBillDetails(congress, billType, billNumber) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}`;
    return this.makeRequest(endpoint);
  }

  async getBillActions(congress, billType, billNumber, params = {}) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/actions`;
    return this.makeRequest(endpoint, params);
  }

  async getAllBillActions(congress, billType, billNumber) {
    const allActions = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await this.getBillActions(congress, billType, billNumber, {
          offset,
          limit: 250
        });

        if (response.actions && Array.isArray(response.actions)) {
          allActions.push(...response.actions);
          hasMore = response.actions.length === 250;
        } else {
          hasMore = false;
        }
        offset += 250;

        logger.debug('Fetched actions page', {
          congress, billType, billNumber,
          offset,
          pageSize: response.actions ? response.actions.length : 0,
          totalActions: allActions.length
        });

      } catch (error) {
        logger.error('Error fetching actions page', {
          congress, billType, billNumber,
          offset,
          error: this.sanitizeError(error)?.message
        });
        throw error;
      }
    }

    return {
      actions: allActions,
      pagination: { count: allActions.length }
    };
  }

  async getBillSubjects(congress, billType, billNumber, params = {}) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/subjects`;
    return this.makeRequest(endpoint, params);
  }

  async getAllBillSubjects(congress, billType, billNumber) {
    const allSubjects = {
      legislativeSubjects: [],
      policyArea: null
    };
    let offset = 0;
    let hasMore = true;
    const limit = 50;

    while (hasMore) {
      try {
        const response = await this.getBillSubjects(congress, billType, billNumber, {
          offset,
          limit
        });

        if (response.subjects) {
          if (response.subjects.legislativeSubjects && Array.isArray(response.subjects.legislativeSubjects)) {
            allSubjects.legislativeSubjects.push(...response.subjects.legislativeSubjects);
          }

          if (!allSubjects.policyArea && response.subjects.policyArea) {
            allSubjects.policyArea = response.subjects.policyArea;
          }

          const totalCount = response.pagination?.count || 0;
          const fetchedSoFar = offset + (response.subjects.legislativeSubjects?.length || 0);
          hasMore = fetchedSoFar < totalCount;

          logger.info(`Fetched ${response.subjects.legislativeSubjects?.length || 0} subjects (${fetchedSoFar}/${totalCount})`, {
            congress, billType, billNumber, offset
          });

          if (hasMore) {
            offset += limit;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        logger.error('Error fetching subjects page', {
          congress, billType, billNumber,
          offset,
          error: this.sanitizeError(error)?.message
        });
        throw error;
      }
    }

    return {
      subjects: allSubjects,
      pagination: { count: allSubjects.legislativeSubjects.length }
    };
  }

  async getBillCosponsors(congress, billType, billNumber, params = {}) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/cosponsors`;
    return this.makeRequest(endpoint, params);
  }

  async getAllBillCosponsors(congress, billType, billNumber) {
    const allCosponsors = [];
    let offset = 0;
    let hasMore = true;
    const limit = 250;

    while (hasMore) {
      try {
        const response = await this.getBillCosponsors(congress, billType, billNumber, {
          offset,
          limit
        });

        if (response.cosponsors && Array.isArray(response.cosponsors)) {
          allCosponsors.push(...response.cosponsors);

          const totalCount = response.pagination?.count || 0;
          const fetchedSoFar = offset + response.cosponsors.length;
          hasMore = fetchedSoFar < totalCount;

          logger.debug('Fetched cosponsors page', {
            congress, billType, billNumber,
            offset,
            pageSize: response.cosponsors.length,
            totalCosponsors: allCosponsors.length,
            totalCount
          });
        } else {
          hasMore = false;
        }
        offset += limit;
      } catch (error) {
        logger.error('Error fetching cosponsors page', {
          congress, billType, billNumber,
          offset,
          error: this.sanitizeError(error)?.message
        });
        throw error;
      }
    }

    return {
      cosponsors: allCosponsors,
      pagination: { count: allCosponsors.length }
    };
  }

  async getBillCommittees(congress, billType, billNumber) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/committees`;
    return this.makeRequest(endpoint);
  }

  async getBillRelatedBills(congress, billType, billNumber) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/relatedbills`;
    return this.makeRequest(endpoint);
  }

  async getBillSummaries(congress, billType, billNumber) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/summaries`;
    return this.makeRequest(endpoint);
  }

  async getBillTitles(congress, billType, billNumber) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/titles`;
    return this.makeRequest(endpoint);
  }

  async getBillTextVersions(congress, billType, billNumber) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/text`;
    return this.makeRequest(endpoint);
  }

  async getBillAmendments(congress, billType, billNumber, params = {}) {
    const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/amendments`;
    return this.makeRequest(endpoint, params);
  }

  async getAllBillAmendments(congress, billType, billNumber) {
    const allAmendments = [];
    let offset = 0;
    let hasMore = true;
    const limit = 250;

    while (hasMore) {
      try {
        const response = await this.getBillAmendments(congress, billType, billNumber, {
          offset,
          limit
        });

        if (response.amendments && Array.isArray(response.amendments)) {
          allAmendments.push(...response.amendments);

          const totalCount = response.pagination?.count || 0;
          const fetchedSoFar = offset + response.amendments.length;
          hasMore = fetchedSoFar < totalCount;

          logger.info(`Fetched ${response.amendments.length} amendments (${fetchedSoFar}/${totalCount})`, {
            congress, billType, billNumber, offset
          });
        } else {
          hasMore = false;
        }
        offset += limit;
      } catch (error) {
        logger.error('Error fetching amendments page', {
          congress, billType, billNumber,
          offset,
          error: this.sanitizeError(error)?.message
        });
        throw error;
      }
    }

    return {
      amendments: allAmendments,
      pagination: { count: allAmendments.length }
    };
  }

  // ================================================
  // OTHER ENTITY METHODS
  // ================================================

  async getAmendments(congress, params = {}) {
    const endpoint = `/amendment/${congress}`;
    return this.makeRequest(endpoint, params);
  }

  async getHearings(congress, params = {}) {
    const endpoint = `/hearing/${congress}`;
    return this.makeRequest(endpoint, params);
  }

  async getCommitteeReports(congress, params = {}) {
    const endpoint = `/committee-report/${congress}`;
    return this.makeRequest(endpoint, params);
  }

  async getNominations(congress, params = {}) {
    const endpoint = `/nomination/${congress}`;
    return this.makeRequest(endpoint, params);
  }

  async getMembers(params = {}) {
    const endpoint = `/member`;
    return this.makeRequest(endpoint, params);
  }

  async getMemberDetails(bioguideId) {
    const endpoint = `/member/${bioguideId}`;
    return this.makeRequest(endpoint);
  }

  async getMemberSponsoredBills(bioguideId, params = {}) {
    const endpoint = `/member/${bioguideId}/sponsored-legislation`;
    return this.makeRequest(endpoint, params);
  }

  async getMemberCosponsoredBills(bioguideId, params = {}) {
    const endpoint = `/member/${bioguideId}/cosponsored-legislation`;
    return this.makeRequest(endpoint, params);
  }

  async getCommittees(chamber, params = {}) {
    const endpoint = `/committee/${chamber}`;
    return this.makeRequest(endpoint, params);
  }

  async getCurrentCongress() {
    const endpoint = `/congress/current`;
    const response = await this.makeRequest(endpoint);

    if (response.congress) {
      return response.congress.number || response.congress;
    }

    logger.warn('Unexpected response structure from /congress/current', response);
    return 119;
  }

  async getCongressDetails(congressNumber) {
    const endpoint = `/congress/${congressNumber}`;
    const response = await this.makeRequest(endpoint);

    if (response.congress) {
      return {
        congress_id: response.congress.number,
        name: response.congress.name || `${congressNumber}th Congress`,
        start_year: response.congress.startYear,
        end_year: response.congress.endYear,
        sessions: response.congress.sessions
      };
    }

    const startYear = 1789 + (congressNumber - 1) * 2;
    return {
      congress_id: congressNumber,
      name: `${congressNumber}th Congress`,
      start_year: startYear,
      end_year: startYear + 2
    };
  }

  // ================================================
  // PAGINATION HELPER
  // ================================================

  async fetchAllPages(fetchFunction, params = {}, maxPages = null) {
    const results = [];
    let offset = 0;
    let pageCount = 0;
    let hasMore = true;

    while (hasMore && (!maxPages || pageCount < maxPages)) {
      try {
        const response = await fetchFunction({
          ...params,
          offset,
          limit: 250
        });

        if (response.bills) {
          results.push(...response.bills);
          hasMore = response.bills.length === 250;
        } else if (response.amendments) {
          results.push(...response.amendments);
          hasMore = response.amendments.length === 250;
        } else if (response.hearings) {
          results.push(...response.hearings);
          hasMore = response.hearings.length === 250;
        } else if (response.reports) {
          results.push(...response.reports);
          hasMore = response.reports.length === 250;
        } else {
          hasMore = false;
        }

        offset += 250;
        pageCount++;

        logger.debug('Fetched page', {
          offset,
          resultsCount: results.length
        });

      } catch (error) {
        logger.error('Error fetching page', {
          offset,
          error: this.sanitizeError(error)?.message
        });
        hasMore = false;
      }
    }

    return results;
  }

  // ================================================
  // COMMITTEE REPORT METHODS
  // ================================================

  async getCommitteeReportDetails(congress, reportType, reportNumber) {
    const endpoint = `/committee-report/${congress}/${reportType.toUpperCase()}/${reportNumber}`;
    return this.makeRequest(endpoint);
  }

  async getCommitteeReportText(congress, reportType, reportNumber) {
    const endpoint = `/committee-report/${congress}/${reportType.toUpperCase()}/${reportNumber}/text`;
    return this.makeRequest(endpoint);
  }

  // ================================================
  // CONGRESSIONAL RECORD METHODS
  // ================================================

  async getDailyCongressionalRecord(volume, issue) {
    const endpoint = `/daily-congressional-record/${volume}/${issue}`;
    return this.makeRequest(endpoint);
  }

  async getCongressionalRecordArticles(volume, issue, params = {}) {
    const endpoint = `/daily-congressional-record/${volume}/${issue}/articles`;
    return this.makeRequest(endpoint, params);
  }

  async getAllCongressionalRecordArticles(volume, issue) {
    const allArticles = [];
    let offset = 0;
    let hasMore = true;
    const limit = 250;

    while (hasMore) {
      try {
        const response = await this.getCongressionalRecordArticles(volume, issue, {
          offset,
          limit
        });

        if (response.articles && Array.isArray(response.articles)) {
          allArticles.push(...response.articles);
          hasMore = response.articles.length === limit;
        } else {
          hasMore = false;
        }
        offset += limit;

        logger.debug('Fetched CR articles page', {
          volume, issue,
          offset,
          pageSize: response.articles ? response.articles.length : 0,
          totalArticles: allArticles.length
        });

      } catch (error) {
        logger.error('Error fetching CR articles page', {
          volume, issue,
          offset,
          error: this.sanitizeError(error)?.message
        });
        throw error;
      }
    }

    return {
      articles: allArticles,
      pagination: { count: allArticles.length }
    };
  }

  async getCongressionalRecordArticle(articleUrl) {
    try {
      let endpoint = articleUrl;
      if (articleUrl.includes(this.baseURL)) {
        endpoint = articleUrl.replace(this.baseURL, '');
      }
      return this.makeRequest(endpoint);
    } catch (error) {
      logger.warn('Failed to fetch CR article details', {
        articleUrl: this.sanitizeEndpoint(articleUrl),
        error: this.sanitizeError(error)?.message
      });
      return null;
    }
  }

  async getRecentCongressionalRecord(fromDate, toDate, params = {}) {
    const endpoint = '/daily-congressional-record';
    const requestParams = { ...params };

    try {
      const allIssues = [];
      let offset = 0;
      let hasMore = true;
      const limit = 250;

      while (hasMore) {
        const response = await this.makeRequest(endpoint, {
          ...requestParams,
          offset,
          limit
        });

        if (response.dailyCongressionalRecord && Array.isArray(response.dailyCongressionalRecord)) {
          const issues = response.dailyCongressionalRecord.map(record => ({
            volumeNumber: record.volumeNumber,
            issueNumber: record.issueNumber,
            issueDate: record.issueDate,
            congress: record.congress,
            sessionNumber: record.sessionNumber,
            url: record.url
          }));

          const filteredIssues = issues.filter(issue => {
            const issueDate = new Date(issue.issueDate);
            return issueDate >= fromDate && issueDate <= toDate;
          });

          allIssues.push(...filteredIssues);

          const oldestInBatch = issues.length > 0 ? new Date(issues[issues.length - 1].issueDate) : null;
          if (oldestInBatch && oldestInBatch < fromDate) {
            hasMore = false;
          } else {
            hasMore = issues.length === limit;
          }
        } else {
          hasMore = false;
        }
        offset += limit;

        logger.debug('Fetched recent CR issues page', {
          fromDate: fromDate.toISOString().split('T')[0],
          toDate: toDate.toISOString().split('T')[0],
          offset,
          pageSize: response.dailyCongressionalRecord ? response.dailyCongressionalRecord.length : 0,
          totalIssues: allIssues.length
        });
      }

      return allIssues;

    } catch (error) {
      logger.error('Error fetching recent CR issues', {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        error: this.sanitizeError(error)?.message
      });
      throw error;
    }
  }

  async searchCongressionalRecord(query, params = {}) {
    const endpoint = '/daily-congressional-record';
    return this.makeRequest(endpoint, {
      ...params,
      query,
      format: 'json'
    });
  }
}

module.exports = CongressClient;
