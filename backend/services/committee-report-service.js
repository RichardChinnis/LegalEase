const { logger } = require('../logger');

/**
 * Committee Report Database Service
 * 
 * Handles all database operations related to committee reports including:
 * - Comprehensive committee report queries with associated bills
 * - Committee information from JSONB fields
 * - Pagination support for large result sets
 * - Response formatting matching Congress API structure
 * 
 * Optimized for Congress API response structure with performance considerations
 */
class CommitteeReportService {
  constructor(database = null) {
    // Use provided database connection or create new connection using environment variables
    if (database) {
      this.db = database;
      this.shouldCloseDb = false;
    } else {
      if (!process.env.DB_PASSWORD) {
        throw new Error('DB_PASSWORD environment variable is required');
      }
      const { Pool } = require('pg');

      this.db = new Pool({
        user: process.env.DB_USER || 'congress_admin',
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_DATABASE || 'congress_api',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      this.shouldCloseDb = true;
    }
    
    logger.info('CommitteeReportService initialized', {
      hasExternalDb: !!database,
      willManageConnection: this.shouldCloseDb
    });
  }

  /**
   * Execute database query with error handling and logging
   * @param {string} query - SQL query string
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async query(query, params = []) {
    const startTime = Date.now();
    
    try {
      const result = await this.db.query(query, params);
      const duration = Date.now() - startTime;
      
      logger.debug('Committee report query executed', {
        duration: `${duration}ms`,
        rows: result.rows.length
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Committee report query failed', {
        error: error.message,
        duration: `${duration}ms`,
        query: query.substring(0, 100) + '...'
      });
      throw error;
    }
  }

  /**
   * Get comprehensive committee report data by congress, report type, and number
   * @param {number} congress - Congress number
   * @param {string} reportType - Report type (HRPT, SRPT, etc.)  
   * @param {number} reportNumber - Report number
   * @returns {Object} Complete committee report data with associated bills
   */
  async getCommitteeReportWithFullData(congress, reportType, reportNumber) {
    const query = `
      SELECT 
        -- Core committee report data
        cr.report_id,
        cr.congress_id,
        cr.report_type,
        cr.report_type_display,
        cr.report_number,
        cr.citation,
        cr.part,
        cr.is_conference_report,
        cr.issue_date,
        cr.api_update_date,
        cr.chamber,
        cr.title,
        cr.session_number,
        cr.text_url,
        cr.text_count,
        cr.committees,
        
        -- Associated bills (JSON aggregation)
        COALESCE(
          json_agg(
            json_build_object(
              'congress', b.congress_id,
              'number', b.bill_number,
              'type', UPPER(b.bill_type::text),
              'url', CONCAT('https://api.congress.gov/v3/bill/', b.congress_id, '/', b.bill_type, '/', b.bill_number, '?format=json'),
              'title', b.title
            )
          ) FILTER (WHERE b.bill_id IS NOT NULL),
          '[]'::json
        ) as associated_bills
        
      FROM committee_report cr
      
      -- Left join with associated bills
      LEFT JOIN committee_report_bill crb ON cr.report_id = crb.report_id
      LEFT JOIN bill b ON crb.bill_id = b.bill_id
      
      WHERE cr.congress_id = $1 
        AND UPPER(cr.report_type) = UPPER($2)
        AND cr.report_number = $3
      
      GROUP BY 
        cr.report_id, cr.congress_id, cr.report_type, cr.report_type_display, cr.report_number,
        cr.citation, cr.part, cr.is_conference_report, cr.issue_date,
        cr.api_update_date, cr.chamber, cr.title, cr.session_number,
        cr.text_url, cr.text_count, cr.committees::text, cr.report_type_display
    `;

    try {
      const result = await this.query(query, [congress, reportType, reportNumber]);
      
      if (result.rows.length === 0) {
        logger.debug('Committee report not found', {
          congress,
          reportType,
          reportNumber
        });
        return null;
      }

      const reportData = result.rows[0];
      
      // Parse JSON fields
      if (reportData.committees && typeof reportData.committees === 'string') {
        reportData.committees = JSON.parse(reportData.committees);
      }
      if (reportData.associated_bills && typeof reportData.associated_bills === 'string') {
        reportData.associated_bills = JSON.parse(reportData.associated_bills);
      }

      logger.debug('Retrieved comprehensive committee report data', {
        congress,
        reportType,
        reportNumber,
        reportId: reportData.report_id,
        hasCommittees: Array.isArray(reportData.committees) && reportData.committees.length > 0,
        associatedBillsCount: Array.isArray(reportData.associated_bills) ? reportData.associated_bills.length : 0
      });

      return reportData;
      
    } catch (error) {
      logger.error('Failed to retrieve comprehensive committee report data', {
        congress,
        reportType,
        reportNumber,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get committee reports with pagination and optional filtering
   * @param {Object} options - Query options (limit, offset, search, includeBills, congress)
   * @returns {Object} Committee reports with pagination metadata
   */
  async getCommitteeReports(options = {}) {
    const {
      limit = 20,
      offset = 0,
      search = null,
      includeBills = false,
      congress = null
    } = options;

    // Build dynamic WHERE clause for search and congress filtering
    let whereClause = '1=1';
    const queryParams = [];
    let paramIndex = 1;

    if (congress) {
      whereClause += ` AND cr.congress_id = $${paramIndex}`;
      queryParams.push(congress);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (cr.title ILIKE $${paramIndex} OR cr.citation ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Add pagination parameters
    queryParams.push(limit, offset);
    const limitClause = `LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

    // Main query for committee reports
    let query;
    if (includeBills) {
      query = `
        SELECT 
          cr.report_id,
          cr.congress_id,
          cr.report_type,
          cr.report_type_display,
          cr.report_number,
          cr.citation,
          cr.part,
          cr.is_conference_report,
          cr.issue_date,
          cr.api_update_date,
          cr.chamber,
          cr.title,
          cr.session_number,
          cr.text_url,
          cr.text_count,
          cr.committees,
          
          -- Associated bills (JSON aggregation)
          COALESCE(
            json_agg(
              json_build_object(
                'congress', b.congress_id,
                'number', b.bill_number,
                'type', UPPER(b.bill_type::text),
                'url', CONCAT('https://api.congress.gov/v3/bill/', b.congress_id, '/', b.bill_type, '/', b.bill_number, '?format=json'),
                'title', b.title
              )
            ) FILTER (WHERE b.bill_id IS NOT NULL),
            '[]'::json
          ) as associated_bills
          
        FROM committee_report cr
        
        -- Left join with associated bills
        LEFT JOIN committee_report_bill crb ON cr.report_id = crb.report_id
        LEFT JOIN bill b ON crb.bill_id = b.bill_id
        
        WHERE ${whereClause}
        
        GROUP BY 
          cr.report_id, cr.congress_id, cr.report_type, cr.report_type_display, cr.report_number,
          cr.citation, cr.part, cr.is_conference_report, cr.issue_date,
          cr.api_update_date, cr.chamber, cr.title, cr.session_number,
          cr.text_url, cr.text_count, cr.committees::text
        
        ORDER BY cr.congress_id DESC, cr.issue_date DESC, cr.report_number DESC
        ${limitClause}
      `;
    } else {
      query = `
        SELECT 
          cr.report_id,
          cr.congress_id,
          cr.report_type,
          cr.report_type_display,
          cr.report_number,
          cr.citation,
          cr.part,
          cr.is_conference_report,
          cr.issue_date,
          cr.api_update_date,
          cr.chamber,
          cr.title,
          cr.session_number,
          cr.text_url,
          cr.text_count,
          cr.committees,
          
          -- Associated bills count for performance
          (
            SELECT COUNT(*)
            FROM committee_report_bill crb
            WHERE crb.report_id = cr.report_id
          ) as associated_bills_count
          
        FROM committee_report cr
        WHERE ${whereClause}
        ORDER BY cr.congress_id DESC, cr.issue_date DESC, cr.report_number DESC
        ${limitClause}
      `;
    }

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM committee_report cr
      WHERE ${whereClause}
    `;

    try {
      const [results, countResult] = await Promise.all([
        this.query(query, queryParams),
        this.query(countQuery, queryParams.slice(0, -2)) // Remove limit/offset for count
      ]);

      const total = parseInt(countResult.rows[0].total);
      
      // Parse JSON committees and bills fields for each report
      const reports = results.rows.map(report => {
        if (report.committees && typeof report.committees === 'string') {
          report.committees = JSON.parse(report.committees);
        }
        if (report.associated_bills && typeof report.associated_bills === 'string') {
          report.associated_bills = JSON.parse(report.associated_bills);
        }
        return report;
      });

      logger.debug('Committee reports search completed', {
        searchFilters: { congress, search },
        resultCount: reports.length,
        total,
        offset,
        limit,
        includeBills
      });

      // Format response in Congress API compatible format
      return this.formatCommitteeReportsResponse(reports, {
        offset,
        limit,
        total,
        count: reports.length,
        hasNext: offset + limit < total,
        hasPrevious: offset > 0
      }, { congress, search });

    } catch (error) {
      logger.error('Failed to get committee reports', {
        options,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get committee reports for a specific congress with pagination (backward compatibility)
   * @param {number} congress - Congress number
   * @param {Object} options - Query options (limit, offset, format)
   * @returns {Object} Committee reports with pagination metadata
   */
  async getCommitteeReportsOld(congress, options = {}) {
    const {
      limit = 20,
      offset = 0,
      format = 'json'
    } = options;

    // Main query for committee reports
    const query = `
      SELECT 
        cr.report_id,
        cr.congress_id,
        cr.report_type,
        cr.report_type_display,
        cr.report_number,
        cr.citation,
        cr.part,
        cr.is_conference_report,
        cr.issue_date,
        cr.api_update_date,
        cr.chamber,
        cr.title,
        cr.session_number,
        cr.text_url,
        cr.text_count,
        cr.committees,
        
        -- Associated bills count for performance
        (
          SELECT COUNT(*)
          FROM committee_report_bill crb
          WHERE crb.report_id = cr.report_id
        ) as associated_bills_count
        
      FROM committee_report cr
      WHERE cr.congress_id = $1
      ORDER BY cr.issue_date DESC, cr.report_number DESC
      LIMIT $2 OFFSET $3
    `;

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM committee_report cr
      WHERE cr.congress_id = $1
    `;

    try {
      const [results, countResult] = await Promise.all([
        this.query(query, [congress, limit, offset]),
        this.query(countQuery, [congress])
      ]);

      const total = parseInt(countResult.rows[0].total);
      
      // Parse JSON committees field for each report
      const reports = results.rows.map(report => {
        if (report.committees && typeof report.committees === 'string') {
          report.committees = JSON.parse(report.committees);
        }
        return report;
      });

      logger.debug('Committee reports search completed', {
        congress,
        resultCount: reports.length,
        total,
        offset,
        limit
      });

      return {
        committeeReports: reports,
        pagination: {
          offset,
          limit,
          total,
          count: reports.length,
          hasNext: offset + limit < total,
          hasPrevious: offset > 0
        },
        congress
      };

    } catch (error) {
      logger.error('Failed to search committee reports', {
        congress,
        options,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get all committee reports across all congresses with pagination
   * @param {Object} options - Query options (limit, offset, format, congress, chamber)
   * @returns {Object} Committee reports with pagination metadata
   */
  async getAllCommitteeReports(options = {}) {
    const {
      limit = 20,
      offset = 0,
      format = 'json',
      congress = null,
      chamber = null,
      reportType = null
    } = options;

    // Build dynamic WHERE clause
    let whereClause = '1=1';
    const queryParams = [];
    let paramIndex = 1;

    if (congress) {
      whereClause += ` AND cr.congress_id = $${paramIndex}`;
      queryParams.push(congress);
      paramIndex++;
    }

    if (chamber) {
      whereClause += ` AND LOWER(cr.chamber) = LOWER($${paramIndex})`;
      queryParams.push(chamber);
      paramIndex++;
    }

    if (reportType) {
      whereClause += ` AND UPPER(cr.report_type) = UPPER($${paramIndex})`;
      queryParams.push(reportType);
      paramIndex++;
    }

    // Add pagination parameters
    queryParams.push(limit, offset);
    const limitClause = `LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

    const query = `
      SELECT 
        cr.report_id,
        cr.congress_id,
        cr.report_type,
        cr.report_type_display,
        cr.report_number,
        cr.citation,
        cr.part,
        cr.is_conference_report,
        cr.issue_date,
        cr.api_update_date,
        cr.chamber,
        cr.title,
        cr.session_number,
        cr.text_url,
        cr.text_count,
        cr.committees,
        
        -- Associated bills count for performance
        (
          SELECT COUNT(*)
          FROM committee_report_bill crb
          WHERE crb.report_id = cr.report_id
        ) as associated_bills_count
        
      FROM committee_report cr
      WHERE ${whereClause}
      ORDER BY cr.congress_id DESC, cr.issue_date DESC, cr.report_number DESC
      ${limitClause}
    `;

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM committee_report cr
      WHERE ${whereClause}
    `;

    try {
      const [results, countResult] = await Promise.all([
        this.query(query, queryParams),
        this.query(countQuery, queryParams.slice(0, -2)) // Remove limit/offset for count
      ]);

      const total = parseInt(countResult.rows[0].total);
      
      // Parse JSON committees field for each report
      const reports = results.rows.map(report => {
        if (report.committees && typeof report.committees === 'string') {
          report.committees = JSON.parse(report.committees);
        }
        return report;
      });

      logger.debug('All committee reports search completed', {
        searchFilters: { congress, chamber, reportType },
        resultCount: reports.length,
        total,
        offset,
        limit
      });

      return {
        committeeReports: reports,
        pagination: {
          offset,
          limit,
          total,
          count: reports.length,
          hasNext: offset + limit < total,
          hasPrevious: offset > 0
        },
        filters: { congress, chamber, reportType }
      };

    } catch (error) {
      logger.error('Failed to get all committee reports', {
        options,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get associated bills for a specific committee report
   * @param {string} reportId - Committee report ID
   * @returns {Array} Associated bills array
   */
  async getAssociatedBills(reportId) {
    const query = `
      SELECT 
        b.congress_id,
        b.bill_type,
        b.bill_number,
        b.title,
        b.url,
        b.latest_action_text,
        b.latest_action_date
      FROM committee_report_bill crb
      JOIN bill b ON crb.bill_id = b.bill_id
      WHERE crb.report_id = $1
      ORDER BY b.congress_id DESC, b.bill_type, b.bill_number
    `;

    try {
      const result = await this.query(query, [reportId]);
      
      const bills = result.rows.map(bill => ({
        congress: bill.congress_id,
        number: bill.bill_number,
        type: bill.bill_type.toUpperCase(),
        url: `https://api.congress.gov/v3/bill/${bill.congress_id}/${bill.bill_type}/${bill.bill_number}?format=json`,
        title: bill.title,
        latestAction: bill.latest_action_text,
        latestActionDate: bill.latest_action_date
      }));

      logger.debug('Retrieved associated bills', {
        reportId,
        billCount: bills.length
      });

      return bills;

    } catch (error) {
      logger.error('Failed to get associated bills', {
        reportId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get committee reports for a specific congress with pagination and search
   * @param {number} congress - Congress number
   * @param {Object} options - Query options (limit, offset, search, includeBills)
   * @returns {Object} Committee reports with pagination metadata
   */
  async getCommitteeReportsByCongress(congress, options = {}) {
    // Use the main getCommitteeReports method with congress filter
    return this.getCommitteeReports({
      ...options,
      congress
    });
  }

  /**
   * Get specific committee report by congress, type, and number
   * @param {number} congress - Congress number
   * @param {string} reportType - Report type (HRPT, SRPT, CRPT)
   * @param {number} reportNumber - Report number
   * @param {Object} options - Query options (includeFullDetails)
   * @returns {Object} Committee report details or null if not found
   */
  async getCommitteeReportByIdentifier(congress, reportType, reportNumber, options = {}) {
    const { includeFullDetails = false } = options;

    const query = `
      SELECT 
        -- Core committee report data
        cr.report_id,
        cr.congress_id,
        cr.report_type,
        cr.report_type_display,
        cr.report_number,
        cr.citation,
        cr.part,
        cr.is_conference_report,
        cr.issue_date,
        cr.api_update_date,
        cr.chamber,
        cr.title,
        cr.session_number,
        cr.text_url,
        cr.text_count,
        cr.committees,
        
        -- Associated bills (JSON aggregation)
        COALESCE(
          json_agg(
            json_build_object(
              'congress', b.congress_id,
              'number', b.bill_number,
              'type', UPPER(b.bill_type::text),
              'url', CONCAT('https://api.congress.gov/v3/bill/', b.congress_id, '/', b.bill_type, '/', b.bill_number, '?format=json'),
              'title', b.title
            )
          ) FILTER (WHERE b.bill_id IS NOT NULL),
          '[]'::json
        ) as associated_bills
        
      FROM committee_report cr
      
      -- Left join with associated bills
      LEFT JOIN committee_report_bill crb ON cr.report_id = crb.report_id
      LEFT JOIN bill b ON crb.bill_id = b.bill_id
      
      WHERE cr.congress_id = $1 
        AND UPPER(cr.report_type) = UPPER($2)
        AND cr.report_number = $3
      
      GROUP BY 
        cr.report_id, cr.congress_id, cr.report_type, cr.report_type_display, cr.report_number,
        cr.citation, cr.part, cr.is_conference_report, cr.issue_date,
        cr.api_update_date, cr.chamber, cr.title, cr.session_number,
        cr.text_url, cr.text_count, cr.committees::text
    `;

    try {
      const result = await this.query(query, [congress, reportType, reportNumber]);
      
      if (result.rows.length === 0) {
        logger.debug('Committee report not found', {
          congress,
          reportType,
          reportNumber
        });
        return null;
      }

      const reportData = result.rows[0];
      
      // Parse JSON fields
      if (reportData.committees && typeof reportData.committees === 'string') {
        reportData.committees = JSON.parse(reportData.committees);
      }
      if (reportData.associated_bills && typeof reportData.associated_bills === 'string') {
        reportData.associated_bills = JSON.parse(reportData.associated_bills);
      }

      // Enrich committees with leadership info (Chair and Ranking Member)
      if (Array.isArray(reportData.committees) && reportData.committees.length > 0) {
        reportData.committees = await this.enrichCommitteesWithLeadership(
          reportData.committees,
          reportData.congress_id
        );
      }

      logger.debug('Retrieved specific committee report', {
        congress,
        reportType,
        reportNumber,
        reportId: reportData.report_id,
        hasCommittees: Array.isArray(reportData.committees) && reportData.committees.length > 0,
        associatedBillsCount: Array.isArray(reportData.associated_bills) ? reportData.associated_bills.length : 0
      });

      // Format response in Congress API compatible format
      return this.formatSingleCommitteeReportResponse(reportData, {
        congress,
        reportType,
        number: reportNumber
      });
      
    } catch (error) {
      logger.error('Failed to retrieve specific committee report', {
        congress,
        reportType,
        reportNumber,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Enrich committees with leadership information (Chair and Ranking Member)
   * @param {Array} committees - Array of committee objects with systemCode
   * @param {number} congressId - Congress number for membership lookup
   * @returns {Promise<Array>} Committees enriched with leadership info
   */
  async enrichCommitteesWithLeadership(committees, congressId) {
    if (!Array.isArray(committees) || committees.length === 0) {
      return committees;
    }

    const enrichedCommittees = [];

    for (const committee of committees) {
      const systemCode = committee.systemCode || committee.system_code;
      if (!systemCode) {
        enrichedCommittees.push(committee);
        continue;
      }

      try {
        // Query for Chair and Ranking Member with state
        const leadershipQuery = `
          SELECT
            mc.title,
            m.direct_order_name as name,
            mc.member_bioguide_id as bioguide_id,
            mt.state_code as state
          FROM member_committee mc
          JOIN member m ON mc.member_bioguide_id = m.bioguide_id
          LEFT JOIN member_term mt ON mc.member_bioguide_id = mt.member_bioguide_id
            AND mt.congress = mc.congress_id
          WHERE mc.committee_system_code = $1
            AND mc.congress_id = $2
            AND mc.title IN ('Chair', 'Ranking Member')
          ORDER BY mc.title
        `;

        const result = await this.query(leadershipQuery, [systemCode, congressId]);

        let chair = null;
        let rankingMember = null;

        for (const row of result.rows) {
          const leaderInfo = {
            name: row.name,
            bioguideId: row.bioguide_id,
            state: row.state || null
          };

          if (row.title === 'Chair') {
            chair = leaderInfo;
          } else if (row.title === 'Ranking Member') {
            rankingMember = leaderInfo;
          }
        }

        enrichedCommittees.push({
          ...committee,
          chair,
          rankingMember
        });

      } catch (error) {
        logger.warn('Failed to fetch leadership for committee', {
          systemCode,
          congressId,
          error: error.message
        });
        enrichedCommittees.push(committee);
      }
    }

    return enrichedCommittees;
  }

  /**
   * Format committee report data for Congress API response
   * @param {Object} reportData - Raw database committee report data
   * @returns {Object} Congress API formatted committee report
   */
  formatCommitteeReportForAPI(reportData) {
    if (!reportData) {
      return null;
    }

    try {
      const formattedReport = {
        // Associated bills array (if available)
        associatedBill: Array.isArray(reportData.associated_bills) ? 
          reportData.associated_bills.map(bill => ({
            congress: bill.congress,
            number: bill.number?.toString(),
            type: bill.type,
            url: bill.url
          })) : [],

        // Chamber information
        chamber: reportData.chamber || null,
        
        // Citation
        citation: reportData.citation || null,
        
        // Committees array from JSONB field (with leadership if available)
        committees: Array.isArray(reportData.committees) ?
          reportData.committees.map(committee => ({
            name: committee.name,
            systemCode: committee.systemCode || committee.system_code,
            url: committee.url,
            chair: committee.chair || null,
            rankingMember: committee.rankingMember || null
          })) : [],

        // Congress number
        congress: parseInt(reportData.congress_id),

        // Conference report flag
        isConferenceReport: reportData.is_conference_report || false,

        // Issue date (ISO format)
        issueDate: reportData.issue_date ? 
          new Date(reportData.issue_date).toISOString() : null,

        // Report number
        number: parseInt(reportData.report_number),

        // Part number
        part: reportData.part || null,

        // Report type - use the display format from database
        reportType: reportData.report_type_display || null,

        // Session number  
        sessionNumber: reportData.session_number || null,

        // Text information
        text: {
          count: reportData.text_count || 0,
          url: reportData.text_url || null
        },

        // Title
        title: reportData.title || null,

        // Type (report type code)
        type: reportData.report_type || null,

        // Update date (ISO format)
        updateDate: reportData.api_update_date ? 
          new Date(reportData.api_update_date).toISOString() : null
      };

      return formattedReport;

    } catch (error) {
      logger.error('Error formatting committee report for API', {
        error: error.message,
        reportId: reportData.report_id || 'unknown',
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Format paginated committee reports response for Congress API
   * @param {Array} reports - Array of committee report data
   * @param {Object} pagination - Pagination metadata
   * @param {Object} requestContext - Request context for metadata
   * @returns {Object} Congress API formatted response
   */
  formatCommitteeReportsResponse(reports, pagination, requestContext = {}) {
    try {
      const formattedReports = reports.map(report => 
        this.formatCommitteeReportForAPI(report)
      );

      const response = {
        reports: formattedReports,
        pagination: {
          count: formattedReports.length,
          next: pagination.hasNext ? 
            `${requestContext.baseUrl || ''}?limit=${pagination.limit}&offset=${pagination.offset + pagination.limit}` : 
            null,
          previous: pagination.hasPrevious ? 
            `${requestContext.baseUrl || ''}?limit=${pagination.limit}&offset=${Math.max(0, pagination.offset - pagination.limit)}` : 
            null
        },
        request: {
          congress: requestContext.congress || null,
          contentType: "application/json",
          format: "json",
          ...requestContext.additionalMetadata
        }
      };

      return response;

    } catch (error) {
      logger.error('Error formatting committee reports response', {
        error: error.message,
        reportsCount: reports?.length || 0,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Format single committee report response for Congress API
   * @param {Object} reportData - Committee report data with full details
   * @param {Object} requestContext - Request context for metadata
   * @returns {Object} Congress API formatted response
   */
  formatSingleCommitteeReportResponse(reportData, requestContext = {}) {
    try {
      const formattedReport = this.formatCommitteeReportForAPI(reportData);

      const response = {
        reports: [formattedReport],
        request: {
          congress: requestContext.congress || reportData.congress_id,
          number: requestContext.number || reportData.report_number,
          reportType: requestContext.reportType || reportData.report_type,
          contentType: "application/json",
          format: "json"
        }
      };

      return response;

    } catch (error) {
      logger.error('Error formatting single committee report response', {
        error: error.message,
        reportId: reportData?.report_id || 'unknown',
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get committee report text versions by congress, report type, and number
   * @param {number} congress - Congress number
   * @param {string} reportType - Report type (hrpt, srpt, erpt)
   * @param {number} reportNumber - Report number
   * @returns {Object} Text versions formatted response or null if not found
   */
  async getCommitteeReportText(congress, reportType, reportNumber) {
    const query = `
      SELECT 
        cr.report_id,
        cr.congress_id,
        cr.report_type,
        cr.report_type_display,
        cr.report_number,
        cr.citation,
        cr.issue_date,
        cr.text_url,
        cr.text_count,
        cr.title
      FROM committee_report cr
      WHERE cr.congress_id = $1 
        AND UPPER(cr.report_type) = UPPER($2)
        AND cr.report_number = $3
    `;

    try {
      const result = await this.query(query, [congress, reportType, reportNumber]);
      
      if (result.rows.length === 0) {
        logger.debug('Committee report not found for text endpoint', {
          congress,
          reportType,
          reportNumber
        });
        return null;
      }

      const reportData = result.rows[0];

      // If no text versions are available, return empty array
      if (!reportData.text_count || reportData.text_count === 0) {
        return { textVersions: [] };
      }

      // Fetch text data from Congress API if text_url is available
      if (reportData.text_url) {
        try {
          const response = await fetch(reportData.text_url);
          if (!response.ok) {
            throw new Error(`Congress API returned ${response.status}: ${response.statusText}`);
          }
          
          const textData = await response.json();
          
          // Transform Congress API response to match bill text format
          const textVersions = [];
          
          if (textData.text && Array.isArray(textData.text)) {
            // Each text entry becomes a text version
            textData.text.forEach((textEntry, index) => {
              if (textEntry.formats && Array.isArray(textEntry.formats)) {
                textVersions.push({
                  date: reportData.issue_date ? new Date(reportData.issue_date).toISOString().split('T')[0] : null,
                  type: index === 0 ? "Committee Report" : `Committee Report (Version ${index + 1})`,
                  formats: textEntry.formats.map(format => ({
                    type: format.type,
                    url: format.url
                  }))
                });
              }
            });
          }
          
          return { textVersions };
          
        } catch (apiError) {
          logger.error('Failed to fetch committee report text from Congress API', {
            congress,
            reportType,
            reportNumber,
            textUrl: reportData.text_url,
            error: apiError.message
          });
          
          // Fall back to placeholder structure if API call fails
          const textVersions = [{
            date: reportData.issue_date ? new Date(reportData.issue_date).toISOString().split('T')[0] : null,
            type: "Committee Report",
            formats: [
              {
                type: "PDF",
                url: `https://www.congress.gov/${congress}/crpt/${reportType}${reportNumber}/CRPT-${congress}${reportType}${reportNumber}.pdf`
              },
              {
                type: "Formatted Text", 
                url: `https://www.congress.gov/${congress}/crpt/${reportType}${reportNumber}/generated/CRPT-${congress}${reportType}${reportNumber}.htm`
              }
            ]
          }];
          
          return { textVersions };
        }
      }

      // Fallback if no text_url - create placeholder structure
      const textVersions = [{
        date: reportData.issue_date ? new Date(reportData.issue_date).toISOString().split('T')[0] : null,
        type: "Committee Report",
        formats: []
      }];

      return { textVersions };

    } catch (error) {
      logger.error('Database error in getCommitteeReportText', {
        congress,
        reportType,
        reportNumber,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get committee report statistics for congress
   * @param {number} congress - Congress number
   * @returns {Object} Statistics summary
   */
  async getCommitteeReportStats(congress) {
    const query = `
      SELECT 
        COUNT(*) as total_reports,
        COUNT(DISTINCT cr.chamber) as chambers_count,
        COUNT(DISTINCT cr.report_type) as report_types_count,
        COUNT(CASE WHEN cr.is_conference_report = true THEN 1 END) as conference_reports,
        MIN(cr.issue_date) as earliest_date,
        MAX(cr.issue_date) as latest_date,
        AVG(cr.text_count) as avg_text_count
      FROM committee_report cr
      WHERE cr.congress_id = $1
    `;

    try {
      const result = await this.query(query, [congress]);
      
      return {
        congress,
        statistics: result.rows[0],
        generated: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to get committee report statistics', {
        congress,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Test database connection
   * @returns {Promise<boolean>} Connection test result
   */
  async testConnection() {
    try {
      await this.query('SELECT 1 as test');
      return true;
    } catch (error) {
      logger.error('Database connection test failed', { error: error.message });
      return false;
    }
  }

  /**
   * Close database connection if managed by this service
   */
  async close() {
    if (this.shouldCloseDb && this.db) {
      try {
        await this.db.end();
        logger.info('CommitteeReportService database connection closed');
      } catch (error) {
        logger.error('Error closing CommitteeReportService database connection', {
          error: error.message
        });
      }
    }
  }
}

module.exports = { CommitteeReportService };