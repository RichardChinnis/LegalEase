const { logger } = require('../logger');

/**
 * Spotlight Service
 *
 * Manages "In the News" curated bills for the Congressional Dashboard.
 * Handles CRUD operations for spotlight bills and enhanced summaries.
 *
 * Features:
 * - Active spotlight bill retrieval with full bill data
 * - Category-based filtering (breaking, trending, upcoming_vote, just_passed)
 * - Time-based spotlight scheduling (start_date/end_date)
 * - Time-based filtering for "just_passed" category (only shows bills passed within 14 days)
 * - Enhanced summary management (one_liner, cocktail_party, eli5, the_debate)
 * - User following system for bills, topics, and members
 */
class SpotlightService {
  constructor(pool) {
    this.pool = pool;

    // Configuration: Number of days a bill is considered "just passed"
    this.JUST_PASSED_DAYS = 14;
  }

  // ============================================
  // SPOTLIGHT BILL OPERATIONS
  // ============================================

  /**
   * Get all active spotlight bills with full bill data
   * @param {Object} options - Query options
   * @param {string} options.category - Filter by category (optional)
   * @param {number} options.limit - Max results (default 10)
   * @returns {Array} Spotlight bills with bill details
   *
   * Note: For 'just_passed' category, only bills that passed within the last
   * JUST_PASSED_DAYS (default 14) are included. This ensures the category
   * remains relevant and doesn't show stale "just passed" bills.
   */
  async getActiveSpotlights({ category = null, limit = 10 } = {}) {
    let query = `
      SELECT
        s.spotlight_id,
        s.bill_id,
        s.headline,
        s.news_context,
        s.priority,
        s.category,
        s.start_date,
        s.end_date,
        s.created_at,
        -- Bill details
        b.bill_type,
        b.bill_number,
        b.congress_id,
        b.title,
        b.introduced_date,
        b.latest_action_date,
        b.latest_action_text,
        b.policy_area,
        b.origin_chamber,
        -- Enhanced summary if available
        bse.content as one_liner,
        bse_debate.the_debate_supporters,
        bse_debate.the_debate_critics,
        bse_debate.affects_tags,
        -- Counts
        (SELECT COUNT(*) FROM bill_cosponsor WHERE bill_id = b.bill_id) as cosponsor_count,
        (SELECT COUNT(*) FROM action WHERE bill_id = b.bill_id) as action_count
      FROM spotlight_bill s
      JOIN bill b ON s.bill_id = b.bill_id
      LEFT JOIN bill_summary_enhanced bse ON b.bill_id = bse.bill_id AND bse.summary_type = 'one_liner'
      LEFT JOIN bill_summary_enhanced bse_debate ON b.bill_id = bse_debate.bill_id AND bse_debate.summary_type = 'the_debate'
      WHERE s.is_active = true
        AND (s.start_date IS NULL OR s.start_date <= NOW())
        AND (s.end_date IS NULL OR s.end_date >= NOW())
        -- Time-based filter: 'just_passed' bills must have passed within JUST_PASSED_DAYS
        AND (
          s.category != 'just_passed'
          OR b.latest_action_date >= NOW() - INTERVAL '${this.JUST_PASSED_DAYS} days'
        )
    `;

    const params = [];

    if (category) {
      params.push(category);
      query += ` AND s.category = $${params.length}`;
    }

    query += ` ORDER BY s.priority DESC, s.created_at DESC`;

    params.push(limit);
    query += ` LIMIT $${params.length}`;

    try {
      const result = await this.pool.query(query, params);
      return result.rows.map(row => this.formatSpotlightBill(row));
    } catch (error) {
      logger.error('Error fetching active spotlights', { error: error.message, category, limit });
      throw error;
    }
  }

  /**
   * Get a single spotlight by ID
   * @param {number} spotlightId - Spotlight ID
   * @returns {Object|null} Spotlight bill or null
   */
  async getSpotlightById(spotlightId) {
    const query = `
      SELECT
        s.*,
        b.bill_type,
        b.bill_number,
        b.congress_id,
        b.title,
        b.introduced_date,
        b.latest_action_date,
        b.latest_action_text,
        b.policy_area,
        bse.content as one_liner,
        bse_debate.the_debate_supporters,
        bse_debate.the_debate_critics,
        bse_debate.affects_tags
      FROM spotlight_bill s
      JOIN bill b ON s.bill_id = b.bill_id
      LEFT JOIN bill_summary_enhanced bse ON b.bill_id = bse.bill_id AND bse.summary_type = 'one_liner'
      LEFT JOIN bill_summary_enhanced bse_debate ON b.bill_id = bse_debate.bill_id AND bse_debate.summary_type = 'the_debate'
      WHERE s.spotlight_id = $1
    `;

    try {
      const result = await this.pool.query(query, [spotlightId]);
      return result.rows[0] ? this.formatSpotlightBill(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error fetching spotlight by ID', { error: error.message, spotlightId });
      throw error;
    }
  }

  /**
   * Create a new spotlight bill
   * @param {Object} data - Spotlight data
   * @returns {Object} Created spotlight
   */
  async createSpotlight(data) {
    const {
      bill_id,
      headline,
      news_context,
      priority = 0,
      category = 'trending',
      start_date = null,
      end_date = null,
      created_by = null
    } = data;

    const query = `
      INSERT INTO spotlight_bill (
        bill_id, headline, news_context, priority, category,
        start_date, end_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        bill_id, headline, news_context, priority, category,
        start_date, end_date, created_by
      ]);

      logger.info('Created spotlight bill', { spotlight_id: result.rows[0].spotlight_id, bill_id });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating spotlight', { error: error.message, bill_id });
      throw error;
    }
  }

  /**
   * Update a spotlight bill
   * @param {number} spotlightId - Spotlight ID
   * @param {Object} data - Fields to update
   * @returns {Object} Updated spotlight
   */
  async updateSpotlight(spotlightId, data) {
    const allowedFields = [
      'headline', 'news_context', 'priority', 'category',
      'is_active', 'start_date', 'end_date'
    ];

    const updates = [];
    const params = [];
    let paramCount = 0;

    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key)) {
        paramCount++;
        updates.push(`${key} = $${paramCount}`);
        params.push(value);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    paramCount++;
    updates.push(`updated_at = NOW()`);
    params.push(spotlightId);

    const query = `
      UPDATE spotlight_bill
      SET ${updates.join(', ')}
      WHERE spotlight_id = $${paramCount}
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, params);
      if (result.rows.length === 0) {
        return null;
      }
      logger.info('Updated spotlight bill', { spotlight_id: spotlightId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating spotlight', { error: error.message, spotlightId });
      throw error;
    }
  }

  /**
   * Delete a spotlight bill
   * @param {number} spotlightId - Spotlight ID
   * @returns {boolean} Success
   */
  async deleteSpotlight(spotlightId) {
    const query = `DELETE FROM spotlight_bill WHERE spotlight_id = $1 RETURNING spotlight_id`;

    try {
      const result = await this.pool.query(query, [spotlightId]);
      if (result.rows.length > 0) {
        logger.info('Deleted spotlight bill', { spotlight_id: spotlightId });
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error deleting spotlight', { error: error.message, spotlightId });
      throw error;
    }
  }

  // ============================================
  // ENHANCED SUMMARY OPERATIONS
  // ============================================

  /**
   * Get enhanced summaries for a bill
   * @param {string} billId - Bill ID
   * @returns {Object} Summaries by type
   */
  async getBillSummaries(billId) {
    const query = `
      SELECT
        summary_type,
        content,
        the_debate_supporters,
        the_debate_critics,
        affects_tags,
        generated_by,
        confidence_score,
        created_at,
        updated_at
      FROM bill_summary_enhanced
      WHERE bill_id = $1
    `;

    try {
      const result = await this.pool.query(query, [billId]);

      // Convert to object keyed by summary_type
      const summaries = {};
      for (const row of result.rows) {
        summaries[row.summary_type] = {
          content: row.content,
          supporters: row.the_debate_supporters,
          critics: row.the_debate_critics,
          affectsTags: row.affects_tags || [],
          generatedBy: row.generated_by,
          confidenceScore: row.confidence_score,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      }

      return summaries;
    } catch (error) {
      logger.error('Error fetching bill summaries', { error: error.message, billId });
      throw error;
    }
  }

  /**
   * Upsert an enhanced summary for a bill
   * @param {Object} data - Summary data
   * @returns {Object} Created/updated summary
   */
  async upsertBillSummary(data) {
    const {
      bill_id,
      summary_type,
      content,
      the_debate_supporters = null,
      the_debate_critics = null,
      affects_tags = [],
      generated_by = 'manual',
      confidence_score = null
    } = data;

    const query = `
      INSERT INTO bill_summary_enhanced (
        bill_id, summary_type, content,
        the_debate_supporters, the_debate_critics,
        affects_tags, generated_by, confidence_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (bill_id, summary_type)
      DO UPDATE SET
        content = EXCLUDED.content,
        the_debate_supporters = EXCLUDED.the_debate_supporters,
        the_debate_critics = EXCLUDED.the_debate_critics,
        affects_tags = EXCLUDED.affects_tags,
        generated_by = EXCLUDED.generated_by,
        confidence_score = EXCLUDED.confidence_score,
        updated_at = NOW()
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        bill_id, summary_type, content,
        the_debate_supporters, the_debate_critics,
        affects_tags, generated_by, confidence_score
      ]);

      logger.info('Upserted bill summary', { bill_id, summary_type });
      return result.rows[0];
    } catch (error) {
      logger.error('Error upserting bill summary', { error: error.message, bill_id, summary_type });
      throw error;
    }
  }

  // ============================================
  // USER FOLLOW OPERATIONS
  // ============================================

  /**
   * Get all items a user is following
   * @param {string} userId - User ID
   * @param {string} followType - Optional filter by type (bill, topic, member)
   * @returns {Array} Followed items
   */
  async getUserFollows(userId, followType = null) {
    let query = `
      SELECT
        follow_id,
        follow_type,
        follow_target_id,
        notify,
        created_at
      FROM user_follow
      WHERE user_id = $1
    `;

    const params = [userId];

    if (followType) {
      params.push(followType);
      query += ` AND follow_type = $2`;
    }

    query += ` ORDER BY created_at DESC`;

    try {
      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching user follows', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Get followed bills with full bill data
   * @param {string} userId - User ID
   * @returns {Array} Followed bills with details
   */
  async getUserFollowedBills(userId) {
    const query = `
      SELECT
        uf.follow_id,
        uf.follow_target_id as bill_id,
        uf.notify,
        uf.created_at as followed_at,
        b.bill_type,
        b.bill_number,
        b.congress_id,
        b.title,
        b.latest_action_date,
        b.latest_action_text,
        b.policy_area,
        bse.content as one_liner
      FROM user_follow uf
      JOIN bill b ON uf.follow_target_id = b.bill_id
      LEFT JOIN bill_summary_enhanced bse ON b.bill_id = bse.bill_id AND bse.summary_type = 'one_liner'
      WHERE uf.user_id = $1 AND uf.follow_type = 'bill'
      ORDER BY b.latest_action_date DESC NULLS LAST
    `;

    try {
      const result = await this.pool.query(query, [userId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching user followed bills', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Follow an item (bill, topic, or member)
   * @param {string} userId - User ID
   * @param {string} followType - Type (bill, topic, member)
   * @param {string} targetId - ID of item to follow
   * @param {boolean} notify - Enable notifications
   * @returns {Object} Created follow
   */
  async addFollow(userId, followType, targetId, notify = false) {
    const query = `
      INSERT INTO user_follow (user_id, follow_type, follow_target_id, notify)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, follow_type, follow_target_id)
      DO UPDATE SET notify = EXCLUDED.notify, updated_at = NOW()
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [userId, followType, targetId, notify]);
      logger.info('User followed item', { userId, followType, targetId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding follow', { error: error.message, userId, followType, targetId });
      throw error;
    }
  }

  /**
   * Unfollow an item
   * @param {string} userId - User ID
   * @param {string} followType - Type (bill, topic, member)
   * @param {string} targetId - ID of item to unfollow
   * @returns {boolean} Success
   */
  async removeFollow(userId, followType, targetId) {
    const query = `
      DELETE FROM user_follow
      WHERE user_id = $1 AND follow_type = $2 AND follow_target_id = $3
      RETURNING follow_id
    `;

    try {
      const result = await this.pool.query(query, [userId, followType, targetId]);
      if (result.rows.length > 0) {
        logger.info('User unfollowed item', { userId, followType, targetId });
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error removing follow', { error: error.message, userId, followType, targetId });
      throw error;
    }
  }

  /**
   * Check if user is following an item
   * @param {string} userId - User ID
   * @param {string} followType - Type
   * @param {string} targetId - Target ID
   * @returns {boolean} Is following
   */
  async isFollowing(userId, followType, targetId) {
    const query = `
      SELECT 1 FROM user_follow
      WHERE user_id = $1 AND follow_type = $2 AND follow_target_id = $3
    `;

    try {
      const result = await this.pool.query(query, [userId, followType, targetId]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking follow status', { error: error.message, userId, followType, targetId });
      throw error;
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Format a spotlight bill row into API response format
   */
  formatSpotlightBill(row) {
    return {
      spotlight: {
        id: row.spotlight_id,
        headline: row.headline,
        newsContext: row.news_context,
        priority: row.priority,
        category: row.category,
        startDate: row.start_date,
        endDate: row.end_date,
        createdAt: row.created_at
      },
      bill: {
        id: row.bill_id,
        type: row.bill_type,
        number: row.bill_number,
        congress: row.congress_id,
        title: row.title,
        introducedDate: row.introduced_date,
        latestAction: {
          date: row.latest_action_date,
          text: row.latest_action_text
        },
        policyArea: row.policy_area,
        originChamber: row.origin_chamber,
        cosponsorsCount: parseInt(row.cosponsor_count) || 0,
        actionsCount: parseInt(row.action_count) || 0
      },
      summary: {
        oneLiner: row.one_liner || null,
        theDebate: {
          supporters: row.the_debate_supporters || null,
          critics: row.the_debate_critics || null
        },
        affectsTags: row.affects_tags || []
      }
    };
  }
}

module.exports = { SpotlightService };
