const { DatabaseService } = require('./database');
const { CongressAPIFormatter } = require('./congress-api-formatter');
const { logger } = require('../logger');

/**
 * Member Database Service
 * 
 * Handles all database operations related to members including:
 * - Comprehensive member queries with related data
 * - Address information
 * - Party history
 * - Previous names
 * - Legislation statistics
 * - Term information
 * 
 * Optimized for Congress API response structure
 */
class MemberService {
  constructor(database = null) {
    this.db = database || new DatabaseService();
  }

  /**
   * Get comprehensive member data by bioguide ID
   * Joins all related tables to provide complete API response data
   * @param {string} bioguideId - Member's bioguide ID
   * @returns {Object} Complete member data with all related information
   */
  async getMemberWithFullData(bioguideId) {
    const query = `
      SELECT 
        -- Core member data
        m.bioguide_id,
        m.first_name,
        m.last_name,
        m.middle_name,
        m.suffix_name,
        m.nickname,
        m.direct_order_name,
        m.inverted_order_name,
        m.honorific_name,
        m.birth_year,
        m.death_year,
        m.current_member,
        m.depiction_url,
        m.depiction_attribution,
        m.official_url,
        m.api_update_date,
        
        -- Address information (JSON object)
        CASE 
          WHEN ma.member_bioguide_id IS NOT NULL THEN
            json_build_object(
              'city', ma.city,
              'district', ma.district,
              'zipCode', ma.zip_code
            )
          ELSE NULL
        END as address_information,
        
        -- Individual address fields for backward compatibility
        ma.city as address_city,
        ma.district as address_district,
        ma.zip_code as address_zip_code,
        
        -- State information from most recent term
        mt_current.state_name,
        mt_current.state_code,
        
        -- Legislation statistics from most recent congress
        mls.sponsored_legislation_count,
        mls.cosponsored_legislation_count,
        mls.sponsored_legislation_url,
        mls.cosponsored_legislation_url,
        
        -- Party history (JSON array)
        COALESCE(
          json_agg(
            jsonb_build_object(
              'party_abbreviation', mph.party_abbreviation,
              'party_name', mph.party_name,
              'start_year', mph.start_year,
              'end_year', mph.end_year
            )
          ) FILTER (WHERE mph.party_history_id IS NOT NULL),
          '[]'::json
        ) as party_history,
        
        -- Previous names (JSON array)
        COALESCE(
          json_agg(
            jsonb_build_object(
              'first_name', mpn.first_name,
              'last_name', mpn.last_name,
              'middle_name', mpn.middle_name,
              'suffix_name', mpn.suffix_name,
              'nickname', mpn.nickname,
              'direct_order_name', mpn.direct_order_name,
              'inverted_order_name', mpn.inverted_order_name,
              'start_date', mpn.start_date,
              'end_date', mpn.end_date,
              'name_type', mpn.name_type
            )
          ) FILTER (WHERE mpn.previous_name_id IS NOT NULL),
          '[]'::json
        ) as previous_names,
        
        -- Terms (JSON array)
        COALESCE(
          json_agg(
            jsonb_build_object(
              'congress', mt.congress,
              'chamber', mt.chamber,
              'member_type', mt.member_type,
              'start_year', mt.start_year,
              'end_year', mt.end_year,
              'state_code', mt.state_code,
              'state_name', COALESCE(s.state_name, mt.state_name),
              'party_code', mt.party_code,
              'party_name', mt.party_name,
              'district', mt.district
            )
          ) FILTER (WHERE mt.term_id IS NOT NULL),
          '[]'::json
        ) as terms
        
      FROM member m
      
      -- Current address
      LEFT JOIN member_address ma ON m.bioguide_id = ma.member_bioguide_id 
        AND ma.is_active = TRUE 
        AND ma.address_type = 'current'
      
      -- Most recent term for state information
      LEFT JOIN LATERAL (
        SELECT mt_inner.state_name, mt_inner.state_code
        FROM member_term mt_inner
        WHERE mt_inner.member_bioguide_id = m.bioguide_id
        ORDER BY mt_inner.congress DESC, mt_inner.start_year DESC
        LIMIT 1
      ) mt_current ON true
      
      -- Most recent legislation statistics
      LEFT JOIN LATERAL (
        SELECT * FROM member_legislation_stats mls_inner
        WHERE mls_inner.member_bioguide_id = m.bioguide_id
        ORDER BY mls_inner.congress DESC
        LIMIT 1
      ) mls ON true
      
      -- Party history
      LEFT JOIN member_party_history mph ON m.bioguide_id = mph.member_bioguide_id
      
      -- Previous names
      LEFT JOIN member_previous_names mpn ON m.bioguide_id = mpn.member_bioguide_id
      
      -- All terms
      LEFT JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
      LEFT JOIN states s ON mt.state_code = s.state_code
      
      WHERE m.bioguide_id = $1
      GROUP BY 
        m.bioguide_id, ma.member_bioguide_id, ma.city, ma.district, ma.zip_code,
        mt_current.state_name, mt_current.state_code,
        mls.sponsored_legislation_count, mls.cosponsored_legislation_count,
        mls.sponsored_legislation_url, mls.cosponsored_legislation_url
    `;

    try {
      const result = await this.db.query(query, [bioguideId.toUpperCase()]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const memberData = result.rows[0];
      
      // Parse JSON fields back to JavaScript objects/arrays
      if (memberData.party_history && typeof memberData.party_history === 'string') {
        memberData.party_history = JSON.parse(memberData.party_history);
      }
      if (memberData.previous_names && typeof memberData.previous_names === 'string') {
        memberData.previous_names = JSON.parse(memberData.previous_names);
      }
      if (memberData.terms && typeof memberData.terms === 'string') {
        memberData.terms = JSON.parse(memberData.terms);
      }

      logger.debug('Retrieved comprehensive member data', {
        bioguideId,
        hasAddress: !!memberData.address_information,
        partyHistoryCount: Array.isArray(memberData.party_history) ? memberData.party_history.length : 0,
        previousNamesCount: Array.isArray(memberData.previous_names) ? memberData.previous_names.length : 0,
        termsCount: Array.isArray(memberData.terms) ? memberData.terms.length : 0
      });

      return memberData;
      
    } catch (error) {
      logger.error('Failed to retrieve comprehensive member data', {
        bioguideId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get member data formatted for Congress API response
   * @param {string} bioguideId - Member's bioguide ID
   * @returns {Object} Congress API formatted response
   */
  async getMemberForAPI(bioguideId) {
    try {
      const memberData = await this.getMemberWithFullData(bioguideId);
      
      if (!memberData) {
        return null;
      }

      return CongressAPIFormatter.formatMember(memberData);
      
    } catch (error) {
      logger.error('Failed to get member for API', {
        bioguideId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Search members with comprehensive data
   * @param {Object} searchCriteria - Search parameters
   * @param {Object} pagination - Pagination parameters
   * @returns {Object} Search results with pagination
   */
  async searchMembers(searchCriteria = {}, pagination = {}) {
    const {
      state,
      party,
      chamber,
      currentMember,
      birthYear,
      congress
    } = searchCriteria;

    const {
      limit = 20,
      offset = 0
    } = pagination;

    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramIndex = 1;

    // Build WHERE clause dynamically
    if (state) {
      whereClause += ` AND (mt_current.state_code = $${paramIndex} OR mt_current.state_name ILIKE $${paramIndex + 1})`;
      queryParams.push(state.toUpperCase(), `%${state}%`);
      paramIndex += 2;
    }

    if (party) {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM member_party_history mph_search 
        WHERE mph_search.member_bioguide_id = m.bioguide_id 
        AND (mph_search.party_abbreviation ILIKE $${paramIndex} OR mph_search.party_name ILIKE $${paramIndex + 1})
      )`;
      queryParams.push(`%${party}%`, `%${party}%`);
      paramIndex += 2;
    }

    if (chamber) {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM member_term mt_search 
        WHERE mt_search.member_bioguide_id = m.bioguide_id 
        AND mt_search.chamber = $${paramIndex}
      )`;
      queryParams.push(chamber);
      paramIndex++;
    }

    if (typeof currentMember === 'boolean') {
      whereClause += ` AND m.current_member = $${paramIndex}`;
      queryParams.push(currentMember);
      paramIndex++;
    }

    if (birthYear) {
      whereClause += ` AND m.birth_year = $${paramIndex}`;
      queryParams.push(parseInt(birthYear));
      paramIndex++;
    }

    if (congress) {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM member_term mt_congress 
        WHERE mt_congress.member_bioguide_id = m.bioguide_id 
        AND mt_congress.congress = $${paramIndex}
      )`;
      queryParams.push(parseInt(congress));
      paramIndex++;
    }

    // Add pagination parameters
    queryParams.push(limit, offset);
    const limitClause = `LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

    const query = `
      SELECT 
        m.bioguide_id,
        m.first_name,
        m.last_name,
        m.direct_order_name,
        m.honorific_name,
        m.current_member,
        mt_current.state_name,
        mt_current.state_code,
        -- Get current party from most recent party history
        mph_current.party_abbreviation as current_party_code,
        mph_current.party_name as current_party_name,
        m.updated_at
      FROM member m
      
      LEFT JOIN LATERAL (
        SELECT mt_inner.state_name, mt_inner.state_code
        FROM member_term mt_inner
        WHERE mt_inner.member_bioguide_id = m.bioguide_id
        ORDER BY mt_inner.congress DESC, mt_inner.start_year DESC
        LIMIT 1
      ) mt_current ON true
      
      LEFT JOIN LATERAL (
        SELECT mph_inner.party_abbreviation, mph_inner.party_name
        FROM member_party_history mph_inner
        WHERE mph_inner.member_bioguide_id = m.bioguide_id
        ORDER BY mph_inner.start_year DESC
        LIMIT 1
      ) mph_current ON true
      
      ${whereClause}
      ORDER BY m.last_name, m.first_name
      ${limitClause}
    `;

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM member m
      LEFT JOIN LATERAL (
        SELECT mt_inner.state_name, mt_inner.state_code
        FROM member_term mt_inner
        WHERE mt_inner.member_bioguide_id = m.bioguide_id
        ORDER BY mt_inner.congress DESC, mt_inner.start_year DESC
        LIMIT 1
      ) mt_current ON true
      ${whereClause}
    `;

    try {
      const [results, countResult] = await Promise.all([
        this.db.query(query, queryParams),
        this.db.query(countQuery, queryParams.slice(0, -2)) // Remove limit/offset for count
      ]);

      const total = parseInt(countResult.rows[0].total);

      logger.debug('Member search completed', {
        searchCriteria,
        resultCount: results.rows.length,
        total,
        offset,
        limit
      });

      return {
        members: results.rows,
        pagination: {
          offset,
          limit,
          total,
          hasNext: offset + limit < total,
          hasPrevious: offset > 0
        }
      };

    } catch (error) {
      logger.error('Failed to search members', {
        searchCriteria,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get current members for a specific state
   * @param {string} stateCode - Two letter state code
   * @returns {Array} Array of current members for the state
   */
  async getCurrentMembersByState(stateCode) {
    const query = `
      SELECT DISTINCT m.bioguide_id, m.first_name, m.last_name, m.direct_order_name
      FROM member m
      INNER JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
      WHERE m.current_member = true
        AND mt.state_code = $1
        AND (mt.end_year IS NULL OR mt.end_year >= EXTRACT(YEAR FROM CURRENT_DATE))
      ORDER BY m.last_name, m.first_name
    `;

    try {
      const result = await this.db.query(query, [stateCode.toUpperCase()]);
      
      logger.debug('Retrieved current members by state', {
        stateCode,
        count: result.rows.length
      });

      return result.rows;
      
    } catch (error) {
      logger.error('Failed to get current members by state', {
        stateCode,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get member legislation statistics
   * @param {string} bioguideId - Member's bioguide ID
   * @param {number} congress - Congress number (optional, defaults to most recent)
   * @returns {Object} Legislation statistics
   */
  async getMemberLegislationStats(bioguideId, congress = null) {
    let query;
    let queryParams;

    if (congress) {
      query = `
        SELECT * FROM member_legislation_stats
        WHERE member_bioguide_id = $1 AND congress = $2
      `;
      queryParams = [bioguideId.toUpperCase(), congress];
    } else {
      query = `
        SELECT * FROM member_legislation_stats
        WHERE member_bioguide_id = $1
        ORDER BY congress DESC
        LIMIT 1
      `;
      queryParams = [bioguideId.toUpperCase()];
    }

    try {
      const result = await this.db.query(query, queryParams);
      
      return result.rows.length > 0 ? result.rows[0] : null;
      
    } catch (error) {
      logger.error('Failed to get member legislation stats', {
        bioguideId,
        congress,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get current representatives for a location (state + optional district)
   * Returns House rep for the district plus both Senators
   * @param {string} stateCode - Two letter state code
   * @param {number|null} district - Congressional district number (for House rep)
   * @param {number} congress - Congress number (defaults to 119)
   * @returns {Array} Array of representatives (up to 3: 1 House + 2 Senate)
   */
  async getRepresentativesByLocation(stateCode, district = null, congress = 119) {
    const query = `
      SELECT
        m.bioguide_id,
        m.first_name,
        m.last_name,
        m.middle_name,
        m.direct_order_name,
        m.inverted_order_name,
        m.honorific_name,
        m.current_member,
        m.depiction_url,
        m.official_url,
        mt.chamber,
        mt.district,
        mt.state_code,
        mt.state_name,
        mt.party_code,
        mt.party_name
      FROM member m
      INNER JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
      WHERE mt.congress = $1
        AND mt.state_code = $2
        AND (
          -- Senate: all senators from the state
          mt.chamber = 'Senate'
          OR
          -- House: match specific district (or all if no district specified)
          (mt.chamber = 'House' AND ($3::int IS NULL OR mt.district = $3))
        )
      ORDER BY
        CASE mt.chamber WHEN 'Senate' THEN 1 ELSE 2 END,
        m.last_name, m.first_name
    `;

    try {
      const result = await this.db.query(query, [congress, stateCode.toUpperCase(), district]);

      logger.debug('Retrieved representatives by location', {
        stateCode,
        district,
        congress,
        count: result.rows.length
      });

      return result.rows;

    } catch (error) {
      logger.error('Failed to get representatives by location', {
        stateCode,
        district,
        congress,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.db) {
      await this.db.close();
    }
  }
}

module.exports = { MemberService };