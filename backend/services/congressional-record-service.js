/**
 * Congressional Record Service
 * Provides high-performance access to Congressional Record data
 * 
 * Features:
 * - Efficient full-text search across all CR content
 * - Resolution of bill action CR references
 * - Page-based lookup of articles and sections
 * - Metadata and statistical queries
 */

class CongressionalRecordService {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Search Congressional Record content using full-text search
   * @param {string} searchQuery - Search terms
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results with relevance ranking
   */
  async searchContent(searchQuery, options = {}) {
    const {
      congress = null,
      chamber = null,
      startDate = null,
      endDate = null,
      limit = 50,
      offset = 0
    } = options;

    const client = await this.pool.connect();
    try {
      let query = `
        SELECT 
          art.article_id,
          art.title,
          art.start_page,
          art.end_page,
          s.name as section_name,
          i.issue_date,
          i.congress,
          v.volume_number,
          ts_rank(art.content_search_vector, plainto_tsquery('english', $1)) as relevance,
          ts_headline('english', COALESCE(art.content_text, ''), plainto_tsquery('english', $1)) as snippet
        FROM congressional_record_article art
        JOIN congressional_record_section s ON art.section_id = s.section_id
        JOIN congressional_record_issue i ON s.issue_id = i.issue_id
        JOIN congressional_record_volume v ON i.volume_id = v.volume_id
        WHERE art.content_search_vector @@ plainto_tsquery('english', $1)
      `;

      const params = [searchQuery];
      let paramIndex = 2;

      // Add filters
      if (congress) {
        query += ` AND i.congress = $${paramIndex}`;
        params.push(congress);
        paramIndex++;
      }

      if (chamber) {
        const sectionNames = {
          'H': 'House',
          'S': 'Senate', 
          'E': 'Extensions of Remarks',
          'D': 'Daily Digest'
        };
        query += ` AND s.name = $${paramIndex}`;
        params.push(sectionNames[chamber]);
        paramIndex++;
      }

      if (startDate) {
        query += ` AND i.issue_date >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        query += ` AND i.issue_date <= $${paramIndex}`;
        params.push(endDate);
        paramIndex++;
      }

      query += `
        ORDER BY relevance DESC, i.issue_date DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);

      const result = await client.query(query, params);
      
      return {
        articles: result.rows,
        total: result.rowCount,
        hasMore: result.rowCount === limit
      };

    } finally {
      client.release();
    }
  }

  /**
   * Find Congressional Record articles by page reference
   * @param {string} chamber - Chamber code (H, S, E, D)
   * @param {string} startPage - Starting page number
   * @param {string} endPage - Ending page number (optional)
   * @param {Date} issueDate - Issue date (optional for filtering)
   * @returns {Promise<Array>} Matching articles
   */
  async findArticlesByPageRange(chamber, startPage, endPage = null, issueDate = null) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM find_articles_by_page_range($1, $2, $3, $4)',
        [chamber, startPage, endPage, issueDate]
      );

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Resolve bill action references to actual Congressional Record content
   * @param {string} billId - Bill identifier
   * @returns {Promise<Array>} Bill CR references with resolved content
   */
  async getBillCongressionalRecordReferences(billId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM bill_congressional_record_references
        WHERE bill_id = $1
        ORDER BY action_date DESC
      `, [billId]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get unresolved CR references that need manual or automated resolution
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Unresolved references
   */
  async getUnresolvedReferences(options = {}) {
    const { chamber = null, limit = 100 } = options;

    const client = await this.pool.connect();
    try {
      let query = `
        SELECT 
          r.reference_id,
          r.bill_id,
          r.reference_text,
          r.chamber,
          r.start_page,
          r.end_page,
          a.action_date,
          a.text as action_text
        FROM action_congressional_record_reference r
        JOIN action a ON r.action_id = a.action_id
        WHERE r.is_resolved = FALSE
      `;

      const params = [];
      if (chamber) {
        query += ' AND r.chamber = $1';
        params.push(chamber);
      }

      query += ' ORDER BY a.action_date DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Attempt to automatically resolve CR references by matching page numbers
   * @param {number} referenceId - Reference ID to resolve
   * @returns {Promise<boolean>} Success status
   */
  async attemptReferenceResolution(referenceId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get the reference details
      const refResult = await client.query(`
        SELECT r.*, a.action_date
        FROM action_congressional_record_reference r
        JOIN action a ON r.action_id = a.action_id
        WHERE r.reference_id = $1 AND r.is_resolved = FALSE
      `, [referenceId]);

      if (refResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const reference = refResult.rows[0];

      // Try to find matching articles near the action date
      const dateRange = 7; // Look within 7 days of the action
      const articles = await client.query(`
        SELECT 
          art.article_id,
          s.section_id,
          i.issue_id,
          abs(extract(epoch from (i.issue_date - $4::date)) / 86400) as day_difference
        FROM congressional_record_article art
        JOIN congressional_record_section s ON art.section_id = s.section_id
        JOIN congressional_record_issue i ON s.issue_id = i.issue_id
        WHERE s.name = CASE 
          WHEN $1 = 'H' THEN 'House'::cr_section_type
          WHEN $1 = 'S' THEN 'Senate'::cr_section_type
          WHEN $1 = 'E' THEN 'Extensions of Remarks'::cr_section_type
          WHEN $1 = 'D' THEN 'Daily Digest'::cr_section_type
        END
        AND extract_page_number(art.start_page) <= extract_page_number($2)
        AND extract_page_number(COALESCE(art.end_page, art.start_page)) >= extract_page_number($2)
        AND abs(extract(epoch from (i.issue_date - $4::date)) / 86400) <= $5
        ORDER BY day_difference ASC
        LIMIT 1
      `, [
        reference.chamber, 
        reference.start_page, 
        reference.end_page, 
        reference.action_date, 
        dateRange
      ]);

      if (articles.rows.length > 0) {
        const match = articles.rows[0];
        
        // Update the reference with resolved information
        await client.query(`
          UPDATE action_congressional_record_reference
          SET 
            issue_id = $2,
            section_id = $3,
            article_id = $4,
            is_resolved = TRUE,
            resolution_confidence = 0.8,
            resolution_notes = 'Automatically resolved by page range matching',
            updated_at = NOW()
          WHERE reference_id = $1
        `, [referenceId, match.issue_id, match.section_id, match.article_id]);

        await client.query('COMMIT');
        return true;
      } else {
        await client.query('ROLLBACK');
        return false;
      }

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get Congressional Record statistics and metrics
   * @returns {Promise<Object>} Statistics object
   */
  async getStatistics() {
    const client = await this.pool.connect();
    try {
      const stats = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM congressional_record_volume) as total_volumes,
          (SELECT COUNT(*) FROM congressional_record_issue) as total_issues,
          (SELECT COUNT(*) FROM congressional_record_section) as total_sections,
          (SELECT COUNT(*) FROM congressional_record_article) as total_articles,
          (SELECT COUNT(*) FROM action_congressional_record_reference) as total_references,
          (SELECT COUNT(*) FROM action_congressional_record_reference WHERE is_resolved = TRUE) as resolved_references,
          (SELECT MIN(year) FROM congressional_record_volume) as earliest_year,
          (SELECT MAX(year) FROM congressional_record_volume) as latest_year,
          (SELECT MIN(congress) FROM congressional_record_volume) as earliest_congress,
          (SELECT MAX(congress) FROM congressional_record_volume) as latest_congress
      `);

      const contentStats = await client.query(`
        SELECT 
          COUNT(*) as articles_with_content,
          AVG(word_count) as avg_word_count,
          SUM(word_count) as total_words,
          AVG(character_count) as avg_character_count
        FROM congressional_record_article 
        WHERE content_text IS NOT NULL
      `);

      return {
        ...stats.rows[0],
        content: contentStats.rows[0],
        resolution_rate: stats.rows[0].total_references > 0 
          ? (stats.rows[0].resolved_references / stats.rows[0].total_references * 100).toFixed(2) + '%'
          : '0%'
      };

    } finally {
      client.release();
    }
  }

  /**
   * Bulk import Congressional Record data
   * @param {Object} data - Import data structure
   * @returns {Promise<Object>} Import results
   */
  async bulkImport(data) {
    const client = await this.pool.connect();
    let results = {
      volumes: 0,
      issues: 0,
      sections: 0,
      articles: 0,
      errors: []
    };

    try {
      await client.query('BEGIN');

      for (const volumeData of data.volumes || []) {
        try {
          // Insert volume
          const volumeResult = await client.query(`
            INSERT INTO congressional_record_volume 
            (volume_number, congress, session_number, year, metadata)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (volume_number, congress, session_number) 
            DO UPDATE SET updated_at = NOW()
            RETURNING volume_id
          `, [
            volumeData.volume_number,
            volumeData.congress,
            volumeData.session_number,
            volumeData.year,
            volumeData.metadata || {}
          ]);
          
          results.volumes++;
          const volumeId = volumeResult.rows[0].volume_id;

          // Insert issues for this volume
          for (const issueData of volumeData.issues || []) {
            try {
              const issueResult = await client.query(`
                INSERT INTO congressional_record_issue
                (volume_id, issue_number, issue_date, congress, session_number, 
                 full_issue_url, update_date, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (volume_id, issue_number) 
                DO UPDATE SET updated_at = NOW()
                RETURNING issue_id
              `, [
                volumeId,
                issueData.issue_number,
                issueData.issue_date,
                volumeData.congress,
                volumeData.session_number,
                issueData.full_issue_url,
                issueData.update_date,
                issueData.metadata || {}
              ]);

              results.issues++;
              const issueId = issueResult.rows[0].issue_id;

              // Insert sections and articles...
              // (Implementation continues for sections/articles)

            } catch (error) {
              results.errors.push(`Issue import error: ${error.message}`);
            }
          }

        } catch (error) {
          results.errors.push(`Volume import error: ${error.message}`);
        }
      }

      await client.query('COMMIT');
      return results;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = CongressionalRecordService;