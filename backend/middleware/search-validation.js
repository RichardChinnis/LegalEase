const Joi = require('joi');
const { logger } = require('../logger');
const { BadRequestError, TooManyRequestsError } = require('../utils/errors');
const { asyncHandler } = require('../utils/error-handler');

/**
 * Search validation middleware using Joi schema validation
 * Includes XSS prevention, parameter sanitization, and rate limiting checks
 */

// Search query validation schema
const searchQuerySchema = Joi.object({
  // Main search query - required
  q: Joi.string()
    .min(2)
    .max(500)
    .pattern(/^[^<>]*$/) // Prevent angle brackets for basic XSS protection
    .required()
    .messages({
      'string.min': 'Search query must be at least 2 characters long',
      'string.max': 'Search query must not exceed 500 characters',
      'string.pattern.base': 'Search query contains invalid characters',
      'any.required': 'Search query (q) parameter is required'
    }),

  // Alternative query parameter name (for compatibility)
  query: Joi.string()
    .min(2)
    .max(500)
    .pattern(/^[^<>]*$/)
    .optional()
    .messages({
      'string.min': 'Search query must be at least 2 characters long',
      'string.max': 'Search query must not exceed 500 characters',
      'string.pattern.base': 'Search query contains invalid characters'
    }),

  // Pagination parameters
  limit: Joi.number()
    .integer()
    .min(1)
    .default(20)
    .messages({
      'number.base': 'Limit must be a number',
      'number.integer': 'Limit must be an integer',
      'number.min': 'Limit must be at least 1'
    }),

  offset: Joi.number()
    .integer()
    .min(0)
    .max(10000)
    .default(0)
    .messages({
      'number.base': 'Offset must be a number',
      'number.integer': 'Offset must be an integer',
      'number.min': 'Offset must be non-negative',
      'number.max': 'Offset cannot exceed 10000'
    }),

  // Content type filtering
  contentTypes: Joi.alternatives()
    .try(
      // Single content type as string
      Joi.string().valid('bills', 'hearings', 'laws', 'actions'),
      // Multiple content types as comma-separated string
      Joi.string().pattern(/^(bills|hearings|laws|actions)(,(bills|hearings|laws|actions))*$/),
      // Array of content types
      Joi.array().items(Joi.string().valid('bills', 'hearings', 'laws', 'actions')).min(1).max(4)
    )
    .optional()
    .messages({
      'alternatives.match': 'Content types must be one or more of: bills, hearings, laws, actions'
    }),

  // Congress filtering
  congress: Joi.number()
    .integer()
    .min(1)
    .max(125)
    .optional()
    .messages({
      'number.base': 'Congress must be a number',
      'number.integer': 'Congress must be an integer',
      'number.min': 'Congress must be at least 1',
      'number.max': 'Congress cannot exceed 125'
    }),

  // Sponsor filtering
  sponsor: Joi.string()
    .max(100)
    .pattern(/^[a-zA-Z\s\-'.,]+$/) // Letters, spaces, hyphens, apostrophes, commas, periods
    .optional()
    .messages({
      'string.max': 'Sponsor filter cannot exceed 100 characters',
      'string.pattern.base': 'Sponsor filter contains invalid characters'
    }),

  // Status filtering
  status: Joi.string()
    .valid('introduced', 'passed', 'enacted', 'vetoed')
    .optional()
    .messages({
      'any.only': 'Status must be one of: introduced, passed, enacted, vetoed'
    }),

  // Sorting
  sortBy: Joi.string()
    .valid('relevance', 'date', 'title', 'congress')
    .default('relevance')
    .optional()
    .messages({
      'any.only': 'Sort must be one of: relevance, date, title, congress'
    }),

  // Format (for future compatibility)
  format: Joi.string()
    .valid('json', 'xml')
    .default('json')
    .optional()
    .messages({
      'any.only': 'Format must be json or xml'
    })

}).or('q', 'query') // Either 'q' or 'query' must be present
  .messages({
    'object.missing': 'Either q or query parameter is required'
  });

/**
 * Advanced XSS prevention function
 * @param {string} input - Input string to sanitize
 * @returns {string} - Sanitized string
 */
function preventXSS(input) {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove on* event handlers
    .replace(/\bon\w+\s*=/gi, '')
    // Remove script content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove common dangerous patterns
    .replace(/eval\s*\(/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/data:text\/html/gi, '')
    // Trim whitespace
    .trim();
}

/**
 * SQL injection prevention function
 * @param {string} input - Input string to check
 * @returns {boolean} - True if potentially dangerous
 */
function hasSQLInjectionPatterns(input) {
  if (typeof input !== 'string') {
    return false;
  }

  const sqlPatterns = [
    /('|(\\)|(;)|(\-\-)|(\|\|))/,                    // Basic SQL injection patterns
    /(\bunion\b|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b)/i,  // SQL keywords
    /(\bdrop\b|\balter\b|\bcreate\b|\btruncate\b)/i, // DDL keywords
    /(\bexec\b|\bexecute\b|\bsp_\w+)/i,             // Stored procedures
    /(\bxp_\w+|\bcmd\b|\bshell\b)/i,                // Command execution
    /(\bconvert\b|\bcast\b|\bchar\b|\bnchar\b)/i,   // Type conversion functions
    /(\bhex\b|\bunhex\b|\bload_file\b)/i            // File operations
  ];

  return sqlPatterns.some(pattern => pattern.test(input));
}

/**
 * Rate limiting store for search requests
 */
class SearchRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 1 minute
    this.maxRequests = options.maxRequests || 30; // 30 requests per minute
    this.store = new Map();
    // Initialize cleanup interval safely after a short delay
    this.cleanupInterval = null;
    setTimeout(() => {
      if (!this.cleanupInterval) {
        this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
      }
    }, 100);
  }

  /**
   * Check if client has exceeded rate limit
   * @param {string} clientId - Client identifier
   * @returns {Object} - Rate limit status
   */
  check(clientId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.store.has(clientId)) {
      this.store.set(clientId, []);
    }

    const requests = this.store.get(clientId);
    const validRequests = requests.filter(time => time > windowStart);
    
    const allowed = validRequests.length < this.maxRequests;
    
    if (allowed) {
      validRequests.push(now);
      this.store.set(clientId, validRequests);
    }

    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - validRequests.length - (allowed ? 0 : 1)),
      resetTime: windowStart + this.windowMs,
      totalHits: validRequests.length
    };
  }

  /**
   * Clean up old entries
   */
  cleanup() {
    const cutoff = Date.now() - this.windowMs * 2;
    for (const [clientId, requests] of this.store.entries()) {
      const validRequests = requests.filter(time => time > cutoff);
      if (validRequests.length === 0) {
        this.store.delete(clientId);
      } else {
        this.store.set(clientId, validRequests);
      }
    }
  }

  /**
   * Get current stats
   * @returns {Object} - Rate limiter statistics
   */
  getStats() {
    return {
      activeClients: this.store.size,
      totalRequests: Array.from(this.store.values()).reduce((sum, requests) => sum + requests.length, 0),
      windowMs: this.windowMs,
      maxRequests: this.maxRequests
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

// Create rate limiter instance
const rateLimiter = new SearchRateLimiter({
  windowMs: 60 * 1000,    // 1 minute
  maxRequests: 30         // 30 searches per minute per IP
});

/**
 * Search validation middleware
 */
const validateSearchQuery = asyncHandler(async (req, res, next) => {
  const startTime = Date.now();

  try {
    // Get client identifier for rate limiting
    const clientId = req.ip || req.connection.remoteAddress || 'unknown';

    // Rate limiting check
    const rateLimitResult = rateLimiter.check(clientId);
    
    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': rateLimiter.maxRequests,
      'X-RateLimit-Remaining': rateLimitResult.remaining,
      'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString()
    });

    if (!rateLimitResult.allowed) {
      logger.warn('Search rate limit exceeded', {
        clientId,
        totalHits: rateLimitResult.totalHits,
        path: req.path,
        userAgent: req.get('User-Agent')
      });
      
      throw new TooManyRequestsError(
        'Search rate limit exceeded. Please wait before making more requests.',
        rateLimitResult.resetTime
      );
    }

    // Validate query parameters using Joi schema
    const { error, value: validatedQuery } = searchQuerySchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    if (error) {
      const validationErrors = error.details.map(detail => detail.message);
      
      logger.warn('Search query validation failed', {
        clientId,
        query: req.query,
        errors: validationErrors,
        path: req.path,
        userAgent: req.get('User-Agent')
      });

      throw new BadRequestError(`Invalid search parameters: ${validationErrors.join(', ')}`);
    }

    // Additional XSS prevention
    const searchQuery = validatedQuery.q || validatedQuery.query;
    const sanitizedQuery = preventXSS(searchQuery);

    if (sanitizedQuery !== searchQuery) {
      logger.warn('Potentially dangerous search query sanitized', {
        clientId,
        originalQuery: searchQuery,
        sanitizedQuery,
        path: req.path
      });
    }

    // Check for SQL injection patterns
    if (hasSQLInjectionPatterns(sanitizedQuery)) {
      logger.warn('Potential SQL injection attempt detected', {
        clientId,
        query: sanitizedQuery,
        path: req.path,
        userAgent: req.get('User-Agent')
      });
      
      throw new BadRequestError('Search query contains potentially harmful patterns');
    }

    // Additional sanitization for other string fields
    if (validatedQuery.sponsor) {
      validatedQuery.sponsor = preventXSS(validatedQuery.sponsor);
    }

    // Normalize the query parameter to 'q' for consistency
    validatedQuery.q = sanitizedQuery;
    delete validatedQuery.query;

    // Normalize contentTypes to array format
    if (validatedQuery.contentTypes) {
      if (typeof validatedQuery.contentTypes === 'string') {
        if (validatedQuery.contentTypes.includes(',')) {
          validatedQuery.contentTypes = validatedQuery.contentTypes.split(',').map(s => s.trim());
        } else {
          validatedQuery.contentTypes = [validatedQuery.contentTypes];
        }
      }
    }

    // Replace request query with validated and sanitized version
    req.query = validatedQuery;

    // Add client ID to request for downstream use
    req.clientId = clientId;

    const validationTime = Date.now() - startTime;

    logger.debug('Search query validation passed', {
      clientId,
      query: sanitizedQuery,
      validationTime: `${validationTime}ms`,
      path: req.path,
      rateLimitRemaining: rateLimitResult.remaining
    });

    next();

  } catch (error) {
    const validationTime = Date.now() - startTime;
    
    if (error instanceof BadRequestError || error instanceof TooManyRequestsError) {
      // These are already properly formatted errors
      throw error;
    }

    // Log unexpected errors
    logger.error('Search validation middleware error', {
      error: error.message,
      stack: error.stack,
      validationTime: `${validationTime}ms`,
      path: req.path,
      query: req.query
    });

    throw new BadRequestError('Search validation failed');
  }
});

/**
 * Get rate limiter stats (for monitoring)
 */
const getSearchRateLimiterStats = () => {
  return rateLimiter.getStats();
};

/**
 * Reset rate limiter for a specific client (for admin use)
 * @param {string} clientId - Client identifier to reset
 */
const resetRateLimitForClient = (clientId) => {
  if (rateLimiter.store.has(clientId)) {
    rateLimiter.store.delete(clientId);
    logger.info('Rate limit reset for client', { clientId });
    return true;
  }
  return false;
};

/**
 * Cleanup function for graceful shutdown
 */
const cleanup = () => {
  rateLimiter.destroy();
};

// Handle process termination
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

module.exports = {
  validateSearchQuery,
  getSearchRateLimiterStats,
  resetRateLimitForClient,
  cleanup,
  // Export classes for testing
  SearchRateLimiter
};