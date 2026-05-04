const { logger } = require('../logger');
const { EnhancedDatabaseService } = require('./enhanced-database-service');
const { DatabaseCircuitBreaker } = require('./database-circuit-breaker');
const { DatabasePoolManager } = require('./database-pool-manager');
const { CongressAPIFormatter } = require('./congress-api-formatter');
const { CongressAPIClient } = require('./congress-api');
const { MemberService } = require('./member-service');
const { CommitteeReportService } = require('./committee-report-service');

/**
 * Database Service Manager
 * 
 * Integrates all database infrastructure components for the Congressional Database Endpoints Migration:
 * - EnhancedDatabaseService for optimized database operations
 * - DatabaseCircuitBreaker for failure handling and Congress API fallback
 * - DatabasePoolManager for enhanced connection management
 * - CongressAPIFormatter for response transformation
 * 
 * Provides a unified interface for database endpoints with automatic fallback to Congress API
 */
class DatabaseServiceManager {
  constructor(options = {}) {
    this.options = {
      // Circuit breaker configuration
      circuitBreaker: {
        failureThreshold: options.failureThreshold || 5,
        resetTimeout: options.resetTimeout || 60000, // 1 minute
        monitoringWindow: options.monitoringWindow || 60000,
        ...options.circuitBreaker
      },
      
      // Database pool configuration
      database: {
        ...options.database
      },
      
      // Feature flags
      features: {
        useCircuitBreaker: options.useCircuitBreaker !== false,
        useCongressAPIFallback: options.useCongressAPIFallback !== false,
        validateResponses: options.validateResponses !== false,
        ...options.features
      },
      
      // Performance settings
      performance: {
        slowQueryThreshold: options.slowQueryThreshold || 1000,
        dataFreshnessThreshold: options.dataFreshnessThreshold || 24, // hours
        ...options.performance
      }
    };

    // Core components (initialized in init())
    this.poolManager = null;
    this.databaseService = null;
    this.circuitBreaker = null;
    this.congressAPIClient = null;
    
    // State management
    this.isInitialized = false;
    this.initializationError = null;
    
    // Metrics and monitoring
    this.metrics = {
      totalRequests: 0,
      databaseRequests: 0,
      fallbackRequests: 0,
      errors: 0,
      responseTimeSum: 0,
      startTime: Date.now()
    };
    
    logger.info('Database Service Manager created', {
      useCircuitBreaker: this.options.features.useCircuitBreaker,
      useCongressAPIFallback: this.options.features.useCongressAPIFallback,
      failureThreshold: this.options.circuitBreaker.failureThreshold
    });
  }

  /**
   * Initialize all database service components
   * @param {Object} cache - Cache instance for Congress API fallback
   * @returns {Promise<void>}
   */
  async initialize(cache = null) {
    if (this.isInitialized) {
      logger.warn('Database Service Manager already initialized');
      return;
    }

    try {
      logger.info('Initializing Database Service Manager components...');

      // Initialize database pool manager
      this.poolManager = new DatabasePoolManager(this.options.database);
      await this.poolManager.initialize();

      // Initialize enhanced database service with the pool manager
      this.databaseService = new EnhancedDatabaseService({
        ...this.options.database,
        dataFreshnessThreshold: this.options.performance.dataFreshnessThreshold
      });

      // Initialize member service for comprehensive member queries
      this.memberService = new MemberService();

      // Initialize committee report service for comprehensive committee report queries
      this.committeeReportService = new CommitteeReportService();

      // Initialize circuit breaker if enabled
      if (this.options.features.useCircuitBreaker) {
        this.circuitBreaker = new DatabaseCircuitBreaker(this.options.circuitBreaker);
      }

      // Initialize Congress API client for fallback if enabled
      if (this.options.features.useCongressAPIFallback && cache) {
        this.congressAPIClient = new CongressAPIClient(cache);
      }

      // Test all components
      await this.performInitializationTests();

      this.isInitialized = true;
      logger.info('Database Service Manager successfully initialized', {
        hasPoolManager: !!this.poolManager,
        hasDatabaseService: !!this.databaseService,
        hasMemberService: !!this.memberService,
        hasCommitteeReportService: !!this.committeeReportService,
        hasCircuitBreaker: !!this.circuitBreaker,
        hasCongressAPIClient: !!this.congressAPIClient
      });

    } catch (error) {
      this.initializationError = error;
      logger.error('Failed to initialize Database Service Manager', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Perform initialization tests to ensure all components are working
   * @returns {Promise<void>}
   */
  async performInitializationTests() {
    // Test database connectivity with timeout
    const testWithTimeout = async (testFn, testName, timeout = 10000) => {
      const testPromise = testFn();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${testName} timed out after ${timeout}ms`)), timeout);
      });
      
      try {
        await Promise.race([testPromise, timeoutPromise]);
        logger.debug(`${testName} passed`);
      } catch (error) {
        logger.error(`${testName} failed`, { error: error.message });
        throw error;
      }
    };
    
    await testWithTimeout(
      () => this.databaseService.testConnection(),
      'Database connectivity test',
      5000
    );
    
    await testWithTimeout(
      () => this.poolManager.performHealthCheck(),
      'Pool manager health check',
      5000
    );
    
    await testWithTimeout(
      () => this.databaseService.optimizedQuery('SELECT 1 as test'),
      'Simple database query test',
      5000
    );
    
    logger.debug('All initialization tests passed');
  }

  /**
   * Get bills list for congress using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {Object} options - Query options (limit, offset)
   * @returns {Promise<Object>} Formatted bills response
   */
  async getBills(congress, options = {}) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.databaseService.getBills(congress, options);
        if (!result || !result.bills) {
          const error = new Error('Bills not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        
        // Format bills using Congress API list formatter (without "bill" wrapper)
        console.log('DEBUG getBills: Using formatBillForList for', result.bills.length, 'bills');
        const formattedBills = result.bills.map(bill => CongressAPIFormatter.formatBillForList(bill));
        console.log('DEBUG getBills: Formatted bills sample:', JSON.stringify(formattedBills[0], null, 2));
        
        return CongressAPIFormatter.formatPaginatedResponse(
          formattedBills,
          result.pagination,
          { 
            congress,
            endpoint: `/bill/${congress}`,
            entityType: 'bill',
            _database: result.metadata
          }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const queryParams = new URLSearchParams();
        if (options.limit) queryParams.append('limit', options.limit);
        if (options.offset) queryParams.append('offset', options.offset);
        
        const endpoint = `/bill?congress=${congress}${queryParams.toString() ? '&' + queryParams.toString() : ''}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBills', congress, options }
    );
  }

  /**
   * Get bills list for all congresses using circuit breaker and fallback
   * @param {Object} options - Query options (limit, offset)
   * @returns {Promise<Object>} Formatted bills response
   */
  async getBillsAllCongresses(options = {}) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.databaseService.getBillsAllCongresses(options);
        if (!result || !result.bills) {
          const error = new Error('Bills not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        
        // Format bills using Congress API list formatter (without "bill" wrapper)
        const formattedBills = result.bills.map(bill => CongressAPIFormatter.formatBillForList(bill));
        
        return CongressAPIFormatter.formatPaginatedResponse(
          formattedBills,
          result.pagination,
          { 
            endpoint: `/bill`,
            entityType: 'bill',
            _database: result.metadata
          }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const queryParams = new URLSearchParams();
        if (options.limit) queryParams.append('limit', options.limit);
        if (options.offset) queryParams.append('offset', options.offset);
        
        const endpoint = `/bill${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillsAllCongresses', options }
    );
  }

  /**
   * Get bill with details using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted bill response
   */
  async getBill(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const bill = await this.databaseService.getBillWithDetails(congress, type, number);
        if (!bill) {
          const error = new Error('Bill not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBill(bill);
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBill', congress, type, number }
    );
  }

  /**
   * Get bill actions using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type  
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted actions response
   */
  async getBillActions(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const bill = await this.databaseService.getBillWithDetails(congress, type, number);
        if (!bill) {
          const error = new Error('Bill not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillActions(
          bill.actions || [], 
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/actions`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillActions', congress, type, number }
    );
  }

  /**
   * Get bill cosponsors using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted cosponsors response
   */
  async getBillCosponsors(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const bill = await this.databaseService.getBillWithDetails(congress, type, number);
        if (!bill) {
          const error = new Error('Bill not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillCosponsors(
          bill.cosponsors || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/cosponsors`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillCosponsors', congress, type, number }
    );
  }

  /**
   * Get bill summaries using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted summaries response
   */
  async getBillSummaries(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const bill = await this.databaseService.getBillWithDetails(congress, type, number);
        if (!bill) {
          const error = new Error('Bill not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillSummaries(
          bill.summaries || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/summaries`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillSummaries', congress, type, number }
    );
  }

  /**
   * Get bill titles using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted titles response
   */
  async getBillTitles(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const bill = await this.databaseService.getBillWithDetails(congress, type, number);
        if (!bill) {
          const error = new Error('Bill not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillTitles(
          bill.titles || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/titles`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillTitles', congress, type, number }
    );
  }

  /**
   * Get bill committees using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted committees response
   */
  async getBillCommittees(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.databaseService.getBillCommittees(congress, type, number);
        if (!result) {
          const error = new Error('Bill committees not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillCommittees(
          result.committees || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/committees`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillCommittees', congress, type, number }
    );
  }

  /**
   * Get bill subjects using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted subjects response
   */
  async getBillSubjects(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.databaseService.getBillSubjects(congress, type, number);
        if (!result) {
          const error = new Error('Bill subjects not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillSubjects(
          result.subjects || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/subjects`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillSubjects', congress, type, number }
    );
  }

  /**
   * Get bill text versions using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted text versions response
   */
  async getBillTextVersions(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.databaseService.getBillTextVersions(congress, type, number);
        if (!result) {
          const error = new Error('Bill text versions not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillTextVersions(
          result.textVersions || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/text`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillTextVersions', congress, type, number }
    );
  }

  /**
   * Get bill amendments using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted amendments response
   */
  async getBillAmendments(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.databaseService.getBillAmendments(congress, type, number);
        if (!result) {
          const error = new Error('Bill amendments not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillAmendments(
          result.amendments || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/amendments`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillAmendments', congress, type, number }
    );
  }

  /**
   * Get bill related bills using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} type - Bill type
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Formatted related bills response
   */
  async getBillRelatedBills(congress, type, number) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.databaseService.getBillRelatedBills(congress, type, number);
        if (!result) {
          const error = new Error('Bill related bills not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatBillRelatedBills(
          result.relatedBills || [],
          { congress, type, number }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/bill/${congress}/${type.toLowerCase()}/${number}/relatedbills`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getBillRelatedBills', congress, type, number }
    );
  }


  /**
   * Get members list with optional filters using circuit breaker and fallback
   * @param {Object} filters - Filter options (state, district, currentMember)
   * @param {Object} pagination - Pagination options (limit, offset)
   * @returns {Promise<Object>} Formatted members response
   */
  async getMembers(filters = {}, pagination = {}) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const members = await this.memberService.searchMembers('', filters, pagination);
        return CongressAPIFormatter.formatPaginatedResponse(
          members.results.map(m => CongressAPIFormatter.formatMember(m).member),
          pagination,
          { entityType: 'member', ...filters }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const queryParams = new URLSearchParams();
        if (filters.state) queryParams.set('state', filters.state);
        if (filters.district !== undefined) queryParams.set('district', filters.district);
        if (filters.currentMember !== undefined) queryParams.set('currentMember', filters.currentMember);
        if (pagination.limit) queryParams.set('limit', pagination.limit);
        if (pagination.offset) queryParams.set('offset', pagination.offset);
        
        const endpoint = `/member${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getMembers', filters, pagination }
    );
  }

  /**
   * Get specific member details by bioguide ID using circuit breaker and fallback
   * @param {string} bioguideId - Member's bioguide ID
   * @returns {Promise<Object>} Formatted member response
   */
  async getMemberById(bioguideId) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const member = await this.memberService.getMemberWithFullData(bioguideId);
        if (!member) {
          const error = new Error('Member not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return CongressAPIFormatter.formatMember(member);
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/member/${bioguideId}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getMemberById', bioguideId }
    );
  }

  /**
   * Get committees by chamber using circuit breaker and fallback
   * @param {string} chamber - Chamber (house, senate, joint)
   * @returns {Promise<Object>} Formatted committees response
   */
  async getCommitteesByChamber(chamber) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const committees = await this.databaseService.getCommitteesByChamber(chamber);
        const formattedCommittees = committees.map(c => CongressAPIFormatter.formatCommittee(c).committee);
        
        return CongressAPIFormatter.formatPaginatedResponse(
          formattedCommittees,
          {},
          { entityType: 'committee', chamber }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/committee/${chamber.toLowerCase()}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getCommitteesByChamber', chamber }
    );
  }

  /**
   * Get all committees with optional chamber filter using circuit breaker and fallback
   * @param {string|null} chamber - Optional chamber filter (house, senate, joint)
   * @returns {Promise<Object>} Formatted committees response
   */
  async getCommittees(chamber = null) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const committees = await this.databaseService.getCommittees(chamber);
        return CongressAPIFormatter.formatPaginatedResponse(
          committees.map(c => CongressAPIFormatter.formatCommittee(c).committee),
          {},
          { entityType: 'committee', chamber: chamber || 'all' }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = chamber ? `/committee/${chamber.toLowerCase()}` : '/committee';
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getCommittees', chamber }
    );
  }

  /**
   * Get committee report details by congress, report type, and number using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {string} reportType - Report type (HRPT, SRPT, etc.)  
   * @param {number} reportNumber - Report number
   * @returns {Promise<Object>} Formatted committee report response
   */
  async getCommitteeReport(congress, reportType, reportNumber) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const reportData = await this.committeeReportService.getCommitteeReportWithFullData(
          congress, reportType, reportNumber
        );
        if (!reportData) {
          const error = new Error('Committee report not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        
        // Format using the service's formatter
        return this.committeeReportService.formatSingleCommitteeReportResponse(
          reportData,
          { congress, reportType, number: reportNumber }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const endpoint = `/committee-report/${congress}/${reportType.toLowerCase()}/${reportNumber}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getCommitteeReport', congress, reportType, reportNumber }
    );
  }

  /**
   * Get committee reports for a specific congress using circuit breaker and fallback
   * @param {number} congress - Congress number
   * @param {Object} options - Query options (limit, offset, format)
   * @returns {Promise<Object>} Formatted committee reports response
   */
  async getCommitteeReports(congress, options = {}) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.committeeReportService.getCommitteeReports(congress, options);
        if (!result || !result.committeeReports) {
          const error = new Error('Committee reports not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        
        // Format using the service's formatter
        return this.committeeReportService.formatCommitteeReportsResponse(
          result.committeeReports,
          result.pagination,
          { 
            congress,
            baseUrl: `/api/db/committee-report/${congress}`,
            additionalMetadata: result.filters 
          }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const queryParams = new URLSearchParams();
        if (options.limit) queryParams.append('limit', options.limit);
        if (options.offset) queryParams.append('offset', options.offset);
        if (options.format) queryParams.append('format', options.format);
        
        const endpoint = `/committee-report?congress=${congress}${queryParams.toString() ? '&' + queryParams.toString() : ''}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getCommitteeReports', congress, options }
    );
  }

  /**
   * Get committee reports across all congresses using circuit breaker and fallback
   * @param {Object} options - Query options (limit, offset, format, congress, chamber, reportType)
   * @returns {Promise<Object>} Formatted committee reports response
   */
  async getCommitteeReportsAllCongresses(options = {}) {
    return this.executeWithFallback(
      // Database operation
      async () => {
        const result = await this.committeeReportService.getAllCommitteeReports(options);
        if (!result || !result.committeeReports) {
          const error = new Error('Committee reports not found in database');
          error.code = 'NOT_FOUND';
          throw error;
        }
        
        // Format using the service's formatter
        return this.committeeReportService.formatCommitteeReportsResponse(
          result.committeeReports,
          result.pagination,
          { 
            baseUrl: `/api/db/committee-report`,
            additionalMetadata: result.filters 
          }
        );
      },
      
      // Congress API fallback
      async () => {
        if (!this.congressAPIClient) {
          throw new Error('Congress API client not available');
        }
        const queryParams = new URLSearchParams();
        if (options.limit) queryParams.append('limit', options.limit);
        if (options.offset) queryParams.append('offset', options.offset);
        if (options.format) queryParams.append('format', options.format);
        if (options.congress) queryParams.append('congress', options.congress);
        if (options.chamber) queryParams.append('chamber', options.chamber);
        if (options.reportType) queryParams.append('reportType', options.reportType);
        
        const endpoint = `/committee-report${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        const response = await this.congressAPIClient.get(endpoint);
        return response.data;
      },
      
      // Context
      { operation: 'getCommitteeReportsAllCongresses', options }
    );
  }

  /**
   * Execute operation with circuit breaker and fallback logic
   * @param {Function} databaseOperation - Primary database operation
   * @param {Function} fallbackOperation - Fallback Congress API operation
   * @param {Object} context - Operation context for logging
   * @returns {Promise<Object>} Operation result
   */
  async executeWithFallback(databaseOperation, fallbackOperation, context = {}) {
    if (!this.isInitialized) {
      throw new Error('Database Service Manager not initialized');
    }

    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      let result;
      
      if (this.options.features.useCircuitBreaker && this.circuitBreaker) {
        // Use circuit breaker
        result = await this.circuitBreaker.execute(
          databaseOperation,
          this.options.features.useCongressAPIFallback ? fallbackOperation : null,
          context
        );
      } else {
        // Direct execution without circuit breaker
        try {
          const data = await databaseOperation();
          result = { 
            data, 
            source: 'database', 
            circuitState: 'N/A' 
          };
          this.metrics.databaseRequests++;
        } catch (error) {
          if (this.options.features.useCongressAPIFallback && fallbackOperation) {
            logger.info('Database operation failed - using Congress API fallback', {
              context,
              error: error.message
            });
            const data = await fallbackOperation();
            result = { 
              data, 
              source: 'congress-api', 
              fallbackReason: error.message 
            };
            this.metrics.fallbackRequests++;
          } else {
            throw error;
          }
        }
      }

      const duration = Date.now() - startTime;
      this.updateMetrics(duration);

      // Validate response format if enabled
      if (this.options.features.validateResponses) {
        const entityType = this.getEntityTypeFromContext(context);
        if (!CongressAPIFormatter.validateResponse(result.data, entityType)) {
          logger.warn('Response validation failed', { context, entityType });
        }
      }

      // Add database metadata
      const response = CongressAPIFormatter.addDatabaseMetadata(result.data, {
        queryTime: duration,
        source: result.source,
        circuitBreakerState: result.circuitState,
        fallbackReason: result.fallbackReason
      });

      logger.debug('Database service operation completed', {
        context,
        source: result.source,
        duration: `${duration}ms`,
        circuitState: result.circuitState
      });

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.errors++;
      
      logger.error('Database service operation failed', {
        context,
        error: error.message,
        duration: `${duration}ms`
      });
      
      throw error;
    }
  }

  /**
   * Update performance metrics
   * @param {number} duration - Operation duration in milliseconds
   */
  updateMetrics(duration) {
    this.metrics.responseTimeSum += duration;
  }

  /**
   * Get entity type from operation context
   * @param {Object} context - Operation context
   * @returns {string} Entity type
   */
  getEntityTypeFromContext(context) {
    const { operation } = context;
    
    if (operation?.includes('Bill')) {
      if (operation === 'getBillActions') return 'actions';
      if (operation === 'getBillCosponsors') return 'cosponsors';
      if (operation === 'getBillCommittees') return 'committees';
      if (operation === 'getBillSubjects') return 'subjects';
      if (operation === 'getBillTextVersions') return 'textVersions';
      if (operation === 'getBillAmendments') return 'amendments';
      if (operation === 'getBillRelatedBills') return 'relatedBills';
      return 'bill';
    }
    
    if (operation?.includes('Member')) {
      if (operation === 'getMembers') return 'members';
      return 'member';
    }
    if (operation?.includes('Committee')) {
      if (operation === 'getCommittees' || operation === 'getCommitteesByChamber') return 'committees';
      if (operation === 'getCommitteeReports' || operation === 'getCommitteeReportsAllCongresses') return 'committee-reports';
      if (operation === 'getCommitteeReport') return 'committee-report';
      return 'committee';
    }
    
    return 'unknown';
  }

  /**
   * Get comprehensive service metrics
   * @returns {Object} Service metrics
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    const avgResponseTime = this.metrics.totalRequests > 0 ? 
      this.metrics.responseTimeSum / this.metrics.totalRequests : 0;

    return {
      // Request metrics
      totalRequests: this.metrics.totalRequests,
      databaseRequests: this.metrics.databaseRequests,
      fallbackRequests: this.metrics.fallbackRequests,
      errors: this.metrics.errors,
      
      // Performance metrics
      averageResponseTime: Math.round(avgResponseTime),
      uptime: `${Math.round(uptime / 1000)}s`,
      errorRate: this.metrics.totalRequests > 0 ? 
        (this.metrics.errors / this.metrics.totalRequests * 100).toFixed(2) + '%' : '0%',
      fallbackRate: this.metrics.totalRequests > 0 ? 
        (this.metrics.fallbackRequests / this.metrics.totalRequests * 100).toFixed(2) + '%' : '0%',
      
      // Component metrics
      poolManager: this.poolManager?.getPoolStats() || null,
      circuitBreaker: this.circuitBreaker?.getMetrics() || null,
      databaseService: this.databaseService ? 
        { status: 'initialized' } : { status: 'not_initialized' }
    };
  }

  /**
   * Perform health check on all components
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      components: {}
    };

    try {
      // Check database service
      if (this.databaseService) {
        health.components.databaseService = await this.databaseService.healthCheck();
      }

      // Check pool manager
      if (this.poolManager) {
        health.components.poolManager = await this.poolManager.performHealthCheck();
      }

      // Check circuit breaker
      if (this.circuitBreaker) {
        health.components.circuitBreaker = this.circuitBreaker.healthCheck();
      }

      // Overall health assessment
      const componentStatuses = Object.values(health.components);
      const hasUnhealthyComponent = componentStatuses.some(c => 
        c.status === 'unhealthy' || c.healthy === false
      );
      
      if (hasUnhealthyComponent) {
        health.status = 'degraded';
      }

    } catch (error) {
      health.status = 'unhealthy';
      health.error = error.message;
    }

    return health;
  }

  /**
   * Gracefully shut down all service components
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('Shutting down Database Service Manager...');

    try {
      // Close circuit breaker
      if (this.circuitBreaker) {
        this.circuitBreaker.destroy();
        this.circuitBreaker = null;
      }

      // Close member service
      if (this.memberService) {
        await this.memberService.close();
        this.memberService = null;
      }

      // Close committee report service
      if (this.committeeReportService) {
        await this.committeeReportService.close();
        this.committeeReportService = null;
      }

      // Close database service
      if (this.databaseService) {
        await this.databaseService.close();
        this.databaseService = null;
      }

      // Close pool manager
      if (this.poolManager) {
        await this.poolManager.close();
        this.poolManager = null;
      }

      this.isInitialized = false;
      
      logger.info('Database Service Manager shut down successfully');

    } catch (error) {
      logger.error('Error during Database Service Manager shutdown', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = { DatabaseServiceManager };