const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { logger, httpLogger } = require('../logger');
// Legacy validation for test routes only (DEPRECATED - use schema validation instead)
const { validateInput, validateBioguideId } = require('../validation');
const { validateDynamicSchema, createValidationMiddleware, validateBioguideId: validateBioguideIdSchema } = require('./schema-validation');
const { createAuthenticationError, createAuthorizationError, asyncHandler } = require('../utils/error-handler');
const { getQuotaTracker } = require('./quota-tracker');
const config = require('../config');

// API Authentication middleware (optional)
const authenticateAPI = asyncHandler(async (req, res, next) => {
  // Skip authentication if no token is configured
  if (!config.auth.token) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    throw createAuthenticationError(
      'Access token required. Please provide Authorization: Bearer <token> header.'
    );
  }
  
  const expected = config.auth.token;
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (tokenBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
    throw createAuthorizationError('Invalid access token.');
  }
  
  next();
});

// Legacy rate limiters - kept only for non-Congress API endpoints
const legacyDefaultLimiter = rateLimit({
  windowMs: config.rateLimit.default.windowMs,
  max: config.rateLimit.default.max,
  message: config.getRateLimitMessage(),
  standardHeaders: config.rateLimit.default.standardHeaders,
  legacyHeaders: config.rateLimit.default.legacyHeaders,
});

// Throttled limiter for when approaching Congress API quota
const throttledLimiter = rateLimit({
  windowMs: config.rateLimit.throttled.windowMs,
  max: config.rateLimit.throttled.max,
  message: config.rateLimit.throttled.message,
  standardHeaders: config.rateLimit.throttled.standardHeaders,
  legacyHeaders: config.rateLimit.throttled.legacyHeaders,
});

// Initialize quota tracker
const quotaTracker = getQuotaTracker(config.quota);

// Dynamic rate limiting based on data source
const dynamicLimiter = asyncHandler(async (req, res, next) => {
  // Check if we have a cache hit first by looking at the cache
  const endpoint = req.path.replace('/api', '');
  const sortedParams = Object.keys(req.query).sort().reduce((sorted, key) => {
    sorted[key] = req.query[key];
    return sorted;
  }, {});
  const cacheKey = `${endpoint}-${JSON.stringify(sortedParams)}`;
  
  // Access cache from app instance
  const cache = req.app.cache;
  const cachedData = cache ? cache.get(cacheKey) : null;
  
  if (cachedData) {
    // Cache hit - no rate limiting needed
    return next();
  } else {
    // Use legacy default limits for old limiter
    return legacyDefaultLimiter(req, res, next);
  }
});

// Dynamic quota-based limiter for Congress API requests
const dynamicQuotaLimiter = asyncHandler(async (req, res, next) => {
  logger.debug('QUOTA LIMITER: Processing request to', { path: req.path });
  
  // Skip quota limiting if disabled
  if (!config.quota.enabled) {
    logger.debug('QUOTA LIMITER: Quota tracking disabled, skipping');
    return next();
  }
  
  // Check if we have a cache hit first
  const endpoint = req.path.replace('/api', '');
  const sortedParams = Object.keys(req.query).sort().reduce((sorted, key) => {
    sorted[key] = req.query[key];
    return sorted;
  }, {});
  const cacheKey = `${endpoint}-${JSON.stringify(sortedParams)}`;
  
  // Access cache from app instance
  const cache = req.app.cache;
  const cachedData = cache ? cache.get(cacheKey) : null;
  
  if (cachedData) {
    // Cache hit - no rate limiting needed (no quota concerns)
    return next();
  }
  
  // Will hit Congress API - check quota status
  const quotaStatus = quotaTracker.getStatus();
  
  // Log quota status for monitoring
  if (quotaStatus.remaining <= 100 || quotaStatus.stale) {
    logger.info('Quota status check', quotaStatus);
  }
  
  // Apply dynamic rate limiting based on remaining quota
  if (quotaTracker.shouldThrottle()) {
    logger.debug('Applying throttled rate limiting', { 
      remaining: quotaStatus.remaining, 
      threshold: config.quota.throttleThreshold 
    });
    return throttledLimiter(req, res, next);
  } else {
    logger.debug('Full speed ahead', { 
      remaining: quotaStatus.remaining, 
      threshold: config.quota.throttleThreshold 
    });
    // No rate limiting when quota is sufficient - full speed ahead
    return next();
  }
});

// Apply common middleware to Express app
function applyMiddleware(app, options = {}) {
  // Set Origin-Agent-Cluster header for all responses to enable origin-keying
  app.use((req, res, next) => {
    res.setHeader('Origin-Agent-Cluster', '?1');
    next();
  });

  // Logging middleware
  app.use(httpLogger);

  // Security middleware - configure CSP to allow congress.gov iframes
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'", "https://www.congress.gov"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://www.congress.gov", "https:"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://www.congress.gov"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://api.congress.gov", "https://www.congress.gov", "https:"],
        frameSrc: ["'self'", "https://www.congress.gov", "https:"],
        childSrc: ["'self'", "https://www.congress.gov", "https:"],
        objectSrc: ["'none'"],
        fontSrc: ["'self'", "https:", "data:"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://www.congress.gov"],
        frameAncestors: ["'self'"],
        // Allow embedded content from congress.gov
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'", "https:", "data:"],
        workerSrc: ["'self'", "blob:"],
      },
    },
    // Disable problematic headers that might interfere with iframes
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  }));
  app.use(cors({
    origin: process.env.CORS_ALLOWED_ORIGINS
      ? process.env.CORS_ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3000', 'http://localhost:5000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));

  // Member endpoint validation is now handled by schema validation middleware

  // Test route for debugging validation (only in test mode)
  if (options.includeTestRoutes) {
    app.get('/api/test-validation/:congress/:type/:number', validateInput, (req, res) => {
      res.json({ message: 'Validation passed', params: req.params });
    });
  }
}

// Middleware composition helper - simplified Express-compatible approach
function composeMiddleware(middlewares) {
  return (req, res, next) => {
    let index = 0;
    
    function dispatch(err) {
      // If there's an error, pass it to the final next
      if (err) {
        return next(err);
      }
      
      // If we've processed all middlewares, call the final next
      if (index >= middlewares.length) {
        return next();
      }
      
      // Get the current middleware
      const middleware = middlewares[index++];
      
      // Call the middleware with our dispatch as next
      try {
        middleware(req, res, dispatch);
      } catch (err) {
        dispatch(err);
      }
    }
    
    dispatch();
  };
}

// Predefined middleware chains
const middlewareChains = {
  // Standard API chain with dynamic quota-based rate limiting
  standardAPI: [dynamicQuotaLimiter, authenticateAPI, validateDynamicSchema],
  
  // Member API chain with dynamic quota-based rate limiting
  memberAPI: [dynamicQuotaLimiter, authenticateAPI, validateBioguideIdSchema],
  
  // Cache management chain (minimal protection for admin endpoints)
  cacheAPI: [legacyDefaultLimiter, authenticateAPI],
  
  // Chat API chain (minimal protection for LLM endpoints)
  chatAPI: [legacyDefaultLimiter],
  
  // Public health/metrics chain (minimal protection)
  publicAPI: [legacyDefaultLimiter],
  
  // Legacy middleware chains (for backwards compatibility)
  legacyStandardAPI: [dynamicLimiter, authenticateAPI, validateDynamicSchema],
  legacyMemberAPI: [dynamicLimiter, authenticateAPI, validateBioguideIdSchema]
};

// Helper to create middleware chain
function createMiddlewareChain(chainName) {
  const chain = middlewareChains[chainName];
  if (!chain) {
    throw new Error(`Unknown middleware chain: ${chainName}`);
  }
  return composeMiddleware([...chain]); // Copy array to avoid mutations
}

module.exports = {
  applyMiddleware,
  authenticateAPI,
  limiter: legacyDefaultLimiter, // Keep legacy name for backward compatibility
  legacyDefaultLimiter,
  throttledLimiter,
  dynamicLimiter, // Legacy cache-based limiter (kept for legacy chains)
  dynamicQuotaLimiter, // Primary quota-based limiter
  quotaTracker, // Export quota tracker for use in routes
  validateInput,
  validateBioguideId,
  validateDynamicSchema,
  createValidationMiddleware,
  validateBioguideIdSchema,
  composeMiddleware,
  createMiddlewareChain,
  middlewareChains,
}