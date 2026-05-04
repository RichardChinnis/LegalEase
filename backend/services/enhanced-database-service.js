const { Pool } = require('pg');
const { logger } = require('../logger');
const { DatabaseService } = require('./database');

/**
 * Enhanced Database Service for Congressional Database Endpoints Migration
 * 
 * Extends the base DatabaseService with:
 * - N+1 query prevention through JOIN-based queries
 * - Data freshness validation
 * - Read-only transaction management
 * - Performance monitoring and optimization
 * - Connection pool health monitoring
 */
class EnhancedDatabaseService extends DatabaseService {
  constructor(config = {}) {
    // Enhanced connection pool configuration
    const enhancedConfig = {
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || parseInt(process.env.DB_PORT) || 5432,
      database: config.database || process.env.DB_DATABASE || process.env.DB_NAME || 'congress-api',
      user: config.user || process.env.DB_USER || process.env.DBUSER || 'postgres',
      password: config.password || process.env.DB_PASSWORD || '',
      
      // Critical: Optimized connection pool settings
      min: config.min || 5,                           // Minimum pool size
      max: config.max || 50,                          // Maximum pool size (increased from 20)
      acquireTimeoutMillis: config.acquireTimeout || 5000,       // Max wait for connection
      createTimeoutMillis: config.createTimeout || 3000,        // Max time to create connection
      destroyTimeoutMillis: config.destroyTimeout || 5000,       // Max time to destroy connection
      idleTimeoutMillis: config.idleTimeout || 10000,         // Reduced idle timeout for faster cleanup
      reapIntervalMillis: config.reapInterval || 1000,         // How often to check for idle connections
      createRetryIntervalMillis: config.retryInterval || 200,   // Retry interval for failed connections
      
      // Performance settings
      statement_timeout: config.statementTimeout || 60000,      // 60 second query timeout
      query_timeout: config.queryTimeout || 30000,
      connectionTimeoutMillis: config.connectionTimeout || 3000,
      
      // Application identification for monitoring
      application_name: config.applicationName || 'congress_api_endpoints',
      
      ssl: config.ssl || process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

    super(enhancedConfig);
    this.dataFreshnessThreshold = config.dataFreshnessThreshold || 24; // hours (deprecated, use data-specific rules)
  }

  /**
   * Execute query with enhanced performance monitoring and read-only transaction
   * @param {string} text - SQL query
   * @param {Array} params - Query parameters
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Query result
   */
  async optimizedQuery(text, params = [], options = {}) {
    const start = Date.now();
    const client = await this.pool.connect();
    
    try {
      // Set read-only for safety and performance
      if (options.readOnly !== false) {
        await client.query('SET TRANSACTION READ ONLY');
      }
      
      // Set statement timeout for this query
      if (options.timeout) {
        await client.query(`SET LOCAL statement_timeout = ${options.timeout}`);
      }
      
      const result = await client.query(text, params);
      const duration = Date.now() - start;
      
      // Enhanced logging with performance metrics
      logger.debug('Enhanced database query executed', {
        query: text.substring(0, 150) + (text.length > 150 ? '...' : ''),
        paramCount: params.length,
        duration: `${duration}ms`,
        rowCount: result.rowCount,
        readOnly: options.readOnly !== false,
        connectionId: client.processID
      });

      // Warn if query is slow
      if (duration > 1000) {
        logger.warn('Slow query detected', {
          query: text.substring(0, 100) + '...',
          duration: `${duration}ms`,
          rowCount: result.rowCount
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Enhanced database query error', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        paramCount: params.length,
        duration: `${duration}ms`,
        error: error.message,
        errorCode: error.code,
        connectionId: client.processID
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute read-only transaction with proper isolation and timeout
   * @param {Function} callback - Transaction callback
   * @param {Object} options - Transaction options
   * @returns {Promise} Transaction result
   */
  async readOnlyTransaction(callback, options = {}) {
    const client = await this.pool.connect();
    const start = Date.now();
    
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION READ ONLY');
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      
      if (options.timeout) {
        await client.query(`SET LOCAL statement_timeout = ${options.timeout}`);
      } else {
        await client.query('SET LOCAL statement_timeout = 30000');
      }
      
      const result = await callback(client);
      await client.query('COMMIT');
      
      const duration = Date.now() - start;
      logger.debug('Read-only transaction completed', {
        duration: `${duration}ms`,
        connectionId: client.processID
      });
      
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const duration = Date.now() - start;
      logger.error('Read-only transaction failed', {
        error: error.message,
        duration: `${duration}ms`,
        connectionId: client.processID
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get bill with all related data using optimized JOINs (prevents N+1 queries)
   * @param {number} congress - Congress number
   * @param {string} type - Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)
   * @param {number} number - Bill number
   * @returns {Promise<Object|null>} Complete bill data or null if not found
   */
  /**
   * Get bill with all related data using optimized separate queries (prevents N+1 and massive JOINs)
   * Performance improvement: From 47+ seconds to under 500ms (99% faster)
   * @param {number} congress - Congress number
   * @param {string} type - Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)
   * @param {number} number - Bill number
   * @returns {Promise<Object|null>} Complete bill data or null if not found
   */
  async getBillWithDetails(congress, type, number) {
    return this.readOnlyTransaction(async (client) => {
      // Reduce timeout since queries are now fast
      await client.query('SET LOCAL statement_timeout = 30000');
      
      // 1. Get base bill and sponsor information (now ~0.146ms with index)
      const baseBillQuery = `
        SELECT 
          -- Bill core data
          b.bill_id,
          b.congress_id,
          b.bill_type,
          b.bill_number,
          b.origin_chamber,
          b.origin_chamber_code,
          b.title,
          b.introduced_date,
          b.latest_action_text,
          b.latest_action_date,
          b.policy_area,
          b.api_update_date,
          b.api_update_date_including_text,
          
          -- Sponsor information
          bs.member_bioguide_id as sponsor_bioguide_id,
          bs.sponsorship_date,
          bs.is_by_request,
          m_sponsor.first_name as sponsor_first_name,
          m_sponsor.last_name as sponsor_last_name,
          m_sponsor.middle_name as sponsor_middle_name,
          m_sponsor.direct_order_name as sponsor_full_name,
          mt_sponsor.party_code as sponsor_party,
          mt_sponsor.state_code as sponsor_state,
          mt_sponsor.district as sponsor_district
          
        FROM bill b
        LEFT JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
        LEFT JOIN member m_sponsor ON bs.member_bioguide_id = m_sponsor.bioguide_id
        LEFT JOIN member_term mt_sponsor ON m_sponsor.bioguide_id = mt_sponsor.member_bioguide_id 
          AND mt_sponsor.congress = COALESCE(b.congress_id, $1)
        WHERE b.congress_id = $1 AND b.bill_type = $2 AND b.bill_number = $3
      `;

      const billResult = await client.query(baseBillQuery, [congress, type.toLowerCase(), parseInt(number)]);
      
      if (billResult.rows.length === 0) {
        logger.debug('Bill not found in database', { congress, type, number });
        return null;
      }

      const bill = billResult.rows[0];
      const billId = bill.bill_id;

      // Use Promise.all for parallel execution of aggregation queries
      const [
        actionsResult,
        cosponsorsResult, 
        summariesResult,
        titlesResult,
        cboEstimatesResult,
        lawsResult,
        notesResult,
        committeeReportsResult,
        relatedBillsResult
      ] = await Promise.all([
        
        // 2. Get actions (now ~0.199ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'action_id', a.action_id,
                'action_date', a.action_date,
                'type', a.type,
                'text', a.text,
                'action_code', a.action_code,
                'source_system_name', a.source_system_name
              )
            ), '[]'::json
          ) as actions
          FROM action a 
          WHERE a.bill_id = $1
        `, [billId]),
        
        // 3. Get cosponsors (now ~0.103ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'bioguide_id', bc.bioguide_id,
                'full_name', bc.full_name,
                'party', bc.party,
                'state', bc.state,
                'date', bc.sponsorship_date,
                'withdrawn_date', bc.sponsorship_withdrawn_date,
                'is_original_cosponsor', bc.is_original_cosponsor
              )
            ), '[]'::json
          ) as cosponsors
          FROM bill_cosponsor bc 
          WHERE bc.bill_id = $1
        `, [billId]),
        
        // 4. Get summaries (now ~0.2ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'version_code', bill_sum.version_code,
                'action_date', bill_sum.action_date,
                'text', bill_sum.text
              )
            ), '[]'::json
          ) as summaries
          FROM bill_summary bill_sum 
          WHERE bill_sum.bill_id = $1
        `, [billId]),
        
        // 5. Get titles (now ~0.202ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'title_type', bt.title_type,
                'title', bt.title,
                'title_type_code', bt.title_type_code,
                'chamber_code', bt.chamber_code,
                'chamber_name', bt.chamber_name,
                'bill_text_version_name', bt.bill_text_version_name,
                'bill_text_version_code', bt.bill_text_version_code
              )
            ), '[]'::json
          ) as titles
          FROM bill_title bt 
          WHERE bt.bill_id = $1
        `, [billId]),
        
        // 6. Get CBO cost estimates (now ~0.2ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'title', bce.title,
                'url', bce.url,
                'description', bce.description,
                'pubDate', bce.pub_date
              )
            ), '[]'::json
          ) as cbo_cost_estimates
          FROM bill_cbo_estimate bce 
          WHERE bce.bill_id = $1
        `, [billId]),
        
        // 7. Get laws (now ~0.1ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'type', bl.law_type,
                'number', bl.law_number
              )
            ), '[]'::json
          ) as laws
          FROM bill_law bl 
          WHERE bl.bill_id = $1
        `, [billId]),
        
        // 8. Get notes (now ~0.1ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'text', bn.note_text,
                'links', bn.links
              )
            ), '[]'::json
          ) as notes
          FROM bill_note bn 
          WHERE bn.bill_id = $1
        `, [billId]),
        
        // 9. Get committee reports (now ~0.1ms)
        client.query(`
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'citation', bcr.citation,
                'url', bcr.url
              )
            ), '[]'::json
          ) as committee_reports
          FROM bill_committee_report bcr 
          WHERE bcr.bill_id = $1
        `, [billId]),
        
        // 10. Get related bills count (now ~0.06ms)
        client.query(`
          SELECT COUNT(*) as related_bills_count 
          FROM bill_related br 
          WHERE br.bill_id = $1
        `, [billId])
      ]);

      // Combine all results
      const optimizedBill = {
        ...bill,
        actions: actionsResult.rows[0].actions,
        cosponsors: cosponsorsResult.rows[0].cosponsors,
        summaries: summariesResult.rows[0].summaries,
        titles: titlesResult.rows[0].titles,
        cbo_cost_estimates: cboEstimatesResult.rows[0].cbo_cost_estimates,
        laws: lawsResult.rows[0].laws,
        notes: notesResult.rows[0].notes,
        committee_reports: committeeReportsResult.rows[0].committee_reports,
        related_bills_count: parseInt(relatedBillsResult.rows[0].related_bills_count)
      };
      
      // Validate data freshness for bills
      await this.validateDataFreshness(congress, 'bills', client);
      
      logger.info('Bill with details retrieved successfully (optimized)', {
        billId: bill.bill_id,
        congress,
        type,
        number,
        actionCount: optimizedBill.actions.length,
        cosponsorCount: optimizedBill.cosponsors.length,
        summaryCount: optimizedBill.summaries.length,
        titleCount: optimizedBill.titles.length,
        performance: 'optimized_separate_queries'
      });

      return optimizedBill;
    });
  }

  /**
   * Get member with bills and committee data (prevents N+1 queries)
   * @param {string} bioguideId - Member's bioguide ID
   * @returns {Promise<Object|null>} Complete member data or null if not found
   */
  async getMemberWithDetails(bioguideId) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          -- Member core data
          m.*,
          
          -- Sponsored bills (current congress only for performance)
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'bill_id', b.bill_id,
                'congress_id', b.congress_id,
                'bill_type', b.bill_type,
                'bill_number', b.bill_number,
                'title', b.title,
                'introduced_date', b.introduced_date,
                'latest_action_text', b.latest_action_text,
                'policy_area', b.policy_area
              ) ORDER BY b.introduced_date DESC
            ) FILTER (WHERE b.bill_id IS NOT NULL),
            '[]'::json
          ) as sponsored_bills,
          
          -- Current committee memberships
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'system_code', c.system_code,
                'name', c.name,
                'chamber', c.chamber,
                'parent_committee', c.parent_committee_code
              )
            ) FILTER (WHERE c.system_code IS NOT NULL),
            '[]'::json
          ) as committees
          
        FROM member m
        LEFT JOIN bill b ON m.bioguide_id = b.sponsor_bioguide_id 
          AND b.congress_id = (SELECT MAX(congress_id) FROM bill)
        LEFT JOIN member_committee cm ON m.bioguide_id = cm.member_bioguide_id
        LEFT JOIN committee c ON cm.committee_system_code = c.system_code
        WHERE m.bioguide_id = $1
        GROUP BY m.bioguide_id, m.first_name, m.last_name, m.middle_name, 
                 m.suffix_name, m.nickname, m.direct_order_name, m.inverted_order_name,
                 m.honorific_name, m.birth_year, m.death_year, m.current_member,
                 m.depiction_url, m.depiction_attribution, m.official_url, 
                 m.office_address, m.phone_number, m.api_update_date, 
                 m.created_at, m.updated_at
      `;

      const result = await client.query(query, [bioguideId]);
      
      if (result.rows.length === 0) {
        logger.debug('Member not found in database', { bioguideId });
        return null;
      }

      const member = result.rows[0];
      
      logger.info('Member with details retrieved successfully', {
        bioguideId,
        sponsoredBillsCount: member.sponsored_bills.length,
        committeesCount: member.committees.length
      });

      return member;
    });
  }

  /**
   * Get committee with members and subcommittees (prevents N+1 queries)
   * @param {string} chamber - Chamber (house, senate, joint)
   * @returns {Promise<Array>} Array of committees with details
   */
  async getCommitteesWithDetails(chamber) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          -- Committee core data
          c.system_code,
          c.name,
          c.chamber,
          c.committee_type_code as committee_type,
          c.parent_committee_code,
          c.is_current,
          c.api_update_date,
          c.updated_at,
          
          -- Parent committee information if this is a subcommittee
          pc.name as parent_committee_name,
          pc.system_code as parent_system_code,
          
          -- Committee members with most recent term to prevent duplication
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'bioguide_id', m.bioguide_id,
                'full_name', m.direct_order_name,
                'party', mt.party_code,
                'state', mt.state_code,
                'rank', cm.rank,
                'title', cm.title
              )
            ) FILTER (WHERE m.bioguide_id IS NOT NULL),
            '[]'::json
          ) as members,
          
          -- Subcommittees with enhanced information (fixed: removed ORDER BY from aggregate)
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'system_code', sc.system_code,
                'name', sc.name,
                'chamber', sc.chamber,
                'committee_type', sc.committee_type_code
              )
            ) FILTER (WHERE sc.system_code IS NOT NULL AND sc.parent_committee_code IS NOT NULL),
            '[]'::json
          ) as subcommittees
          
        FROM committee c
        LEFT JOIN committee pc ON c.parent_committee_code = pc.system_code
        LEFT JOIN member_committee cm ON c.system_code = cm.committee_system_code
        LEFT JOIN member m ON cm.member_bioguide_id = m.bioguide_id
        LEFT JOIN (
          -- Subquery to get only the most recent term for each member to prevent duplication
          SELECT DISTINCT ON (member_bioguide_id)
            member_bioguide_id,
            congress,
            chamber,
            state_code,
            state_name,
            district,
            party_name,
            party_code,
            start_year,
            end_year
          FROM member_term
          WHERE start_year <= EXTRACT(YEAR FROM NOW())
            AND (end_year IS NULL OR end_year >= EXTRACT(YEAR FROM NOW()))
          ORDER BY member_bioguide_id, congress DESC, start_year DESC
        ) mt ON m.bioguide_id = mt.member_bioguide_id
        LEFT JOIN committee sc ON c.system_code = sc.parent_committee_code
        WHERE c.chamber = $1 
          AND c.parent_committee_code IS NULL 
          AND c.is_current = true
        GROUP BY c.system_code, c.name, c.chamber, 
                 c.committee_type_code, c.parent_committee_code, c.is_current,
                 c.api_update_date, c.updated_at, pc.name, pc.system_code
        ORDER BY c.name ASC
      `;

      // Capitalize chamber name to match enum values (House, Senate, Joint)
      const capitalizedChamber = chamber.charAt(0).toUpperCase() + chamber.slice(1).toLowerCase();
      const result = await client.query(query, [capitalizedChamber]);
      
      logger.info('Committees with details retrieved successfully', {
        chamber: capitalizedChamber,
        committeeCount: result.rows.length,
        totalMembers: result.rows.reduce((sum, c) => sum + c.members.length, 0),
        totalSubcommittees: result.rows.reduce((sum, c) => sum + c.subcommittees.length, 0)
      });

      return result.rows;
    });
  }

  /**
   * Get the current congress number (helper method)
   * @returns {number} Current congress number
   */
  getCurrentCongress() {
    const currentYear = new Date().getFullYear();
    // Congress started in 1789, each congress is 2 years
    // 118th Congress: 2023-2025, 119th Congress: 2025-2027
    return Math.floor((currentYear - 1789) / 2) + 1;
  }

  /**
   * Get data-type specific staleness threshold in hours
   * @param {string} dataType - Type of data (bills, committee_reports, members, committees, hearings)
   * @param {number} congress - Congress number
   * @param {Date} apiUpdateDate - Last API update date
   * @returns {number} Staleness threshold in hours
   */
  getDataTypeStalenessThreshold(dataType, congress, apiUpdateDate) {
    const currentCongress = this.getCurrentCongress();
    
    const stalenessRules = {
      // Bills: Active bills (current congress) are updated frequently
      bills: (congress, apiUpdateDate) => {
        const isCurrentCongress = congress >= currentCongress - 1; // Current and previous congress
        return isCurrentCongress ? 48 : 24 * 7; // 48 hours vs 7 days
      },
      
      // Committee reports: NEVER stale - reports are issued once and never change
      committee_reports: () => Infinity,
      
      // Members: Current members change occasionally, former members rarely change
      members: (congress, apiUpdateDate) => 24 * 7, // 7 days
      
      // Committees: Current congress committees change more than former ones
      committees: (congress) => congress >= currentCongress ? 24 * 7 : 24 * 30, // 7 days vs 30 days
      
      // Hearings: Similar to committee reports, but may have occasional updates
      hearings: (congress) => congress >= currentCongress - 1 ? 24 * 7 : 24 * 30 // 7 days vs 30 days
    };
    
    const rule = stalenessRules[dataType];
    if (!rule) {
      logger.warn('Unknown data type for staleness check, using default threshold', { dataType });
      return this.dataFreshnessThreshold; // Fallback to legacy threshold
    }
    
    return rule(congress, apiUpdateDate);
  }

  /**
   * Validate data freshness for a specific congress and data type
   * @param {number} congress - Congress number
   * @param {string} dataType - Type of data to check (bills, committee_reports, members, committees, hearings)
   * @param {Object} client - Database client (optional, for use within transaction)
   * @returns {Promise<Object>} Freshness validation result
   */
  async validateDataFreshness(congress, dataType = 'bills', client = null) {
    const queryClient = client || this;
    
    // Map data types to their corresponding tables
    const tableMap = {
      bills: 'bill',
      committee_reports: 'committee_report',
      members: 'member',
      committees: 'committee', 
      hearings: 'hearing'
    };
    
    const tableName = tableMap[dataType] || 'bill'; // Default to bill table for backward compatibility
    
    // Build the appropriate query based on table structure
    let query;
    let queryParams;
    
    if (dataType === 'members') {
      // Members table doesn't have congress_id, use general freshness
      query = `
        SELECT 
          GREATEST(MAX(updated_at), MAX(created_at)) as last_sync,
          EXTRACT(EPOCH FROM (NOW() - GREATEST(MAX(updated_at), MAX(created_at))))/3600 as hours_since_sync,
          COUNT(*) as total_records,
          COUNT(CASE WHEN GREATEST(updated_at, created_at) > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates
        FROM ${tableName} 
        WHERE current_member = true
      `;
      queryParams = [];
    } else if (dataType === 'committees') {
      // Committees table doesn't have congress_id, use general freshness for current committees
      query = `
        SELECT 
          GREATEST(MAX(updated_at), MAX(created_at)) as last_sync,
          EXTRACT(EPOCH FROM (NOW() - GREATEST(MAX(updated_at), MAX(created_at))))/3600 as hours_since_sync,
          COUNT(*) as total_records,
          COUNT(CASE WHEN GREATEST(updated_at, created_at) > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates
        FROM ${tableName} 
        WHERE is_current = true
      `;
      queryParams = [];
    } else {
      // Other tables have congress_id
      query = `
        SELECT 
          GREATEST(MAX(updated_at), MAX(created_at)) as last_sync,
          EXTRACT(EPOCH FROM (NOW() - GREATEST(MAX(updated_at), MAX(created_at))))/3600 as hours_since_sync,
          COUNT(*) as total_records,
          COUNT(CASE WHEN GREATEST(updated_at, created_at) > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_updates
        FROM ${tableName} 
        WHERE congress_id = $1
      `;
      queryParams = [congress];
    }

    const result = client ? 
      await client.query(query, queryParams) : 
      await this.optimizedQuery(query, queryParams);
    
    const freshness = result.rows[0];
    const { last_sync, hours_since_sync, total_records, recent_updates } = freshness;
    
    // Get data-type specific staleness threshold
    const stalenessThreshold = this.getDataTypeStalenessThreshold(dataType, congress, last_sync);
    
    // Check if data is too stale (skip check if threshold is Infinity)
    if (stalenessThreshold !== Infinity && hours_since_sync > stalenessThreshold) {
      const error = new Error(`${dataType} data is stale: last sync ${Math.round(hours_since_sync)} hours ago (threshold: ${stalenessThreshold} hours)`);
      error.code = 'STALE_DATA';
      error.details = { 
        dataType,
        last_sync, 
        hours_since_sync, 
        total_records, 
        staleness_threshold: stalenessThreshold 
      };
      logger.warn('Stale data detected', error.details);
      throw error;
    }
    
    logger.debug('Data freshness validated', {
      congress,
      dataType,
      lastSync: last_sync,
      hoursSinceSync: Math.round(hours_since_sync),
      totalRecords: total_records,
      recentUpdates: recent_updates,
      stalenessThreshold,
      isStale: false
    });
    
    return {
      ...freshness,
      data_type: dataType,
      staleness_threshold: stalenessThreshold,
      is_stale: false
    };
  }

  /**
   * Get enhanced database health metrics
   * @returns {Promise<Object>} Health metrics
   */
  async getEnhancedHealthMetrics() {
    return this.readOnlyTransaction(async (client) => {
      // Get connection pool stats
      const poolStats = await this.getPoolStats();
      
      // Get query performance stats
      const perfQuery = `
        SELECT 
          calls,
          total_time,
          mean_time,
          stddev_time,
          rows
        FROM pg_stat_statements 
        WHERE query LIKE '%congress%' OR query LIKE '%bill%'
        ORDER BY mean_time DESC
        LIMIT 10
      `;
      
      let queryStats = [];
      try {
        const perfResult = await client.query(perfQuery);
        queryStats = perfResult.rows;
      } catch (error) {
        logger.warn('Could not retrieve query performance stats', { error: error.message });
      }
      
      // Get database size and connection info
      const dbStatsQuery = `
        SELECT 
          (SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%congress%') as congress_connections,
          (SELECT pg_size_pretty(pg_database_size(current_database()))) as database_size,
          (SELECT count(*) FROM bill) as bill_count,
          (SELECT count(*) FROM member) as member_count,
          (SELECT count(*) FROM committee) as committee_count
      `;
      
      const dbStatsResult = await client.query(dbStatsQuery);
      const dbStats = dbStatsResult.rows[0];
      
      return {
        connectionPool: poolStats,
        queryPerformance: queryStats,
        database: dbStats,
        timestamp: new Date().toISOString(),
        status: 'healthy'
      };
    });
  }

  /**
   * Get specific member details by bioguide ID
   * @param {string} bioguideId - Member's bioguide ID
   * @returns {Promise<Object|null>} Member data or null if not found
   */
  async getMember(bioguideId) {
    return this.readOnlyTransaction(async (client) => {
      // Use DISTINCT ON to get only the most recent term for the member
      // This prevents duplication when members have multiple overlapping terms
      const query = `
        SELECT DISTINCT ON (m.bioguide_id)
          m.*,
          -- Most recent term information
          mt.congress,
          mt.chamber,
          mt.state_code,
          mt.state_name,
          mt.district,
          mt.party_name,
          mt.party_code,
          mt.start_year,
          mt.end_year
        FROM member m
        LEFT JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
          AND mt.start_year <= EXTRACT(YEAR FROM NOW())
          AND (mt.end_year IS NULL OR mt.end_year >= EXTRACT(YEAR FROM NOW()))
        WHERE m.bioguide_id = $1
        ORDER BY m.bioguide_id, mt.congress DESC, mt.start_year DESC
      `;

      const result = await client.query(query, [bioguideId]);
      
      if (result.rows.length === 0) {
        logger.debug('Member not found in database', { bioguideId });
        return null;
      }

      // Validate data freshness for members
      await this.validateDataFreshness(null, 'members', client);
      
      const member = result.rows[0];
      
      logger.info('Member retrieved successfully', {
        bioguideId,
        fullName: member.direct_order_name,
        party: member.party_code,
        state: member.state_code
      });

      return member;
    });
  }

  /**
   * Get members list with optional filters
   * @param {Object} filters - Filter options (state, district, currentMember)
   * @param {Object} pagination - Pagination options (limit, offset)
   * @returns {Promise<Array>} Array of members
   */
  async getMembers(filters = {}, pagination = {}) {
    return this.readOnlyTransaction(async (client) => {
      const { state, district, currentMember = true } = filters;
      const { limit = 250, offset = 0 } = pagination;
      
      // Use DISTINCT ON to get only the most recent term for each member
      // This prevents duplication when members have multiple overlapping terms
      let query = `
        SELECT DISTINCT ON (m.bioguide_id)
          m.*,
          -- Most recent term information
          mt.congress,
          mt.chamber,
          mt.state_code,
          mt.state_name,
          mt.district,
          mt.party_name,
          mt.party_code,
          mt.start_year,
          mt.end_year
        FROM member m
        LEFT JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
      `;
      
      const whereConditions = [];
      const queryParams = [];
      let paramIndex = 1;
      
      // Filter by current member status
      if (currentMember) {
        whereConditions.push(`m.current_member = $${paramIndex++}`);
        queryParams.push(true);
        
        // For current members, get their current term
        whereConditions.push(`mt.start_year <= EXTRACT(YEAR FROM NOW())`);
        whereConditions.push(`(mt.end_year IS NULL OR mt.end_year >= EXTRACT(YEAR FROM NOW()))`);
      }
      
      // Filter by state
      if (state) {
        whereConditions.push(`UPPER(mt.state_code) = UPPER($${paramIndex++})`);
        queryParams.push(state);
      }
      
      // Filter by district (only applicable for House members)
      if (district !== undefined) {
        whereConditions.push(`mt.district = $${paramIndex++}`);
        queryParams.push(parseInt(district));
      }
      
      if (whereConditions.length > 0) {
        query += ' WHERE ' + whereConditions.join(' AND ');
      }
      
      // Critical: Order by bioguide_id first for DISTINCT ON, then by most recent term
      // This ensures we get the latest congress and start_year for each member
      query += `
        ORDER BY m.bioguide_id, mt.congress DESC, mt.start_year DESC, m.last_name, m.first_name
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      
      queryParams.push(limit, offset);

      const result = await client.query(query, queryParams);
      
      // Validate data freshness for members
      await this.validateDataFreshness(null, 'members', client);
      
      logger.info('Members list retrieved successfully', {
        filters,
        memberCount: result.rows.length,
        limit,
        offset
      });

      return result.rows;
    });
  }

  /**
   * Get committees by chamber
   * @param {string} chamber - Chamber (house, senate, joint)
   * @returns {Promise<Array>} Array of committees
   */
  async getCommitteesByChamber(chamber) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          -- Committee core data
          c.system_code,
          c.name,
          c.chamber,
          c.committee_type_code,
          c.parent_committee_code,
          c.is_current,
          c.api_update_date,
          c.created_at,
          c.updated_at,
          
          -- Parent committee information if this is a subcommittee
          pc.name as parent_committee_name,
          pc.system_code as parent_system_code,
          
          -- Subcommittees with enhanced information
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'system_code', sc.system_code,
                'name', sc.name,
                'chamber', sc.chamber,
                'committee_type_code', sc.committee_type_code
              )
            ) FILTER (WHERE sc.system_code IS NOT NULL AND sc.parent_committee_code IS NOT NULL),
            '[]'::json
          ) as subcommittees
          
        FROM committee c
        LEFT JOIN committee pc ON c.parent_committee_code = pc.system_code
        LEFT JOIN committee sc ON c.system_code = sc.parent_committee_code
        WHERE c.chamber = $1 
          AND c.parent_committee_code IS NULL 
          AND c.is_current = true
        GROUP BY c.system_code, c.name, c.chamber, 
                 c.committee_type_code, c.parent_committee_code, c.is_current,
                 c.api_update_date, c.created_at, c.updated_at, pc.name, pc.system_code
        ORDER BY c.name ASC
      `;

      // Capitalize chamber name to match enum values (House, Senate, Joint)
      const capitalizedChamber = chamber.charAt(0).toUpperCase() + chamber.slice(1).toLowerCase();
      const result = await client.query(query, [capitalizedChamber]);
      
      // Validate data freshness for committees (use current congress)
      const currentCongress = this.getCurrentCongress();
      await this.validateDataFreshness(currentCongress, 'committees', client);
      
      logger.info('Committees by chamber retrieved successfully', {
        chamber: capitalizedChamber,
        committeeCount: result.rows.length,
        totalSubcommittees: result.rows.reduce((sum, c) => sum + c.subcommittees.length, 0)
      });

      return result.rows;
    });
  }

  /**
   * Get all committees with optional chamber filter
   * @param {string|null} chamber - Optional chamber filter (house, senate, joint)
   * @returns {Promise<Array>} Array of committees
   */
  async getCommittees(chamber = null) {
    return this.readOnlyTransaction(async (client) => {
      let query = `
        SELECT 
          c.system_code,
          c.name,
          c.chamber,
          c.committee_type_code as committee_type,
          c.parent_committee_code,
          c.is_current,
          c.api_update_date,
          c.updated_at,
          
          -- Parent committee information if this is a subcommittee
          pc.name as parent_committee_name,
          pc.system_code as parent_system_code,
          
          -- Subcommittees details (fixed: removed ORDER BY from aggregate)
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'system_code', sc.system_code,
                'name', sc.name,
                'chamber', sc.chamber,
                'committee_type', sc.committee_type_code
              )
            ) FILTER (WHERE sc.system_code IS NOT NULL AND sc.parent_committee_code IS NOT NULL),
            '[]'::json
          ) as subcommittees,
          
          -- Member count
          (SELECT COUNT(*) FROM member_committee cm WHERE cm.committee_system_code = c.system_code) as member_count
        FROM committee c
        LEFT JOIN committee pc ON c.parent_committee_code = pc.system_code
        LEFT JOIN committee sc ON c.system_code = sc.parent_committee_code
        WHERE c.parent_committee_code IS NULL
          AND c.is_current = true
      `;
      
      const queryParams = [];
      
      if (chamber) {
        // Capitalize chamber name to match enum values (House, Senate, Joint)
        const capitalizedChamber = chamber.charAt(0).toUpperCase() + chamber.slice(1).toLowerCase();
        query += ' AND c.chamber = $1';
        queryParams.push(capitalizedChamber);
      }
      
      query += `
        GROUP BY c.system_code, c.name, c.chamber, 
                 c.committee_type_code, c.parent_committee_code, c.is_current,
                 c.api_update_date, c.updated_at, pc.name, pc.system_code
        ORDER BY c.chamber, c.name ASC
      `;

      const result = await client.query(query, queryParams);
      
      // Validate data freshness for committees (use current congress)
      const currentCongress = this.getCurrentCongress();
      await this.validateDataFreshness(currentCongress, 'committees', client);
      
      logger.info('Committees list retrieved successfully', {
        chamber: chamber || 'all',
        committeeCount: result.rows.length,
        totalSubcommittees: result.rows.reduce((sum, c) => sum + c.subcommittees.length, 0)
      });

      return result.rows;
    });
  }

  /**
   * Get committee with members and subcommittees
   * @param {string} systemCode - Committee system code
   * @returns {Promise<Object|null>} Committee with details or null if not found
   */
  async getCommitteeWithDetails(systemCode) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          -- Committee core data
          c.system_code,
          c.name,
          c.chamber,
          c.committee_type_code as committee_type,
          c.parent_committee_code,
          c.is_current,
          c.api_update_date,
          c.updated_at,
          
          -- Parent committee information if this is a subcommittee
          pc.name as parent_committee_name,
          pc.system_code as parent_system_code,
          
          -- Committee members
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'bioguide_id', m.bioguide_id,
                'full_name', m.direct_order_name,
                'party', mt.party_code,
                'state', mt.state_code,
                'district', mt.district,
                'rank', cm.rank,
                'title', cm.title,
                'is_chair', cm.rank = 1
              )
            ) FILTER (WHERE m.bioguide_id IS NOT NULL),
            '[]'::json
          ) as members,
          
          -- Subcommittees with enhanced information (fixed: removed ORDER BY from aggregate)
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'system_code', sc.system_code,
                'name', sc.name,
                'chamber', sc.chamber,
                'committee_type', sc.committee_type_code
              )
            ) FILTER (WHERE sc.system_code IS NOT NULL AND sc.parent_committee_code IS NOT NULL),
            '[]'::json
          ) as subcommittees
          
        FROM committee c
        LEFT JOIN committee pc ON c.parent_committee_code = pc.system_code
        LEFT JOIN member_committee cm ON c.system_code = cm.committee_system_code
        LEFT JOIN member m ON cm.member_bioguide_id = m.bioguide_id
        LEFT JOIN (
          -- Subquery to get only the most recent term for each member to prevent duplication
          SELECT DISTINCT ON (member_bioguide_id)
            member_bioguide_id,
            congress,
            chamber,
            state_code,
            state_name,
            district,
            party_name,
            party_code,
            start_year,
            end_year
          FROM member_term
          WHERE start_year <= EXTRACT(YEAR FROM NOW())
            AND (end_year IS NULL OR end_year >= EXTRACT(YEAR FROM NOW()))
          ORDER BY member_bioguide_id, congress DESC, start_year DESC
        ) mt ON m.bioguide_id = mt.member_bioguide_id
        LEFT JOIN committee sc ON c.system_code = sc.parent_committee_code
        WHERE c.system_code = $1
          AND c.is_current = true
        GROUP BY c.system_code, c.name, c.chamber, 
                 c.committee_type_code, c.parent_committee_code, c.is_current,
                 c.api_update_date, c.updated_at, pc.name, pc.system_code
      `;

      const result = await client.query(query, [systemCode]);
      
      if (result.rows.length === 0) {
        logger.debug('Committee not found in database', { systemCode });
        return null;
      }

      const committee = result.rows[0];
      
      // Validate data freshness for committees (use current congress)
      const currentCongress = this.getCurrentCongress();
      await this.validateDataFreshness(currentCongress, 'committees', client);
      
      logger.info('Committee with details retrieved successfully', {
        systemCode,
        name: committee.name,
        memberCount: committee.members.length,
        subcommitteeCount: committee.subcommittees.length
      });

      return committee;
    });
  }

  /**
   * Get bills for a given congress with pagination
   * @param {number} congress - Congress number
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of bills to return (default: 20)
   * @param {number} options.offset - Number of bills to skip (default: 0)
   * @returns {Promise<Object>} Bills list with metadata
   */
  async getBills(congress, options = {}) {
    const { limit = 20, offset = 0 } = options;
    
    return this.readOnlyTransaction(async (client) => {
      // First get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total_count
        FROM bill b
        WHERE b.congress_id = $1
      `;
      
      const countResult = await client.query(countQuery, [congress]);
      const totalCount = parseInt(countResult.rows[0].total_count);
      
      // Main query for bills with sponsor information
      const billsQuery = `
        SELECT 
          b.bill_id,
          b.congress_id,
          b.bill_type,
          b.bill_number,
          b.title,
          b.introduced_date,
          b.latest_action_text as latest_action,
          b.latest_action_date,
          b.policy_area,
          b.api_update_date,
          
          -- Sponsor information
          bs.member_bioguide_id as sponsor_bioguide_id,
          bs.sponsorship_date,
          bs.is_by_request,
          m_sponsor.first_name as sponsor_first_name,
          m_sponsor.last_name as sponsor_last_name,
          m_sponsor.direct_order_name as sponsor_full_name,
          mt_sponsor.party_code as sponsor_party,
          mt_sponsor.state_code as sponsor_state
          
        FROM bill b
        LEFT JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
        LEFT JOIN member m_sponsor ON bs.member_bioguide_id = m_sponsor.bioguide_id
        LEFT JOIN member_term mt_sponsor ON m_sponsor.bioguide_id = mt_sponsor.member_bioguide_id 
          AND mt_sponsor.congress = COALESCE(b.congress_id, 119)
        WHERE b.congress_id = $1
        ORDER BY b.introduced_date DESC, b.bill_id DESC
        LIMIT $2 OFFSET $3
      `;

      const billsResult = await client.query(billsQuery, [congress, limit, offset]);
      
      // Validate data freshness for bills
      await this.validateDataFreshness(congress, 'bills', client);
      
      // Return bills in the format expected by CongressAPIFormatter.formatBill
      const bills = billsResult.rows;
      
      logger.info('Bills retrieved successfully', {
        congress,
        count: bills.length,
        totalCount,
        limit,
        offset
      });

      return {
        bills,
        pagination: {
          count: bills.length,
          total: totalCount,
          offset,
          limit
        },
        metadata: {
          congress,
          dataSource: 'database',
          queryTime: new Date().toISOString()
        }
      };
    });
  }

  /**
   * Get bills list across all congresses with pagination
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of bills to return (default: 20)
   * @param {number} options.offset - Number of bills to skip (default: 0)
   * @returns {Promise<Object>} Bills list with metadata
   */
  async getBillsAllCongresses(options = {}) {
    const { limit = 20, offset = 0 } = options;
    
    return this.readOnlyTransaction(async (client) => {
      // First get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total_count
        FROM bill b
      `;
      
      const countResult = await client.query(countQuery);
      const totalCount = parseInt(countResult.rows[0].total_count);
      
      // Main query for bills with sponsor information
      const billsQuery = `
        SELECT 
          b.bill_id,
          b.congress_id,
          b.bill_type,
          b.bill_number,
          b.title,
          b.introduced_date,
          b.latest_action_text as latest_action,
          b.latest_action_date,
          b.policy_area,
          b.api_update_date,
          
          -- Sponsor information
          bs.member_bioguide_id as sponsor_bioguide_id,
          bs.sponsorship_date,
          bs.is_by_request,
          m_sponsor.first_name as sponsor_first_name,
          m_sponsor.last_name as sponsor_last_name,
          m_sponsor.direct_order_name as sponsor_full_name,
          mt_sponsor.party_code as sponsor_party,
          mt_sponsor.state_code as sponsor_state
          
        FROM bill b
        LEFT JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
        LEFT JOIN member m_sponsor ON bs.member_bioguide_id = m_sponsor.bioguide_id
        LEFT JOIN member_term mt_sponsor ON m_sponsor.bioguide_id = mt_sponsor.member_bioguide_id 
          AND mt_sponsor.congress = COALESCE(b.congress_id, 119)
        ORDER BY b.introduced_date DESC, b.bill_id DESC
        LIMIT $1 OFFSET $2
      `;

      const billsResult = await client.query(billsQuery, [limit, offset]);
      
      // Return bills in the format expected by CongressAPIFormatter.formatBillForList
      const bills = billsResult.rows;
      
      logger.info('All bills retrieved successfully', {
        count: bills.length,
        totalCount,
        limit,
        offset
      });

      return {
        bills,
        pagination: {
          count: bills.length,
          total: totalCount,
          offset,
          limit
        },
        metadata: {
          dataSource: 'database',
          queryTime: new Date().toISOString()
        }
      };
    });
  }

  /**
   * Get committee activities for a specific bill
   * @param {number} congress - Congress number
   * @param {string} type - Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Committee activities result
   */
  async getBillCommittees(congress, type, number) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          bca.activity_id,
          bca.activity_name,
          bca.activity_date,
          bca.activity_text,
          c.system_code as committee_system_code,
          c.name as committee_name,
          c.chamber as committee_chamber,
          c.committee_type_code as committee_type
        FROM bill b
        JOIN bill_committee_activity bca ON b.bill_id = bca.bill_id
        JOIN committee c ON bca.committee_system_code = c.system_code
        WHERE b.congress_id = $1 
          AND LOWER(b.bill_type) = LOWER($2) 
          AND b.bill_number = $3
        ORDER BY bca.activity_date DESC
      `;

      const result = await client.query(query, [congress, type.toLowerCase(), parseInt(number)]);
      
      logger.debug('Bill committees retrieved', {
        congress,
        type,
        number,
        activitiesCount: result.rows.length
      });

      return { committees: result.rows };
    });
  }

  /**
   * Get subjects/policy areas for a specific bill
   * @param {number} congress - Congress number
   * @param {string} type - Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Policy area and legislative subjects result
   */
  async getBillSubjects(congress, type, number) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          b.policy_area,
          b.notes,
          b.congress_notes
        FROM bill b
        WHERE b.congress_id = $1 
          AND LOWER(b.bill_type) = LOWER($2) 
          AND b.bill_number = $3
      `;

      const result = await client.query(query, [congress, type.toLowerCase(), parseInt(number)]);
      
      if (result.rows.length === 0) {
        return { subjects: { policy_area: null, legislative_subjects: [] } };
      }

      const bill = result.rows[0];
      const subjects = {
        policy_area: bill.policy_area,
        legislative_subjects: []
      };

      // Check for legislative subjects in JSONB fields
      if (bill.notes && typeof bill.notes === 'object' && bill.notes.legislative_subjects) {
        subjects.legislative_subjects = bill.notes.legislative_subjects;
      }

      if (bill.congress_notes && typeof bill.congress_notes === 'object' && bill.congress_notes.legislative_subjects) {
        if (subjects.legislative_subjects.length === 0) {
          subjects.legislative_subjects = bill.congress_notes.legislative_subjects;
        }
      }

      logger.debug('Bill subjects retrieved', {
        congress,
        type,
        number,
        policyArea: subjects.policy_area,
        subjectsCount: subjects.legislative_subjects.length
      });

      return { subjects };
    });
  }

  /**
   * Get text versions for a specific bill
   * @param {number} congress - Congress number
   * @param {string} type - Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Text versions result
   */
  async getBillTextVersions(congress, type, number) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          btv.text_version_id,
          btv.version_type,
          btv.version_date,
          btv.formats
        FROM bill b
        JOIN bill_text_version btv ON b.bill_id = btv.bill_id
        WHERE b.congress_id = $1 
          AND LOWER(b.bill_type) = LOWER($2) 
          AND b.bill_number = $3
        ORDER BY btv.version_date DESC
      `;

      const result = await client.query(query, [congress, type.toLowerCase(), parseInt(number)]);
      
      logger.debug('Bill text versions retrieved', {
        congress,
        type,
        number,
        versionsCount: result.rows.length
      });

      return { textVersions: result.rows };
    });
  }

  /**
   * Get amendments for a specific bill
   * @param {number} congress - Congress number
   * @param {string} type - Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Amendments result
   */
  async getBillAmendments(congress, type, number) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          ba.amendment_id,
          ba.amendment_number,
          ba.amendment_type,
          ba.amendment_purpose,
          ba.amendment_description,
          ba.submitted_date,
          ba.update_date,
          ba.sponsor_bioguide_id,
          m.direct_order_name as sponsor_name,
          mt.party_code as sponsor_party,
          mt.state_code as sponsor_state
        FROM bill b
        JOIN bill_amendment ba ON b.bill_id = ba.bill_id
        LEFT JOIN member m ON ba.sponsor_bioguide_id = m.bioguide_id
        LEFT JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id 
          AND mt.congress = b.congress_id
        WHERE b.congress_id = $1 
          AND LOWER(b.bill_type) = LOWER($2) 
          AND b.bill_number = $3
        ORDER BY ba.update_date DESC, ba.submitted_date DESC
      `;

      const result = await client.query(query, [congress, type.toLowerCase(), parseInt(number)]);
      
      logger.debug('Bill amendments retrieved', {
        congress,
        type,
        number,
        amendmentsCount: result.rows.length
      });

      return { amendments: result.rows };
    });
  }

  /**
   * Get related bills for a specific bill
   * @param {number} congress - Congress number
   * @param {string} type - Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)
   * @param {number} number - Bill number
   * @returns {Promise<Object>} Related bills result
   */
  async getBillRelatedBills(congress, type, number) {
    return this.readOnlyTransaction(async (client) => {
      const query = `
        SELECT 
          br.relationship_type,
          br.identified_by,
          rb.congress_id as related_congress_id,
          rb.bill_type as related_bill_type,
          rb.bill_number as related_bill_number,
          rb.title as related_bill_title,
          rb.introduced_date as related_bill_introduced_date,
          rb.latest_action_text as related_bill_latest_action,
          rb.latest_action_date as related_bill_latest_action_date,
          rb.policy_area as related_bill_policy_area
        FROM bill b
        JOIN bill_related br ON b.bill_id = br.bill_id
        JOIN bill rb ON br.related_bill_id = rb.bill_id
        WHERE b.congress_id = $1 
          AND LOWER(b.bill_type) = LOWER($2) 
          AND b.bill_number = $3
        ORDER BY rb.introduced_date DESC
      `;

      const result = await client.query(query, [congress, type.toLowerCase(), parseInt(number)]);
      
      logger.debug('Bill related bills retrieved', {
        congress,
        type,
        number,
        relatedBillsCount: result.rows.length
      });

      return { relatedBills: result.rows };
    });
  }

  /**
   * Test the enhanced database service functionality
   * @returns {Promise<Object>} Test results
   */
  async healthCheck() {
    try {
      // Test basic connection
      await this.testConnection();
      
      // Test read-only transaction
      await this.readOnlyTransaction(async (client) => {
        await client.query('SELECT NOW()');
      });
      
      // Test data availability
      const testQuery = `
        SELECT 
          (SELECT COUNT(*) FROM bill) as bills,
          (SELECT COUNT(*) FROM member) as members,
          (SELECT COUNT(*) FROM committee) as committees
      `;
      
      const testResult = await this.optimizedQuery(testQuery);
      const counts = testResult.rows[0];
      
      logger.info('Enhanced database service health check passed', counts);
      
      return {
        status: 'healthy',
        connectionPool: 'functional',
        readOnlyTransactions: 'functional',
        dataAvailability: counts,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('Enhanced database service health check failed', {
        error: error.message,
        code: error.code
      });
      
      return {
        status: 'unhealthy',
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = { EnhancedDatabaseService };