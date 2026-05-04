require('dotenv').config({ path: '.env' });  // Use sync-service's own .env file

module.exports = {
  // Congress API Configuration - DIRECT CONNECTION TO CONGRESS.GOV
  congressApi: {
    baseUrl: 'https://api.congress.gov/v3',  // Direct to Congress.gov (not through backend)
    apiKey: process.env.CONGRESS_API_KEY,
    timeout: 30000,
    retryAttempts: 5,  // Increased for resilience
    retryDelay: 1000,  // Base delay (will use exponential backoff with jitter)
    rateLimit: {
      requestsPerSecond: 2,  // 500ms delay between requests (2 requests per second)
      concurrent: 1          // Reduced from 5 for more conservative approach
    },
    // Quota tracking configuration
    quota: {
      throttleThreshold: 500,   // Start throttling when < 500 remaining
      pauseThreshold: 100,      // Pause syncing when < 100 remaining
      staleTimeout: 5 * 60 * 1000,  // Consider quota stale after 5 minutes
    },
    // Circuit breaker configuration
    circuitBreaker: {
      failureThreshold: 5,      // Open circuit after 5 consecutive failures
      resetTimeout: 60000,      // Try again after 60 seconds
      halfOpenMaxAttempts: 3,   // Max requests in half-open state before deciding
    },
    // Retryable error codes (network-level)
    retryableErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN',      // DNS lookup timeout
      'EPIPE',          // Broken pipe
      'ECONNABORTED',   // Connection aborted
    ],
    // Retryable HTTP status codes
    retryableStatuses: [429, 500, 502, 503, 504],
  },

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'congress_api',
    user: process.env.DB_USER || 'congress_sync_writer',
    password: process.env.DB_PASSWORD,
    max: 20, // maximum pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },

  // Sync Configuration
  sync: {
    // Cron schedule patterns
    schedules: {
      bills: '0 */6 * * *',      // Every 6 hours
      amendments: '0 2 * * *',    // Daily at 2 AM
      actions: '0 */2 * * *',     // Every 2 hours
      members: '0 3 1 * *',       // Monthly on 1st at 3 AM
      committees: '0 4 * * 1',    // Weekly on Monday at 4 AM
      nominations: '0 5 * * *',   // Daily at 5 AM
      hearings: '0 5,17 * * *',   // Daily at 5 AM and 5 PM
      'committee-meetings': '0 5,17 * * *', // Daily at 5 AM and 5 PM (same as hearings)
      reports: '0 1 * * *',       // Daily at 1 AM
      treaties: '0 6 * * 1',      // Weekly on Monday at 6 AM
      'congressional-record': '0 7 * * *', // Daily at 7 AM
      'news-ingestion': '0 8,14,20 * * *', // Three times daily at 8 AM, 2 PM, 8 PM
      'committee-membership': '30 3 1 * *', // Monthly on 1st at 3:30 AM (30 min after members)
    },
    
    // Batch sizes for bulk operations
    // Note: Each bill requires ~9 API calls, so keep bill batch size low to avoid rate limiting
    batchSizes: {
      bills: 10,
      amendments: 250,
      actions: 500,
      members: 250,
      committees: 100,
      nominations: 100,
      hearings: 100,
      'committee-meetings': 100,
      reports: 100,
      treaties: 50,
      'congressional-record': 50
    },

    // How many days back to sync for incremental updates
    incrementalDays: {
      bills: 7,
      amendments: 14,
      actions: 3,
      hearings: 7,
      'committee-meetings': 7,
      reports: 7,
      nominations: 30,
      'congressional-record': 7
    },

    // Congress sessions to sync
    congresses: {
      // current is auto-detected from Congress API
      historical: [118, 117, 116], // Previous congresses to maintain
      full: false // Set to true to sync all available congresses
    },

    // Bill sync optimization
    enableActivityDateCheck: false, // Disabled - was causing bills to be skipped when only text was updated
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: './logs',
    maxFiles: 30,
    maxSize: '20m'
  },

  // Health Check Configuration
  healthCheck: {
    port: 3001,
    path: '/health'
  },

  // News Ingestion Configuration
  newsIngestion: {
    autoCreate: true,           // Automatically create spotlights for high-scoring bills
    minScore: 50,               // Minimum score threshold for auto-creating spotlights
    billsPerTopic: 2,           // Number of bills to feature per topic
    maxTopics: 3,               // Maximum number of topics to feature
  }
};
