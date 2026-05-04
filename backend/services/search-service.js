const { logger } = require('../logger');
const { DatabaseService } = require('./database');
const { BadRequestError, InternalServerError, TooManyRequestsError } = require('../utils/errors');

// Bump this when changing search ranking/ordering to invalidate cached results.
// v2: migration 012 — tiered ORDER BY (congress_id, relevance, latest_action_date).
const SEARCH_CACHE_VERSION = 'v2';

// Debug logging for error types
logger.debug('Search service error types loaded', {
  BadRequestError: typeof BadRequestError,
  InternalServerError: typeof InternalServerError, 
  TooManyRequestsError: typeof TooManyRequestsError
});

/**
 * Congressional Search Service
 * Provides full-text search capabilities across Congressional content
 * including bills, hearings, laws, and actions with caching and performance optimization
 */
class SearchService {
  constructor(options = {}) {
    this.database = options.database || new DatabaseService();
    this.cache = options.cache || null; // Node cache instance if available
    this.maxQueryLength = options.maxQueryLength || 500;
    this.minQueryLength = options.minQueryLength || 2;
    this.defaultLimit = options.defaultLimit || null; // No default limit
    this.maxLimit = options.maxLimit || null; // No max limit
    this.cacheTimeout = options.cacheTimeout || 15 * 60; // 15 minutes
    this.rateLimitStore = new Map(); // Simple in-memory rate limiting
    this.rateLimitWindow = options.rateLimitWindow || 60 * 1000; // 1 minute
    this.rateLimitMaxRequests = options.rateLimitMaxRequests || 30;
  }

  /**
   * Validate and sanitize search query
   * @param {string} query - Raw search query
   * @returns {string} - Sanitized query
   */
  validateAndSanitizeQuery(query) {
    if (!query || typeof query !== 'string') {
      throw new BadRequestError('Search query is required and must be a string');
    }

    // Trim whitespace
    const trimmed = query.trim();

    // Check length constraints
    if (trimmed.length < this.minQueryLength) {
      throw new BadRequestError(`Search query must be at least ${this.minQueryLength} characters long`);
    }

    if (trimmed.length > this.maxQueryLength) {
      throw new BadRequestError(`Search query must not exceed ${this.maxQueryLength} characters`);
    }

    // Basic XSS prevention - remove/escape dangerous characters
    const sanitized = trimmed
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .replace(/script/gi, ''); // Remove script tags

    // Additional validation for SQL injection patterns
    const sqlPatterns = /('|(\\)|(;)|(\-\-)|(\|\|)|(\*|\%))/;
    if (sqlPatterns.test(sanitized)) {
      logger.warn('Potentially dangerous search query detected', { 
        query: trimmed,
        ip: 'unknown' // IP will be added by caller
      });
      throw new BadRequestError('Invalid characters in search query');
    }

    return sanitized;
  }

  /**
   * Validate search parameters
   * @param {Object} params - Search parameters
   * @returns {Object} - Validated parameters
   */
  validateSearchParams(params) {
    const validated = {
      query: this.validateAndSanitizeQuery(params.q || params.query),
      limit: params.limit ? parseInt(params.limit) : this.defaultLimit,
      offset: Math.max(parseInt(params.offset) || 0, 0)
    };

    // Validate content types filter
    if (params.contentTypes) {
      const validTypes = ['bills', 'hearings', 'laws', 'actions'];
      const types = Array.isArray(params.contentTypes) 
        ? params.contentTypes 
        : params.contentTypes.split(',');
      
      validated.contentTypes = types.filter(type => 
        validTypes.includes(type.toLowerCase().trim())
      ).map(type => type.toLowerCase().trim());

      if (validated.contentTypes.length === 0) {
        throw new BadRequestError('At least one valid content type must be specified');
      }
    }

    // Validate congress filter
    if (params.congress) {
      const congress = parseInt(params.congress);
      if (isNaN(congress) || congress < 1 || congress > 125) {
        throw new BadRequestError('Congress number must be between 1 and 125');
      }
      validated.congress = congress;
    }

    // Validate sponsor filter
    if (params.sponsor) {
      const sponsor = params.sponsor.toString().trim();
      if (sponsor.length > 100) {
        throw new BadRequestError('Sponsor filter too long');
      }
      validated.sponsor = sponsor;
    }

    // Validate status filter
    if (params.status) {
      const validStatuses = ['introduced', 'passed', 'enacted', 'vetoed'];
      const status = params.status.toLowerCase();
      if (!validStatuses.includes(status)) {
        throw new BadRequestError('Invalid status filter');
      }
      validated.status = status;
    }

    // Validate sort parameter
    if (params.sortBy) {
      const validSorts = ['relevance', 'date', 'title', 'congress'];
      const sort = params.sortBy.toLowerCase();
      if (!validSorts.includes(sort)) {
        throw new BadRequestError('Invalid sort parameter');
      }
      validated.sortBy = sort;
    } else {
      validated.sortBy = 'relevance'; // Default sort
    }

    return validated;
  }

  /**
   * Check rate limit for client
   * @param {string} clientId - Client identifier (IP address)
   */
  checkRateLimit(clientId) {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;
    
    if (!this.rateLimitStore.has(clientId)) {
      this.rateLimitStore.set(clientId, []);
    }

    const requests = this.rateLimitStore.get(clientId);
    
    // Remove old requests outside the window
    const validRequests = requests.filter(time => time > windowStart);
    
    if (validRequests.length >= this.rateLimitMaxRequests) {
      logger.warn('Rate limit exceeded', { clientId, requestCount: validRequests.length });
      throw new TooManyRequestsError('Too many search requests. Please try again later.');
    }

    // Add current request
    validRequests.push(now);
    this.rateLimitStore.set(clientId, validRequests);

    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance
      this.cleanupRateLimitStore();
    }
  }

  /**
   * Clean up old rate limit entries
   */
  cleanupRateLimitStore() {
    const cutoff = Date.now() - this.rateLimitWindow * 2;
    for (const [clientId, requests] of this.rateLimitStore.entries()) {
      const validRequests = requests.filter(time => time > cutoff);
      if (validRequests.length === 0) {
        this.rateLimitStore.delete(clientId);
      } else {
        this.rateLimitStore.set(clientId, validRequests);
      }
    }
  }

  /**
   * Generate cache key for search query
   * @param {Object} params - Validated search parameters
   * @returns {string} - Cache key
   */
  generateCacheKey(params) {
    const keyParts = [
      'search',
      SEARCH_CACHE_VERSION,
      params.query,
      params.limit,
      params.offset,
      params.contentTypes?.join(',') || 'all',
      params.congress || 'all',
      params.sponsor || '',
      params.status || '',
      params.sortBy
    ];
    return keyParts.join(':');
  }

  /**
   * Get cached search results
   * @param {string} cacheKey - Cache key
   * @returns {Object|null} - Cached results or null
   */
  getCachedResults(cacheKey) {
    if (!this.cache) {
      return null;
    }

    try {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.debug('Cache hit for search', { cacheKey });
        return {
          ...cached,
          fromCache: true,
          cacheTimestamp: cached.timestamp
        };
      }
    } catch (error) {
      logger.warn('Cache retrieval error', { error: error.message, cacheKey });
    }

    return null;
  }

  /**
   * Cache search results
   * @param {string} cacheKey - Cache key
   * @param {Object} results - Search results
   */
  setCachedResults(cacheKey, results) {
    if (!this.cache) {
      return;
    }

    try {
      const cacheData = {
        ...results,
        timestamp: new Date().toISOString()
      };
      this.cache.set(cacheKey, cacheData, this.cacheTimeout);
      logger.debug('Search results cached', { cacheKey, resultCount: results.results?.length || 0 });
    } catch (error) {
      logger.warn('Cache storage error', { error: error.message, cacheKey });
    }
  }

  /**
   * Execute database search based on content types
   * @param {Object} params - Validated search parameters
   * @returns {Object} - Search results
   */
  async executeSearch(params) {
    const startTime = Date.now();

    try {
      let results;
      let total = 0;

      // Determine which search function to use based on content types
      const searchBillsOnly = params.contentTypes && 
        params.contentTypes.length === 1 && 
        params.contentTypes[0] === 'bills';

      if (searchBillsOnly) {
        // Use the bills-only search function with filtering for better performance
        logger.debug('Using bills-only search with filtering', { 
          query: params.query,
          congress: params.congress,
          sponsor: params.sponsor,
          status: params.status
        });
        const result = await this.database.query(
          'SELECT * FROM search_bills_only_filtered($1, $2, $3, $4, $5)',
          [
            params.query, 
            params.limit ? params.limit + params.offset : null,
            params.congress || null,
            params.sponsor || null,
            params.status || null
          ]
        );
        // Handle offset client-side since DB function doesn't support it
        results = params.limit ? result.rows.slice(params.offset) : result.rows;
        
        
      } else {
        // Use the general search function with filtering
        logger.debug('Using general congressional search with filtering', { 
          query: params.query, 
          contentTypes: params.contentTypes,
          congress: params.congress,
          sponsor: params.sponsor,
          status: params.status
        });
        const result = await this.database.query(
          'SELECT * FROM search_congressional_content($1, $2)',
          [
            params.query, 
            params.limit ? params.limit + params.offset : null
          ]
        );
        // Handle offset client-side since DB function doesn't support it
        results = params.limit ? result.rows.slice(params.offset) : result.rows;
        
      }

      // Get total count for pagination (simplified - use result count)
      total = results.length;

      // Filtering is now handled in the database, no need for client-side filtering
      let filteredResults = results;

      // Apply sorting
      filteredResults = this.sortResults(filteredResults, params.sortBy);

      const executionTime = Date.now() - startTime;

      logger.info('Search executed successfully', {
        query: params.query,
        resultCount: filteredResults.length,
        executionTime: `${executionTime}ms`,
        contentTypes: params.contentTypes,
        fromCache: false
      });

      return {
        results: filteredResults,
        total: total,
        query: params.query,
        limit: params.limit,
        offset: params.offset,
        executionTime,
        contentTypes: params.contentTypes || ['all'],
        filters: {
          congress: params.congress,
          sponsor: params.sponsor,
          status: params.status
        },
        sortBy: params.sortBy,
        fromCache: false
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Search execution failed', {
        query: params.query,
        executionTime: `${executionTime}ms`,
        error: error.message,
        stack: error.stack
      });

      if (error.code === '42883') { // Function does not exist
        throw new InternalServerError('Search functionality is not available. Please contact support.');
      } else if (error.code === '42P01') { // Table does not exist
        throw new InternalServerError('Search database is not properly configured.');
      } else {
        throw new InternalServerError('Search failed due to a database error.');
      }
    }
  }

  /**
   * Sort search results
   * @param {Array} results - Search results
   * @param {string} sortBy - Sort parameter
   * @returns {Array} - Sorted results
   */
  sortResults(results, sortBy) {
    switch (sortBy) {
      case 'date':
        return results.sort((a, b) => {
          const dateA = new Date(a.introduced_date || a.update_date || 0);
          const dateB = new Date(b.introduced_date || b.update_date || 0);
          return dateB - dateA; // Newest first
        });
      
      case 'title':
        return results.sort((a, b) => {
          const titleA = (a.title || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase();
          return titleA.localeCompare(titleB);
        });
      
      case 'congress':
        return results.sort((a, b) => (b.congress || 0) - (a.congress || 0));
      
      case 'relevance':
      default:
        // Results from database function should already be sorted by relevance
        return results;
    }
  }

  /**
   * Map content type from database result
   * @param {Object} result - Database result
   * @returns {string} - Mapped content type
   */
  mapContentType(result) {
    if (result.entity_type) {
      return result.entity_type;
    }
    if (result.bill_id) {
      return result.type || 'bill'; // Return the actual bill type (hr, s, etc.) or default to 'bill'
    }
    if (result.jacket_number) {
      return 'hearing';
    }
    return result.type || result.content_type || 'bill';
  }

  /**
   * Format search results for API response
   * @param {Object} searchResults - Raw search results
   * @returns {Object} - Formatted results
   */
  formatResults(searchResults) {
    const formattedResults = searchResults.results.map(result => {
      // Create formatted result with only non-null values that the frontend needs
      const formatted = {
        // Core identifiers - always include these
        id: result.entity_id || result.bill_id,
        type: result.type || result.entity_type,
        congress: result.congress_id,
        title: result.title,
        relevanceScore: result.rank || result.relevance_score || 0
      };

      // Add bill-specific fields if they exist
      if (result.number) {
        formatted.number = result.number;
      }
      
      // Add hearing-specific fields if they exist  
      if (result.chamber) {
        formatted.chamber = result.chamber;
      }
      if (result.jacketNumber || result.jacket_number || result.jacketnumber) {
        formatted.jacketNumber = result.jacketNumber || result.jacket_number || result.jacketnumber;
      }

      // Add other fields only if they have values
      if (result.summary) {
        formatted.summary = result.summary;
      }
      if (result.introduced_date || result.date_field) {
        formatted.introducedDate = result.introduced_date || result.date_field;
      }
      if (result.update_date) {
        formatted.updateDate = result.update_date;
      }
      if (result.latest_action_date) {
        formatted.latestActionDate = result.latest_action_date;
      }
      if (result.latest_action) {
        formatted.latestAction = result.latest_action;
      }
      if (result.sponsor) {
        formatted.sponsor = result.sponsor;
      }
      if (result.url) {
        formatted.url = result.url;
      }
      if (result.snippet) {
        formatted.snippet = result.snippet;
      }
      if (result.policy_area) {
        formatted.policyArea = result.policy_area;
      }

      return formatted;
    });

    return {
      ...searchResults,
      results: formattedResults
    };
  }

  /**
   * Main search method
   * @param {Object} params - Search parameters
   * @param {string} clientId - Client identifier for rate limiting
   * @returns {Object} - Search results
   */
  async search(params, clientId = 'unknown') {
    // Rate limiting check
    this.checkRateLimit(clientId);

    // Validate and sanitize parameters
    const validatedParams = this.validateSearchParams(params);

    // Generate cache key
    const cacheKey = this.generateCacheKey(validatedParams);

    // Check cache first
    const cachedResults = this.getCachedResults(cacheKey);
    if (cachedResults) {
      return this.formatResults(cachedResults);
    }

    // Execute search
    const searchResults = await this.executeSearch(validatedParams);

    // Cache results
    this.setCachedResults(cacheKey, searchResults);

    // Return formatted results
    return this.formatResults(searchResults);
  }

  /**
   * Get search analytics/metrics
   * @returns {Object} - Search metrics
   */
  getMetrics() {
    return {
      rateLimitStore: {
        activeClients: this.rateLimitStore.size,
        totalRequests: Array.from(this.rateLimitStore.values())
          .reduce((sum, requests) => sum + requests.length, 0)
      },
      cache: this.cache ? {
        keys: this.cache.keys().length,
        stats: this.cache.getStats()
      } : null,
      config: {
        maxQueryLength: this.maxQueryLength,
        minQueryLength: this.minQueryLength,
        defaultLimit: this.defaultLimit,
        maxLimit: this.maxLimit,
        cacheTimeout: this.cacheTimeout,
        rateLimitWindow: this.rateLimitWindow,
        rateLimitMaxRequests: this.rateLimitMaxRequests
      }
    };
  }

  /**
   * Health check for search service
   * @returns {Object} - Health status
   */
  async healthCheck() {
    try {
      // Test database connection
      await this.database.testConnection();

      // Test search functionality with a simple query
      const testParams = {
        q: 'test',
        limit: 1
      };
      const testResults = await this.executeSearch(this.validateSearchParams(testParams));

      return {
        status: 'healthy',
        database: 'connected',
        cache: this.cache ? 'available' : 'disabled',
        timestamp: new Date().toISOString(),
        testQuery: testResults ? 'successful' : 'failed'
      };
    } catch (error) {
      logger.error('Search service health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = { SearchService };