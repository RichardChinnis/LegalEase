const { Pool } = require('pg');
const { logger } = require('../logger');

/**
 * Hearing Database Service
 * Provides database operations for hearing endpoints
 */
class HearingService {
  constructor() {
    if (!process.env.DB_PASSWORD) {
      throw new Error('DB_PASSWORD environment variable is required');
    }
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_DATABASE || 'congress_api',
      user: process.env.DB_USER || 'congress_admin',
      password: process.env.DB_PASSWORD
    });
  }

  /**
   * Get a list of hearings with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated hearing results
   */
  async getHearings(options = {}) {
    const { 
      limit = 20, 
      offset = 0, 
      congress = null, 
      chamber = null,
      sort = 'api_update_date DESC NULLS LAST'
    } = options;

    try {
      // Build WHERE clause
      const whereConditions = [];
      const queryParams = [];
      let paramCount = 0;

      if (congress) {
        paramCount++;
        whereConditions.push(`h.congress_id = $${paramCount}`);
        queryParams.push(parseInt(congress));
      }

      if (chamber && chamber !== 'all') {
        paramCount++;
        whereConditions.push(`h.chamber = $${paramCount}`);
        queryParams.push(chamber);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Get total count
      const countQuery = `
        SELECT COUNT(*) 
        FROM hearing h
        ${whereClause}
      `;
      const countResult = await this.pool.query(countQuery, queryParams);
      const totalCount = parseInt(countResult.rows[0].count);

      // Get paginated results
      paramCount++;
      const limitParam = paramCount;
      paramCount++;
      const offsetParam = paramCount;
      queryParams.push(limit, offset);

      const query = `
        SELECT 
          h.jacket_number,
          h.congress_id,
          h.chamber,
          h.number,
          h.part,
          h.title,
          h.citation,
          h.library_of_congress_identifier,
          h.api_update_date,
          h.created_at,
          h.updated_at
        FROM hearing h
        ${whereClause}
        ORDER BY ${sort}
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `;

      const result = await this.pool.query(query, queryParams);
      
      // Transform results to match Congress API format
      const hearings = result.rows.map(row => ({
        jacketNumber: parseInt(row.jacket_number),
        congress: row.congress_id,
        chamber: row.chamber,
        number: row.number,
        part: row.part,
        title: row.title,
        citation: row.citation,
        libraryOfCongressIdentifier: row.library_of_congress_identifier,
        updateDate: row.api_update_date ? row.api_update_date.toISOString() : null,
        url: `https://api.congress.gov/v3/hearing/${row.congress_id}/${row.chamber.toLowerCase()}/${row.jacket_number}`
      }));

      return {
        hearings,
        pagination: {
          count: totalCount,
          offset: offset,
          limit: limit
        },
        request: {
          congress: congress || 'all',
          chamber: chamber || 'all',
          contentType: 'application/json',
          format: 'json'
        }
      };

    } catch (error) {
      logger.error('Error in HearingService.getHearings:', error);
      throw error;
    }
  }

  /**
   * Get a specific hearing by jacket number with all related data
   * @param {number} congress - Congress number
   * @param {string} chamber - Chamber (house/senate)
   * @param {string} jacketNumber - Hearing jacket number
   * @returns {Promise<Object>} Complete hearing data
   */
  async getHearingDetails(congress, chamber, jacketNumber) {
    try {
      // Get main hearing record (including hearing_id for child table lookups)
      const hearingQuery = `
        SELECT
          hearing_id,
          jacket_number,
          congress_id,
          chamber,
          number,
          part,
          title,
          citation,
          library_of_congress_identifier,
          api_update_date,
          created_at,
          updated_at
        FROM hearing
        WHERE jacket_number = $1 AND congress_id = $2 AND chamber = $3
      `;

      const hearingResult = await this.pool.query(hearingQuery, [jacketNumber, parseInt(congress), chamber]);

      if (hearingResult.rows.length === 0) {
        return null;
      }

      const hearing = hearingResult.rows[0];
      const hearingId = hearing.hearing_id;

      // Get related data in parallel using hearing_id (updated schema)
      const congressId = hearing.congress_id;
      const [committeesResult, datesResult, formatsResult, meetingsResult] = await Promise.all([
        // Get committees with type and leadership from committee and member_committee tables
        this.pool.query(`
          SELECT
            hc.committee_name,
            hc.committee_system_code,
            hc.committee_api_url,
            c.committee_type_code,
            c.chamber as committee_chamber,
            -- Chair info
            (SELECT m.direct_order_name
             FROM member_committee mc
             JOIN member m ON mc.member_bioguide_id = m.bioguide_id
             WHERE mc.committee_system_code = hc.committee_system_code
               AND mc.congress_id = $2
               AND mc.title = 'Chair'
             LIMIT 1) as chair_name,
            (SELECT mc.member_bioguide_id
             FROM member_committee mc
             WHERE mc.committee_system_code = hc.committee_system_code
               AND mc.congress_id = $2
               AND mc.title = 'Chair'
             LIMIT 1) as chair_bioguide_id,
            (SELECT mt.state_code
             FROM member_committee mc
             JOIN member_term mt ON mc.member_bioguide_id = mt.member_bioguide_id
               AND mt.congress = mc.congress_id
             WHERE mc.committee_system_code = hc.committee_system_code
               AND mc.congress_id = $2
               AND mc.title = 'Chair'
             LIMIT 1) as chair_state,
            -- Ranking Member info
            (SELECT m.direct_order_name
             FROM member_committee mc
             JOIN member m ON mc.member_bioguide_id = m.bioguide_id
             WHERE mc.committee_system_code = hc.committee_system_code
               AND mc.congress_id = $2
               AND mc.title = 'Ranking Member'
             LIMIT 1) as ranking_member_name,
            (SELECT mc.member_bioguide_id
             FROM member_committee mc
             WHERE mc.committee_system_code = hc.committee_system_code
               AND mc.congress_id = $2
               AND mc.title = 'Ranking Member'
             LIMIT 1) as ranking_member_bioguide_id,
            (SELECT mt.state_code
             FROM member_committee mc
             JOIN member_term mt ON mc.member_bioguide_id = mt.member_bioguide_id
               AND mt.congress = mc.congress_id
             WHERE mc.committee_system_code = hc.committee_system_code
               AND mc.congress_id = $2
               AND mc.title = 'Ranking Member'
             LIMIT 1) as ranking_member_state
          FROM hearing_committee hc
          LEFT JOIN committee c ON hc.committee_system_code = c.system_code
          WHERE hc.hearing_id = $1
          ORDER BY hc.committee_name
        `, [hearingId, congressId]),

        // Get dates
        this.pool.query(`
          SELECT date
          FROM hearing_date
          WHERE hearing_id = $1
          ORDER BY date
        `, [hearingId]),

        // Get formats
        this.pool.query(`
          SELECT
            format_type,
            format_url,
            file_size_bytes
          FROM hearing_format
          WHERE hearing_id = $1
          ORDER BY format_type
        `, [hearingId]),

        // Get meetings
        this.pool.query(`
          SELECT
            meeting_event_id,
            meeting_api_url,
            relationship_type
          FROM hearing_meeting
          WHERE hearing_id = $1
        `, [hearingId])
      ]);

      // Transform to Congress API format
      const hearingData = {
        jacketNumber: parseInt(hearing.jacket_number),
        congress: hearing.congress_id,
        chamber: hearing.chamber,
        number: hearing.number,
        part: hearing.part,
        title: hearing.title,
        citation: hearing.citation,
        libraryOfCongressIdentifier: hearing.library_of_congress_identifier,
        updateDate: hearing.api_update_date ? hearing.api_update_date.toISOString() : null,
        
        // Committees (with type and leadership from joined tables)
        committees: committeesResult.rows.map(row => ({
          name: row.committee_name,
          systemCode: row.committee_system_code,
          url: row.committee_api_url,
          type: row.committee_type_code || null,
          chamber: row.committee_chamber || null,
          chair: row.chair_name ? {
            name: row.chair_name,
            bioguideId: row.chair_bioguide_id,
            state: row.chair_state || null
          } : null,
          rankingMember: row.ranking_member_name ? {
            name: row.ranking_member_name,
            bioguideId: row.ranking_member_bioguide_id,
            state: row.ranking_member_state || null
          } : null
        })),

        // Dates
        dates: datesResult.rows.map(row => ({
          date: row.date
        })),

        // Formats
        formats: formatsResult.rows.map(row => ({
          type: row.format_type,
          url: row.format_url,
          fileSizeBytes: row.file_size_bytes
        }))
      };

      // Add associated meeting if exists
      if (meetingsResult.rows.length > 0) {
        const meeting = meetingsResult.rows[0];
        hearingData.associatedMeeting = {
          eventId: meeting.meeting_event_id,
          url: meeting.meeting_api_url,
          relationshipType: meeting.relationship_type
        };
      }

      return {
        hearing: hearingData,
        request: {
          congress: congress.toString(),
          chamber: chamber.toLowerCase(),
          jacketNumber: jacketNumber.toString(),
          contentType: 'application/json',
          format: 'json'
        }
      };

    } catch (error) {
      logger.error('Error in HearingService.getHearingDetails:', error);
      throw error;
    }
  }

  /**
   * Get hearings count by chamber for a specific congress
   * @param {number} congress - Congress number
   * @returns {Promise<Object>} Hearing counts by chamber
   */
  async getHearingCounts(congress = null) {
    try {
      let query;
      let params = [];

      if (congress) {
        query = `
          SELECT 
            chamber,
            COUNT(*) as count
          FROM hearing 
          WHERE congress_id = $1
          GROUP BY chamber
          ORDER BY chamber
        `;
        params = [parseInt(congress)];
      } else {
        query = `
          SELECT 
            congress_id,
            chamber,
            COUNT(*) as count
          FROM hearing 
          GROUP BY congress_id, chamber
          ORDER BY congress_id DESC, chamber
        `;
      }

      const result = await this.pool.query(query, params);
      
      return {
        counts: result.rows.map(row => ({
          congress: row.congress_id || parseInt(congress),
          chamber: row.chamber,
          count: parseInt(row.count)
        }))
      };

    } catch (error) {
      logger.error('Error in HearingService.getHearingCounts:', error);
      throw error;
    }
  }

  /**
   * Search hearings by text (title, citation, committee names)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results
   */
  async searchHearings(query, options = {}) {
    const { 
      limit = 20, 
      offset = 0, 
      congress = null, 
      chamber = null 
    } = options;

    try {
      const whereConditions = [];
      const queryParams = [];
      let paramCount = 0;

      // Full-text search condition
      paramCount++;
      whereConditions.push(`h.search_vector @@ plainto_tsquery('english', $${paramCount})`);
      queryParams.push(query);

      if (congress) {
        paramCount++;
        whereConditions.push(`h.congress_id = $${paramCount}`);
        queryParams.push(parseInt(congress));
      }

      if (chamber && chamber !== 'all') {
        paramCount++;
        whereConditions.push(`h.chamber = $${paramCount}`);
        queryParams.push(chamber);
      }

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

      // Get total count
      const countQuery = `
        SELECT COUNT(*) 
        FROM hearing h
        ${whereClause}
      `;
      const countResult = await this.pool.query(countQuery, queryParams);
      const totalCount = parseInt(countResult.rows[0].count);

      // Get search results with ranking
      paramCount++;
      const limitParam = paramCount;
      paramCount++;
      const offsetParam = paramCount;
      queryParams.push(limit, offset);

      const searchQuery = `
        SELECT 
          h.jacket_number,
          h.congress_id,
          h.chamber,
          h.number,
          h.part,
          h.title,
          h.citation,
          h.library_of_congress_identifier,
          h.api_update_date,
          ts_rank(h.search_vector, plainto_tsquery('english', $1)) as rank
        FROM hearing h
        ${whereClause}
        ORDER BY rank DESC, h.api_update_date DESC NULLS LAST
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `;

      const result = await this.pool.query(searchQuery, queryParams);
      
      // Transform results
      const hearings = result.rows.map(row => ({
        jacketNumber: parseInt(row.jacket_number),
        congress: row.congress_id,
        chamber: row.chamber,
        number: row.number,
        part: row.part,
        title: row.title,
        citation: row.citation,
        libraryOfCongressIdentifier: row.library_of_congress_identifier,
        updateDate: row.api_update_date ? row.api_update_date.toISOString() : null,
        url: `https://api.congress.gov/v3/hearing/${row.congress_id}/${row.chamber.toLowerCase()}/${row.jacket_number}`,
        searchRank: parseFloat(row.rank)
      }));

      return {
        hearings,
        pagination: {
          count: totalCount,
          offset: offset,
          limit: limit
        },
        request: {
          query: query,
          congress: congress || 'all',
          chamber: chamber || 'all',
          contentType: 'application/json',
          format: 'json'
        }
      };

    } catch (error) {
      logger.error('Error in HearingService.searchHearings:', error);
      throw error;
    }
  }

  /**
   * Close the database connection pool
   */
  async close() {
    await this.pool.end();
  }
}

module.exports = { HearingService };