const { Pool } = require('pg');
const { logger } = require('../logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Enhanced Database Connection Pool Manager
 * 
 * Provides optimized connection pooling with:
 * - Advanced health monitoring
 * - Connection metrics collection
 * - Automatic pool optimization
 * - Configuration validation
 * - Performance tracking
 */
class DatabasePoolManager {
  constructor(options = {}) {
    // Load database configuration with proper password escaping
    this.config = this.loadDatabaseConfig(options);
    
    // Initialize connection pool with optimized settings
    this.pool = null;
    this.isInitialized = false;
    
    // Monitoring and metrics
    this.metrics = {
      connectionAttempts: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalQueries: 0,
      queryErrors: 0,
      slowQueries: 0,
      averageQueryTime: 0,
      poolUtilization: 0,
      startTime: Date.now()
    };
    
    // Health monitoring
    this.healthChecks = [];
    this.isHealthy = true;
    this.lastHealthCheck = null;
    
    // Performance tracking
    this.queryTimes = [];
    this.slowQueryThreshold = options.slowQueryThreshold || 1000; // 1 second
    this.maxQueryTimeHistory = options.maxQueryTimeHistory || 1000;
    
    // Monitoring intervals
    this.monitoringInterval = null;
    this.cleanupInterval = null;
    
    logger.info('Database Pool Manager initialized', {
      maxConnections: this.config.max,
      minConnections: this.config.min,
      applicationName: this.config.application_name
    });
  }

  /**
   * Load database configuration with proper password escaping
   * @param {Object} options - Configuration options
   * @returns {Object} Database configuration
   */
  loadDatabaseConfig(options) {
    // Load from environment file if needed
    let envPassword = process.env.DB_PASSWORD || '';
    let envUser = process.env.DB_USER || process.env.DBUSER || 'postgres';

    // Escape special characters in password for PostgreSQL connection
    if (envPassword && typeof envPassword === 'string') {
      // PostgreSQL connection string escaping - escape backslashes and single quotes
      envPassword = envPassword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    return {
      // Connection settings
      host: options.host || process.env.DB_HOST || 'localhost',
      port: options.port || parseInt(process.env.DB_PORT) || 5432,
      database: options.database || process.env.DB_DATABASE || process.env.DB_NAME || 'congress-api',
      user: options.user || envUser,
      password: options.password || envPassword,

      // SSL configuration
      ssl: options.ssl || (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false),

      // Enhanced connection pool settings for Congressional API workload
      min: options.min || 5,                           // Minimum connections (always ready)
      max: options.max || 50,                          // Maximum connections (high for API load)
      
      // Timeout settings (aggressive for API responsiveness)
      acquireTimeoutMillis: options.acquireTimeout || 5000,       // Max wait for connection
      createTimeoutMillis: options.createTimeout || 3000,        // Max time to create connection
      destroyTimeoutMillis: options.destroyTimeout || 5000,       // Max time to destroy connection
      idleTimeoutMillis: options.idleTimeout || 10000,           // Idle before cleanup (fast cleanup)
      reapIntervalMillis: options.reapInterval || 1000,          // How often to check for cleanup
      createRetryIntervalMillis: options.retryInterval || 200,   // Retry interval for failed connections
      
      // PostgreSQL-specific performance settings
      statement_timeout: options.statementTimeout || 30000,      // 30 second query timeout
      query_timeout: options.queryTimeout || 30000,             // Node.js query timeout
      connectionTimeoutMillis: options.connectionTimeout || 3000, // Connection establishment timeout
      
      // Application identification for monitoring
      application_name: options.applicationName || 'congress_api_enhanced',
      
      // Temporarily disable complex PostgreSQL connection options to fix hanging issue
      // options: options.connectionOptions || {
      //   // Optimize for read-heavy workload
      //   'default_transaction_isolation': 'read committed',
      //   'statement_timeout': '30000',
      //   'lock_timeout': '10000',
      //   'idle_in_transaction_session_timeout': '60000',
      //   // Connection-level optimizations
      //   'tcp_keepalives_idle': '300',
      //   'tcp_keepalives_interval': '30',
      //   'tcp_keepalives_count': '3'
      // }
    };
  }

  /**
   * Initialize the connection pool with enhanced monitoring
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('Database pool manager already initialized');
      return;
    }

    try {
      logger.info('Step 1: Validating configuration...');
      // Validate configuration
      await this.validateConfiguration();
      
      logger.info('Step 2: Creating connection pool...');
      // Create the connection pool
      this.pool = new Pool(this.config);
      
      logger.info('Step 3: Setting up pool event handlers...');
      // Set up pool event handlers
      this.setupPoolEventHandlers();
      
      logger.info('Step 4: Testing initial connection...');
      // Test the pool with initial connection
      await this.testInitialConnection();
      
      logger.info('Step 5: Starting monitoring...');
      // Start monitoring
      this.startMonitoring();
      
      this.isInitialized = true;
      logger.info('Database pool manager successfully initialized', {
        host: this.config.host,
        database: this.config.database,
        maxConnections: this.config.max,
        minConnections: this.config.min
      });
      
    } catch (error) {
      logger.error('Failed to initialize database pool manager', {
        error: error.message,
        stack: error.stack,
        config: {
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user
        }
      });
      throw error;
    }
  }

  /**
   * Validate database configuration before pool creation
   * @returns {Promise<void>}
   */
  async validateConfiguration() {
    const required = ['host', 'port', 'database', 'user'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
    }

    // Validate numeric values
    if (isNaN(this.config.port) || this.config.port < 1 || this.config.port > 65535) {
      throw new Error('Database port must be a valid number between 1 and 65535');
    }

    if (this.config.max <= this.config.min) {
      throw new Error('Maximum connections must be greater than minimum connections');
    }

    // Validate timeout values
    const timeouts = ['acquireTimeoutMillis', 'createTimeoutMillis', 'connectionTimeoutMillis'];
    for (const timeout of timeouts) {
      if (this.config[timeout] && (isNaN(this.config[timeout]) || this.config[timeout] < 1000)) {
        throw new Error(`${timeout} must be at least 1000ms for production use`);
      }
    }

    logger.debug('Database configuration validated successfully', {
      host: this.config.host,
      database: this.config.database,
      poolSize: `${this.config.min}-${this.config.max}`
    });
  }

  /**
   * Set up comprehensive pool event handlers for monitoring
   */
  setupPoolEventHandlers() {
    // Connection established
    this.pool.on('connect', (client) => {
      this.metrics.connectionAttempts++;
      this.metrics.successfulConnections++;
      
      logger.debug('Database connection established', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingClients: this.pool.waitingCount,
        clientProcessId: client.processID
      });
    });

    // Connection acquisition
    this.pool.on('acquire', (client) => {
      logger.debug('Database connection acquired from pool', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        clientProcessId: client.processID
      });
    });

    // Connection release
    this.pool.on('release', (err, client) => {
      if (err) {
        logger.warn('Database connection released with error', {
          error: err.message,
          clientProcessId: client?.processID
        });
      } else {
        logger.debug('Database connection released to pool', {
          totalConnections: this.pool.totalCount,
          idleConnections: this.pool.idleCount,
          clientProcessId: client.processID
        });
      }
    });

    // Connection removal
    this.pool.on('remove', (client) => {
      logger.debug('Database connection removed from pool', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        clientProcessId: client.processID
      });
    });

    // Pool errors
    this.pool.on('error', (err, client) => {
      this.metrics.failedConnections++;
      this.isHealthy = false;
      
      logger.error('Database pool error occurred', {
        error: err.message,
        errorCode: err.code,
        clientProcessId: client?.processID,
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount
      });
      
      // Add to health check failures
      this.healthChecks.push({
        timestamp: new Date(),
        type: 'pool_error',
        error: err.message,
        successful: false
      });
    });
  }

  /**
   * Test initial connection to ensure pool is working
   * @returns {Promise<void>}
   */
  async testInitialConnection() {
    logger.info('Getting connection from pool...');
    const client = await this.pool.connect();
    
    try {
      logger.info('Connected, running test query...');
      const result = await client.query(`
        SELECT 
          NOW() as connection_time,
          version() as database_version,
          current_database() as database_name,
          current_user as connected_user,
          inet_server_addr() as server_address,
          inet_server_port() as server_port
      `);
      
      logger.info('Test query completed, processing results...');
      const info = result.rows[0];
      
      logger.info('Initial database connection test successful', {
        connectionTime: info.connection_time,
        databaseVersion: info.database_version.split(' ')[0] + ' ' + info.database_version.split(' ')[1],
        databaseName: info.database_name,
        connectedUser: info.connected_user,
        serverAddress: info.server_address,
        serverPort: info.server_port
      });
      
    } catch (error) {
      logger.error('Initial database connection test failed', {
        error: error.message,
        errorCode: error.code
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Start monitoring and cleanup intervals
   */
  startMonitoring() {
    // Pool health monitoring every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
        this.updatePoolMetrics();
        this.cleanupQueryHistory();
      } catch (error) {
        logger.error('Pool monitoring error', { error: error.message });
      }
    }, 30000);

    // Cleanup old health checks every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupHealthChecks();
    }, 300000);

    logger.debug('Database pool monitoring started');
  }

  /**
   * Execute a query with enhanced monitoring
   * @param {string} text - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async query(text, params = []) {
    if (!this.isInitialized) {
      throw new Error('Database pool manager not initialized');
    }

    const startTime = Date.now();
    this.metrics.totalQueries++;

    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - startTime;
      
      // Track query performance
      this.trackQueryPerformance(duration, text, params.length);
      
      logger.debug('Query executed through pool manager', {
        duration: `${duration}ms`,
        rowCount: result.rowCount,
        paramCount: params.length,
        queryPreview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      });

      return result;
      
    } catch (error) {
      this.metrics.queryErrors++;
      const duration = Date.now() - startTime;
      
      logger.error('Query failed through pool manager', {
        duration: `${duration}ms`,
        error: error.message,
        errorCode: error.code,
        queryPreview: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        paramCount: params.length
      });
      
      throw error;
    }
  }

  /**
   * Get a connection from the pool for manual management
   * @returns {Promise<Object>} Database client
   */
  async getConnection() {
    if (!this.isInitialized) {
      throw new Error('Database pool manager not initialized');
    }

    return await this.pool.connect();
  }

  /**
   * Track query performance metrics
   * @param {number} duration - Query duration in milliseconds
   * @param {string} query - SQL query
   * @param {number} paramCount - Number of parameters
   */
  trackQueryPerformance(duration, query, paramCount) {
    // Add to query time history
    this.queryTimes.push({
      duration,
      timestamp: Date.now(),
      query: query.substring(0, 50),
      paramCount
    });

    // Limit history size
    if (this.queryTimes.length > this.maxQueryTimeHistory) {
      this.queryTimes = this.queryTimes.slice(-this.maxQueryTimeHistory);
    }

    // Update average query time
    const totalTime = this.queryTimes.reduce((sum, q) => sum + q.duration, 0);
    this.metrics.averageQueryTime = totalTime / this.queryTimes.length;

    // Track slow queries
    if (duration > this.slowQueryThreshold) {
      this.metrics.slowQueries++;
      
      logger.warn('Slow query detected', {
        duration: `${duration}ms`,
        threshold: `${this.slowQueryThreshold}ms`,
        query: query.substring(0, 150) + (query.length > 150 ? '...' : ''),
        paramCount
      });
    }
  }

  /**
   * Perform comprehensive health check
   * @returns {Promise<Object>} Health check result
   */
  async performHealthCheck() {
    const startTime = Date.now();
    
    try {
      const client = await this.pool.connect();
      
      try {
        // Test basic connectivity
        await client.query('SELECT 1 as health_check');
        
        // Test database-specific functionality
        const result = await client.query(`
          SELECT 
            COUNT(*) as total_connections,
            COUNT(CASE WHEN state = 'active' THEN 1 END) as active_connections,
            COUNT(CASE WHEN state = 'idle' THEN 1 END) as idle_connections
          FROM pg_stat_activity 
          WHERE application_name LIKE '%congress%'
        `);
        
        const connectionStats = result.rows[0];
        const duration = Date.now() - startTime;
        
        // Health check passed
        this.isHealthy = true;
        this.lastHealthCheck = new Date();
        
        const healthResult = {
          timestamp: this.lastHealthCheck,
          type: 'full_health_check',
          successful: true,
          duration: `${duration}ms`,
          connectionStats
        };
        
        this.healthChecks.push(healthResult);
        
        logger.debug('Database health check successful', {
          duration: `${duration}ms`,
          totalConnections: connectionStats.total_connections,
          activeConnections: connectionStats.active_connections,
          idleConnections: connectionStats.idle_connections
        });
        
        return healthResult;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.isHealthy = false;
      const healthResult = {
        timestamp: new Date(),
        type: 'full_health_check',
        successful: false,
        duration: `${duration}ms`,
        error: error.message
      };
      
      this.healthChecks.push(healthResult);
      
      logger.error('Database health check failed', {
        duration: `${duration}ms`,
        error: error.message,
        errorCode: error.code
      });
      
      throw error;
    }
  }

  /**
   * Update pool utilization metrics
   */
  updatePoolMetrics() {
    if (this.pool) {
      this.metrics.poolUtilization = (this.pool.totalCount / this.config.max) * 100;
      
      logger.debug('Pool metrics updated', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingClients: this.pool.waitingCount,
        utilization: `${this.metrics.poolUtilization.toFixed(1)}%`
      });
    }
  }

  /**
   * Clean up old query performance history
   */
  cleanupQueryHistory() {
    const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
    this.queryTimes = this.queryTimes.filter(q => q.timestamp > cutoff);
  }

  /**
   * Clean up old health checks
   */
  cleanupHealthChecks() {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    this.healthChecks = this.healthChecks.filter(hc => hc.timestamp.getTime() > cutoff);
  }

  /**
   * Get comprehensive pool statistics
   * @returns {Object} Pool statistics
   */
  getPoolStats() {
    const uptime = Date.now() - this.metrics.startTime;
    const recentQueries = this.queryTimes.filter(q => 
      Date.now() - q.timestamp < 60000 // Last minute
    );
    
    return {
      // Pool connection stats
      totalConnections: this.pool?.totalCount || 0,
      idleConnections: this.pool?.idleCount || 0,
      waitingClients: this.pool?.waitingCount || 0,
      maxConnections: this.config.max,
      minConnections: this.config.min,
      utilization: this.metrics.poolUtilization,
      
      // Performance metrics
      totalQueries: this.metrics.totalQueries,
      queryErrors: this.metrics.queryErrors,
      slowQueries: this.metrics.slowQueries,
      averageQueryTime: Math.round(this.metrics.averageQueryTime),
      recentQueryRate: recentQueries.length, // Queries per minute
      
      // Health metrics
      isHealthy: this.isHealthy,
      lastHealthCheck: this.lastHealthCheck,
      uptime: `${Math.round(uptime / 1000)}s`,
      successfulConnections: this.metrics.successfulConnections,
      failedConnections: this.metrics.failedConnections,
      
      // Recent performance
      recentSlowQueries: recentQueries.filter(q => q.duration > this.slowQueryThreshold).length,
      recentAverageTime: recentQueries.length > 0 ? 
        Math.round(recentQueries.reduce((sum, q) => sum + q.duration, 0) / recentQueries.length) : 0
    };
  }

  /**
   * Get recent health check history
   * @param {number} limit - Number of recent checks to return
   * @returns {Array} Recent health checks
   */
  getHealthHistory(limit = 10) {
    return this.healthChecks
      .slice(-limit)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Close the pool and cleanup resources
   * @returns {Promise<void>}
   */
  async close() {
    logger.info('Closing database pool manager');
    
    // Clear intervals
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Close pool
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    
    this.isInitialized = false;
    logger.info('Database pool manager closed successfully');
  }

  /**
   * Force pool restart (for maintenance or error recovery)
   * @returns {Promise<void>}
   */
  async restart() {
    logger.warn('Restarting database pool manager');
    
    await this.close();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    await this.initialize();
    
    logger.info('Database pool manager restarted successfully');
  }
}

module.exports = { DatabasePoolManager };