require('dotenv').config({ override: true }); // Load main .env with backend credentials

// Cache timeout configuration
const DEFAULT_CACHE_TIMEOUT = 1 * 60 * 60 * 1000; // 1 hour in milliseconds
const CACHE_OVERRIDES = {
  congress: 365 * 24 * 60 * 60 * 1000, // 1 year
  member: 30 * 24 * 60 * 60 * 1000,     // 30 days
  'committee-report': 30 * 24 * 60 * 60 * 1000, // 30 days - committee reports are stable
};

module.exports = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development',
  },

  // API configuration
  api: {
    congressBase: 'https://api.congress.gov/v3',
    timeout: 10000, // 10 second timeout
    userAgent: 'Congress-API-Proxy/1.0',
  },

  // Authentication configuration
  auth: {
    token: process.env.API_AUTH_TOKEN,
  },

  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_DATABASE || process.env.DB_NAME || 'congress-api',
    user: process.env.DB_USER || 'congress_api_backend',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 5000,
  },

  // Cache configuration
  cache: {
    stdTTL: process.env.CACHE_TTL || 3600,
    maxKeys: 50000,  // Increased further for bulk sync operations (was 10000)
    checkperiod: 120,
    defaultTimeout: DEFAULT_CACHE_TIMEOUT,
    overrides: CACHE_OVERRIDES,
  },

  // Rate limiting configuration
  rateLimit: {
    // Generous limits for cached responses
    cache: {
      windowMs: parseInt(process.env.CACHE_RATE_LIMIT_WINDOW_MS) || 1 * 60 * 1000, // 1 minute
      max: parseInt(process.env.CACHE_RATE_LIMIT_MAX_REQUESTS) || 1000, // 1000 requests per minute
      standardHeaders: true,
      legacyHeaders: false,
    },
    // Legacy fixed API limits (now replaced by dynamic quota-based limiting)
    api: {
      windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS) || 1 * 60 * 1000, // 1 minute
      max: parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS) || 70, // 70 requests per minute (fallback only)
      standardHeaders: true,
      legacyHeaders: false,
    },
    // Default/fallback limits
    default: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200, // 200 requests per 15min window
      standardHeaders: true,
      legacyHeaders: false,
    },
    // Throttled state (when approaching Congress API quota)
    throttled: {
      windowMs: 1000, // 1 second
      max: 1, // 1 request per second
      message: {
        error: 'Approaching Congress API quota limit, throttling requests to preserve quota.',
        retryAfter: 1,
      },
      standardHeaders: true,
      legacyHeaders: false,
    }
  },

  // Dynamic quota tracking configuration
  quota: {
    throttleThreshold: parseInt(process.env.QUOTA_THROTTLE_THRESHOLD) || 1000, // Start throttling when < 1000 remaining (was 2000)
    staleTimeout: parseInt(process.env.QUOTA_STALE_TIMEOUT_MS) || 5 * 60 * 1000, // 5 minutes
    enabled: true, // Re-enabled
  },

  // Required environment variables
  requiredEnvVars: ['CONGRESS_API_KEY'],
  
  // Optional LLM environment variables
  optionalEnvVars: [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY', 
    'GEMINI_API_KEY',
    'OLLAMA_BASE_URL'
  ],

  // Helper functions
  getCacheTimeout(dataType) {
    return this.cache.overrides[dataType] || this.cache.defaultTimeout;
  },

  getDataTypeFromEndpoint(endpoint) {
    if (endpoint.includes('/congress')) {
      return 'congress';
    } else if (endpoint.includes('/member')) {
      return 'member';
    } else if (endpoint.includes('/committee-report')) {
      return 'committee-report';
    }
    return null; // Use default timeout
  },

  // Environment validation
  validateEnvironment() {
    const missing = this.requiredEnvVars.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error(`Missing required environment variables: ${missing.join(', ')}`);
      process.exit(1);
    }
  },

  // Rate limit message factory
  getRateLimitMessage() {
    return {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(this.rateLimit.default.windowMs / 1000),
    };
  },
};