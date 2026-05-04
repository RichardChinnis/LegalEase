const { Pool } = require('pg');
const config = require('../config');
const logger = require('./logger');

class DatabaseService {
  constructor() {
    this.pool = new Pool(config.database);
    
    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', err);
    });

    this.pool.on('connect', () => {
      logger.debug('New database connection established');
    });
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Database query executed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        rows: result.rowCount
      });
      return result;
    } catch (error) {
      logger.error('Database query failed', {
        query: text.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Upsert a bill (insert or update)
  async upsertBill(billData) {
    const query = `
      INSERT INTO bill (
        bill_id, congress_id, bill_type, bill_number,
        origin_chamber, origin_chamber_code, title, introduced_date,
        latest_action_date, latest_action_text,
        policy_area, constitutional_authority_statement_text,
        law_type, law_number,
        api_update_date, api_update_date_including_text, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (bill_id) DO UPDATE SET
        title = EXCLUDED.title,
        origin_chamber_code = EXCLUDED.origin_chamber_code,
        latest_action_date = EXCLUDED.latest_action_date,
        latest_action_text = EXCLUDED.latest_action_text,
        policy_area = EXCLUDED.policy_area,
        constitutional_authority_statement_text = EXCLUDED.constitutional_authority_statement_text,
        law_type = EXCLUDED.law_type,
        law_number = EXCLUDED.law_number,
        api_update_date = EXCLUDED.api_update_date,
        api_update_date_including_text = EXCLUDED.api_update_date_including_text,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING bill_id, (xmax = 0) AS inserted`;

    // Build notes JSON with additional data
    const notes = {
      url: billData.url,
      subjects: billData.subjects || [],
      sponsors: billData.sponsors || [],
      cosponsors_count: billData.cosponsors_count || 0,
      committees: billData.committees || []
    };

    const values = [
      billData.bill_id,
      billData.congress_id,
      billData.bill_type,
      billData.bill_number,
      billData.origin_chamber,
      billData.origin_chamber_code,
      billData.title,
      billData.introduced_date,
      billData.latest_action_date,
      billData.latest_action_text,
      billData.policy_area,
      billData.constitutional_authority_statement_text,
      billData.law_type,
      billData.law_number,
      billData.api_update_date,
      billData.api_update_date_including_text,
      JSON.stringify(notes)
    ];

    const result = await this.query(query, values);
    return {
      bill_id: result.rows[0].bill_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert an action
  async upsertAction(actionData) {
    // Match the database unique index: (bill_id, action_date, md5(text))
    // This ensures we align with the actual uniqueness constraint in the database
    const checkQuery = `
      SELECT action_id FROM action
      WHERE bill_id = $1
        AND action_date = $2
        AND md5(text) = md5($3)
      LIMIT 1`;

    const existing = await this.query(checkQuery, [
      actionData.bill_id,
      actionData.action_date,
      actionData.text
    ]);

    if (existing.rows.length > 0) {
      // Update existing action
      const updateQuery = `
        UPDATE action SET
          action_time = $1,
          type = $2,
          action_code = $3,
          source_system_code = $4,
          source_system_name = $5,
          calendar_number = $6,
          calendar_name = $7
        WHERE action_id = $8
        RETURNING action_id`;

      const result = await this.query(updateQuery, [
        actionData.action_time,
        actionData.type,
        actionData.action_code,
        actionData.source_system_code,
        actionData.source_system_name,
        actionData.calendar_number,
        actionData.calendar_name,
        existing.rows[0].action_id
      ]);

      return {
        action_id: result.rows[0].action_id,
        inserted: false,
        updated: true
      };
    } else {
      // Insert new action
      const insertQuery = `
        INSERT INTO action (
          bill_id, action_date, action_time,
          text, type, action_code, 
          source_system_code, source_system_name,
          calendar_number, calendar_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING action_id`;

      const values = [
        actionData.bill_id,
        actionData.action_date,
        actionData.action_time,
        actionData.text,
        actionData.type,
        actionData.action_code,
        actionData.source_system_code,
        actionData.source_system_name,
        actionData.calendar_number,
        actionData.calendar_name
      ];

      const result = await this.query(insertQuery, values);
      return {
        action_id: result.rows[0].action_id,
        inserted: true,
        updated: false
      };
    }
  }

  // Get sync status
  async getSyncStatus(entity_type) {
    const query = `
      SELECT * FROM sync_status 
      WHERE entity_type = $1
      ORDER BY last_sync_at DESC
      LIMIT 1`;
    
    const result = await this.query(query, [entity_type]);
    return result.rows[0] || null;
  }

  // Update sync status
  async updateSyncStatus(entity_type, status) {
    const query = `
      INSERT INTO sync_status (
        entity_type, last_sync_at, last_successful_sync,
        records_synced, records_failed, sync_duration_ms,
        error_message, sync_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`;

    const values = [
      entity_type,
      new Date(),
      status.success ? new Date() : null,
      status.records_synced || 0,
      status.records_failed || 0,
      status.duration || 0,
      status.error || null,
      JSON.stringify(status.metadata || {})
    ];

    const result = await this.query(query, values);
    return result.rows[0];
  }

  // Get bills that need updating
  async getBillsNeedingUpdate(daysSinceUpdate = 7) {
    const query = `
      SELECT bill_id, update_date 
      FROM bill
      WHERE update_date < CURRENT_DATE - INTERVAL '${daysSinceUpdate} days'
      OR update_date IS NULL
      ORDER BY update_date ASC NULLS FIRST
      LIMIT 1000`;
    
    const result = await this.query(query);
    return result.rows;
  }

  // Bulk upsert for better performance
  async bulkUpsertBills(bills) {
    const results = {
      inserted: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    await this.transaction(async (client) => {
      for (const bill of bills) {
        try {
          const result = await this.upsertBill(bill);
          if (result.inserted) results.inserted++;
          else results.updated++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            bill_id: bill.bill_id,
            error: error.message
          });
          logger.error('Failed to upsert bill', {
            bill_id: bill.bill_id,
            error: error.message
          });
        }
      }
    });

    return results;
  }

  // Ensure a congress exists in the database
  async ensureCongressExists(congressId, details = {}) {
    // Check if congress already exists
    const checkQuery = `SELECT * FROM congress WHERE congress_id = $1`;
    const existing = await this.query(checkQuery, [congressId]);
    
    if (existing.rows.length > 0) {
      logger.debug(`Congress ${congressId} already exists in database`);
      return existing.rows[0];
    }
    
    // Create new congress entry
    const insertQuery = `
      INSERT INTO congress (congress_id, name, start_year, end_year)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (congress_id) DO UPDATE SET
        name = EXCLUDED.name,
        start_year = EXCLUDED.start_year,
        end_year = EXCLUDED.end_year,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`;
    
    const name = details.name || `${congressId}th Congress`;
    const startYear = details.start_year || 1789 + (congressId - 1) * 2;
    const endYear = details.end_year || startYear + 2;
    
    const values = [congressId, name, startYear, endYear];
    const result = await this.query(insertQuery, values);
    
    logger.info(`Created new congress entry: ${name} (${startYear}-${endYear})`);
    return result.rows[0];
  }

  // Upsert bill sponsor
  async upsertBillSponsor(sponsorData) {
    const query = `
      INSERT INTO bill_sponsor (
        bill_id, member_bioguide_id, sponsorship_date, is_by_request
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (bill_id) DO UPDATE SET
        member_bioguide_id = EXCLUDED.member_bioguide_id,
        sponsorship_date = EXCLUDED.sponsorship_date,
        is_by_request = EXCLUDED.is_by_request
      RETURNING bill_id, (xmax = 0) AS inserted`;

    const values = [
      sponsorData.bill_id,
      sponsorData.bioguide_id,
      sponsorData.sponsorship_date,
      sponsorData.is_by_request || false
    ];

    const result = await this.query(query, values);
    return {
      bill_id: result.rows[0].bill_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill cosponsor
  async upsertBillCosponsor(cosponsorData) {
    const query = `
      INSERT INTO bill_cosponsor (
        bill_id, bioguide_id, full_name, first_name, middle_name, last_name,
        party, state, district, sponsorship_date, is_original_cosponsor, 
        sponsorship_withdrawn_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (bill_id, bioguide_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        first_name = EXCLUDED.first_name,
        middle_name = EXCLUDED.middle_name,
        last_name = EXCLUDED.last_name,
        party = EXCLUDED.party,
        state = EXCLUDED.state,
        district = EXCLUDED.district,
        sponsorship_date = EXCLUDED.sponsorship_date,
        is_original_cosponsor = EXCLUDED.is_original_cosponsor,
        sponsorship_withdrawn_date = EXCLUDED.sponsorship_withdrawn_date,
        updated_at = CURRENT_TIMESTAMP
      RETURNING cosponsor_id, (xmax = 0) AS inserted`;

    const values = [
      cosponsorData.bill_id,
      cosponsorData.bioguide_id,
      cosponsorData.full_name,
      cosponsorData.first_name,
      cosponsorData.middle_name,
      cosponsorData.last_name,
      cosponsorData.party,
      cosponsorData.state,
      cosponsorData.district,
      cosponsorData.sponsorship_date,
      cosponsorData.is_original_cosponsor,
      cosponsorData.sponsorship_withdrawn_date
    ];

    const result = await this.query(query, values);
    return {
      cosponsor_id: result.rows[0].cosponsor_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill summary
  async upsertBillSummary(summaryData) {
    const query = `
      INSERT INTO bill_summary (
        bill_id, version_code, action_date, action_desc, update_date, text
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (bill_id, version_code) DO UPDATE SET
        action_date = EXCLUDED.action_date,
        action_desc = EXCLUDED.action_desc,
        update_date = EXCLUDED.update_date,
        text = EXCLUDED.text
      RETURNING summary_id, (xmax = 0) AS inserted`;

    const values = [
      summaryData.bill_id,
      summaryData.version_code,
      summaryData.action_date,
      summaryData.action_desc,
      summaryData.update_date,
      summaryData.text
    ];

    const result = await this.query(query, values);
    return {
      summary_id: result.rows[0].summary_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill title
  async upsertBillTitle(titleData) {
    const query = `
      INSERT INTO bill_title (
        bill_id, title_type, title_type_code, title, chamber_code, chamber_name,
        bill_text_version_name, bill_text_version_code, update_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (bill_id, title_type_code, title) DO UPDATE SET
        title_type = EXCLUDED.title_type,
        chamber_code = EXCLUDED.chamber_code,
        chamber_name = EXCLUDED.chamber_name,
        bill_text_version_name = EXCLUDED.bill_text_version_name,
        bill_text_version_code = EXCLUDED.bill_text_version_code,
        update_date = EXCLUDED.update_date
      RETURNING title_id, (xmax = 0) AS inserted`;

    const values = [
      titleData.bill_id,
      titleData.title_type,
      titleData.title_type_code,
      titleData.title,
      titleData.chamber_code,
      titleData.chamber_name,
      titleData.bill_text_version_name,
      titleData.bill_text_version_code,
      titleData.update_date
    ];

    const result = await this.query(query, values);
    return {
      title_id: result.rows[0].title_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill amendment
  async upsertBillAmendment(amendmentData) {
    const query = `
      INSERT INTO bill_amendment (
        amendment_id, bill_id, amendment_number, congress, type, description,
        purpose, latest_action_date, latest_action_text, latest_action_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (amendment_id) DO UPDATE SET
        bill_id = EXCLUDED.bill_id,
        amendment_number = EXCLUDED.amendment_number,
        congress = EXCLUDED.congress,
        type = EXCLUDED.type,
        description = EXCLUDED.description,
        purpose = EXCLUDED.purpose,
        latest_action_date = EXCLUDED.latest_action_date,
        latest_action_text = EXCLUDED.latest_action_text,
        latest_action_time = EXCLUDED.latest_action_time,
        updated_at = CURRENT_TIMESTAMP
      RETURNING amendment_id, (xmax = 0) AS inserted`;

    const values = [
      amendmentData.amendment_id,
      amendmentData.bill_id,
      amendmentData.amendment_number,
      amendmentData.congress,
      amendmentData.type,
      amendmentData.description,
      amendmentData.purpose,
      amendmentData.latest_action_date,
      amendmentData.latest_action_text,
      amendmentData.latest_action_time
    ];

    const result = await this.query(query, values);
    return {
      amendment_id: result.rows[0].amendment_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill text version
  async upsertBillTextVersion(textVersionData) {
    // Handle NULL dates specially since ON CONFLICT doesn't work with NULLs
    if (textVersionData.version_date === null) {
      // Check if a version with NULL date already exists
      const checkQuery = `
        SELECT text_version_id FROM bill_text_version 
        WHERE bill_id = $1 AND version_type = $2 AND version_date IS NULL
        LIMIT 1`;
      
      const existing = await this.query(checkQuery, [
        textVersionData.bill_id,
        textVersionData.version_type
      ]);

      if (existing.rows.length > 0) {
        // Update existing record
        const updateQuery = `
          UPDATE bill_text_version 
          SET formats = $1
          WHERE text_version_id = $2
          RETURNING text_version_id`;
        
        const result = await this.query(updateQuery, [
          JSON.stringify(textVersionData.formats || {}),
          existing.rows[0].text_version_id
        ]);
        
        return {
          text_version_id: result.rows[0].text_version_id,
          inserted: false,
          updated: true
        };
      }
    }

    // Normal insert with ON CONFLICT for non-NULL dates
    const query = `
      INSERT INTO bill_text_version (
        bill_id, version_type, version_date, formats
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (bill_id, version_type, version_date) DO UPDATE SET
        formats = EXCLUDED.formats
      RETURNING text_version_id, (xmax = 0) AS inserted`;

    const values = [
      textVersionData.bill_id,
      textVersionData.version_type,
      textVersionData.version_date,
      JSON.stringify(textVersionData.formats || {})
    ];

    const result = await this.query(query, values);
    return {
      text_version_id: result.rows[0].text_version_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill related
  async upsertBillRelated(relatedData) {
    const query = `
      INSERT INTO bill_related (
        bill_id, related_bill_id, related_bill_congress, related_bill_type,
        related_bill_number, related_bill_title, relationship_type, identified_by,
        latest_action_date, latest_action_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (bill_id, related_bill_id, relationship_type) DO UPDATE SET
        related_bill_congress = EXCLUDED.related_bill_congress,
        related_bill_type = EXCLUDED.related_bill_type,
        related_bill_number = EXCLUDED.related_bill_number,
        related_bill_title = EXCLUDED.related_bill_title,
        identified_by = EXCLUDED.identified_by,
        latest_action_date = EXCLUDED.latest_action_date,
        latest_action_text = EXCLUDED.latest_action_text
      RETURNING related_id, (xmax = 0) AS inserted`;

    const values = [
      relatedData.bill_id,
      relatedData.related_bill_id,
      relatedData.related_bill_congress,
      relatedData.related_bill_type,
      relatedData.related_bill_number,
      relatedData.related_bill_title,
      relatedData.relationship_type,
      relatedData.identified_by,
      relatedData.latest_action_date,
      relatedData.latest_action_text
    ];

    const result = await this.query(query, values);
    return {
      related_id: result.rows[0].related_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill committee report
  async upsertBillCommitteeReport(reportData) {
    const query = `
      INSERT INTO bill_committee_report (
        bill_id, citation, url
      ) VALUES ($1, $2, $3)
      ON CONFLICT (bill_id, citation) DO UPDATE SET
        url = EXCLUDED.url
      RETURNING report_id, (xmax = 0) AS inserted`;

    const values = [
      reportData.bill_id,
      reportData.citation,
      reportData.url
    ];

    const result = await this.query(query, values);
    return {
      report_id: result.rows[0].report_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill CBO estimate
  async upsertBillCboEstimate(estimateData) {
    const query = `
      INSERT INTO bill_cbo_estimate (
        bill_id, pub_date, title, url, description
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (bill_id, pub_date, title) DO UPDATE SET
        url = EXCLUDED.url,
        description = EXCLUDED.description
      RETURNING estimate_id, (xmax = 0) AS inserted`;

    const values = [
      estimateData.bill_id,
      estimateData.pub_date,
      estimateData.title,
      estimateData.url,
      estimateData.description
    ];

    const result = await this.query(query, values);
    return {
      estimate_id: result.rows[0].estimate_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill committee activity
  async upsertBillCommitteeActivity(activityData) {
    // Handle NULL dates differently due to partial unique indexes
    let query;
    let values;
    
    if (activityData.activity_date === null || activityData.activity_date === undefined) {
      // For NULL dates, use the partial index for activities without dates
      query = `
        INSERT INTO bill_committee_activity (
          bill_id, committee_system_code, committee_name, activity_name, activity_date
        ) VALUES ($1, $2, $3, $4, NULL)
        ON CONFLICT (bill_id, committee_system_code, activity_name) 
        WHERE activity_date IS NULL 
        DO UPDATE SET
          committee_name = EXCLUDED.committee_name
        RETURNING activity_id, (xmax = 0) AS inserted`;
      
      // Only 4 parameters for NULL date case
      values = [
        activityData.bill_id,
        activityData.committee_system_code,
        activityData.committee_name,
        activityData.activity_name
      ];
    } else {
      // For non-NULL dates, use the full constraint including date
      query = `
        INSERT INTO bill_committee_activity (
          bill_id, committee_system_code, committee_name, activity_name, activity_date
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (bill_id, committee_system_code, activity_name, activity_date) 
        DO UPDATE SET
          committee_name = EXCLUDED.committee_name
        RETURNING activity_id, (xmax = 0) AS inserted`;
      
      // 5 parameters for non-NULL date case
      values = [
        activityData.bill_id,
        activityData.committee_system_code,
        activityData.committee_name,
        activityData.activity_name,
        activityData.activity_date
      ];
    }

    const result = await this.query(query, values);
    return {
      activity_id: result.rows[0].activity_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill subject
  async upsertBillSubject(subjectData) {
    const query = `
      INSERT INTO bill_subject (
        bill_id, subject_name, is_policy_area
      ) VALUES ($1, $2, $3)
      ON CONFLICT (bill_id, subject_name) DO UPDATE SET
        is_policy_area = EXCLUDED.is_policy_area
      RETURNING id, (xmax = 0) AS inserted`;

    const values = [
      subjectData.bill_id,
      subjectData.subject_name,
      subjectData.is_policy_area || false
    ];

    const result = await this.query(query, values);
    return {
      id: result.rows[0].id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert bill law (when a bill becomes law)
  async upsertBillLaw(lawData) {
    const query = `
      INSERT INTO bill_law (bill_id, law_type, law_number)
      VALUES ($1, $2, $3)
      ON CONFLICT (bill_id, law_type, law_number) DO UPDATE SET
        law_type = EXCLUDED.law_type,
        law_number = EXCLUDED.law_number
      RETURNING law_id, (xmax = 0) AS inserted`;

    const values = [
      lawData.bill_id,
      lawData.law_type,
      lawData.law_number
    ];

    const result = await this.query(query, values);
    return {
      law_id: result.rows[0].law_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert committee report
  async upsertCommitteeReport(reportData) {
    const query = `
      INSERT INTO committee_report (
        report_id, congress_id, report_type, report_type_display, report_number,
        citation, part, is_conference_report, issue_date,
        chamber, title, session_number, text_url, text_count,
        committees, api_update_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (report_id) DO UPDATE SET
        citation = EXCLUDED.citation,
        report_type_display = EXCLUDED.report_type_display,
        is_conference_report = EXCLUDED.is_conference_report,
        issue_date = EXCLUDED.issue_date,
        chamber = EXCLUDED.chamber,
        title = EXCLUDED.title,
        session_number = EXCLUDED.session_number,
        text_url = EXCLUDED.text_url,
        text_count = EXCLUDED.text_count,
        committees = EXCLUDED.committees,
        api_update_date = EXCLUDED.api_update_date,
        updated_at = CURRENT_TIMESTAMP
      RETURNING report_id, (xmax = 0) AS inserted`;

    const values = [
      reportData.report_id,
      reportData.congress_id,
      reportData.report_type,
      reportData.report_type_display,
      reportData.report_number,
      reportData.citation,
      reportData.part,
      reportData.is_conference_report,
      reportData.issue_date,
      reportData.chamber,
      reportData.title,
      reportData.session_number,
      reportData.text_url,
      reportData.text_count,
      reportData.committees,
      reportData.api_update_date
    ];

    const result = await this.query(query, values);
    return {
      report_id: result.rows[0].report_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  // Upsert committee report bill relationship
  async upsertCommitteeReportBill(reportId, billId) {
    const query = `
      INSERT INTO committee_report_bill (report_id, bill_id)
      VALUES ($1, $2)
      ON CONFLICT (report_id, bill_id) DO NOTHING
      RETURNING report_id, bill_id`;

    const values = [reportId, billId];
    
    try {
      const result = await this.query(query, values);
      return {
        success: true,
        inserted: result.rows.length > 0
      };
    } catch (error) {
      if (error.code === '23503') { // Foreign key violation
        logger.warn('Foreign key constraint violation for committee_report_bill', {
          report_id: reportId,
          bill_id: billId,
          error: error.message
        });
        return {
          success: false,
          error: 'Foreign key constraint violation'
        };
      }
      throw error;
    }
  }

  // ===============================================
  // CONGRESSIONAL RECORD METHODS
  // ===============================================

  /**
   * Upsert Congressional Record volume
   * @param {Object} volumeData - Volume data
   * @returns {Object} Upsert result
   */
  async upsertCongressionalRecordVolume(volumeData) {
    const query = `
      INSERT INTO congressional_record_volume (
        volume_number, congress, session_number, year, metadata
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (volume_number, congress, session_number) DO UPDATE SET
        year = EXCLUDED.year,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING volume_id, (xmax = 0) AS inserted`;

    const values = [
      volumeData.volume_number,
      volumeData.congress,
      volumeData.session_number,
      volumeData.year,
      volumeData.metadata
    ];

    const result = await this.query(query, values);
    return {
      volume_id: result.rows[0].volume_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  /**
   * Upsert Congressional Record issue
   * @param {Object} issueData - Issue data
   * @returns {Object} Upsert result
   */
  async upsertCongressionalRecordIssue(issueData) {
    const query = `
      INSERT INTO congressional_record_issue (
        volume_id, issue_number, issue_date, congress, session_number,
        full_issue_url, update_date, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (volume_id, issue_number) DO UPDATE SET
        issue_date = EXCLUDED.issue_date,
        full_issue_url = EXCLUDED.full_issue_url,
        update_date = EXCLUDED.update_date,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING issue_id, (xmax = 0) AS inserted`;

    const values = [
      issueData.volume_id,
      issueData.issue_number,
      issueData.issue_date,
      issueData.congress,
      issueData.session_number,
      issueData.full_issue_url,
      issueData.update_date,
      issueData.metadata
    ];

    const result = await this.query(query, values);
    return {
      issue_id: result.rows[0].issue_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  /**
   * Upsert Congressional Record section
   * @param {Object} sectionData - Section data
   * @returns {Object} Upsert result
   */
  async upsertCongressionalRecordSection(sectionData) {
    const query = `
      INSERT INTO congressional_record_section (
        issue_id, name, start_page, end_page, pdf_url, text_url, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (issue_id, name) DO UPDATE SET
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        pdf_url = EXCLUDED.pdf_url,
        text_url = EXCLUDED.text_url,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING section_id, (xmax = 0) AS inserted`;

    const values = [
      sectionData.issue_id,
      sectionData.name,
      sectionData.start_page,
      sectionData.end_page,
      sectionData.pdf_url,
      sectionData.text_url,
      sectionData.metadata
    ];

    const result = await this.query(query, values);
    return {
      section_id: result.rows[0].section_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  /**
   * Upsert Congressional Record article
   * @param {Object} articleData - Article data
   * @returns {Object} Upsert result
   */
  async upsertCongressionalRecordArticle(articleData) {
    // Since there's no unique constraint, we need to check manually first
    // Use text_url for better uniqueness detection to avoid losing legitimate duplicates
    const checkQuery = `
      SELECT article_id FROM congressional_record_article 
      WHERE section_id = $1 AND title = $2 AND start_page = $3 
      AND (text_url = $4 OR (text_url IS NULL AND $4 IS NULL))
      LIMIT 1`;

    const existing = await this.query(checkQuery, [
      articleData.section_id,
      articleData.title,
      articleData.start_page,
      articleData.text_url || null
    ]);

    if (existing.rows.length > 0) {
      // Update existing article
      const updateQuery = `
        UPDATE congressional_record_article SET
          end_page = $1,
          pdf_url = $2,
          text_url = $3,
          content_text = $4,
          word_count = $5,
          character_count = $6,
          metadata = $7,
          updated_at = CURRENT_TIMESTAMP
        WHERE article_id = $8
        RETURNING article_id`;

      const result = await this.query(updateQuery, [
        articleData.end_page,
        articleData.pdf_url,
        articleData.text_url,
        articleData.content_text,
        articleData.word_count,
        articleData.character_count,
        articleData.metadata,
        existing.rows[0].article_id
      ]);

      return {
        article_id: result.rows[0].article_id,
        inserted: false,
        updated: true
      };
    } else {
      // Insert new article
      const insertQuery = `
        INSERT INTO congressional_record_article (
          section_id, title, start_page, end_page, pdf_url, text_url,
          content_text, word_count, character_count, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING article_id`;

      const values = [
        articleData.section_id,
        articleData.title,
        articleData.start_page,
        articleData.end_page,
        articleData.pdf_url,
        articleData.text_url,
        articleData.content_text,
        articleData.word_count,
        articleData.character_count,
        articleData.metadata
      ];

      const result = await this.query(insertQuery, values);
      return {
        article_id: result.rows[0].article_id,
        inserted: true,
        updated: false
      };
    }
  }

  /**
   * Upsert Congressional Record reference
   * @param {Object} referenceData - Reference data
   * @returns {Object} Upsert result
   */
  async upsertCongressionalRecordReference(referenceData) {
    const query = `
      INSERT INTO action_congressional_record_reference (
        action_id, bill_id, reference_text, chamber, start_page, end_page,
        issue_id, section_id, article_id, is_resolved, resolution_confidence, 
        resolution_notes, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (action_id, reference_text) DO UPDATE SET
        chamber = EXCLUDED.chamber,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        issue_id = EXCLUDED.issue_id,
        section_id = EXCLUDED.section_id,
        article_id = EXCLUDED.article_id,
        is_resolved = EXCLUDED.is_resolved,
        resolution_confidence = EXCLUDED.resolution_confidence,
        resolution_notes = EXCLUDED.resolution_notes,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING reference_id, (xmax = 0) AS inserted`;

    const values = [
      referenceData.action_id,
      referenceData.bill_id,
      referenceData.reference_text,
      referenceData.chamber,
      referenceData.start_page,
      referenceData.end_page,
      referenceData.issue_id || null,
      referenceData.section_id || null,
      referenceData.article_id || null,
      referenceData.is_resolved || false,
      referenceData.resolution_confidence || null,
      referenceData.resolution_notes || null,
      referenceData.metadata
    ];

    const result = await this.query(query, values);
    return {
      reference_id: result.rows[0].reference_id,
      inserted: result.rows[0].inserted,
      updated: !result.rows[0].inserted
    };
  }

  /**
   * Find articles by page range using database function
   * @param {string} chamber - Chamber code (H, S, E, D)
   * @param {string} startPage - Start page
   * @param {string} endPage - End page (optional)
   * @param {Date} issueDate - Issue date (optional)
   * @returns {Array} Matching articles
   */
  async findArticlesByPageRange(chamber, startPage, endPage = null, issueDate = null) {
    const query = `SELECT * FROM find_articles_by_page_range($1, $2, $3, $4)`;
    const values = [chamber, startPage, endPage, issueDate];
    
    const result = await this.query(query, values);
    return result.rows;
  }

  /**
   * Get unresolved Congressional Record references
   * @param {number} limit - Maximum number of references to return
   * @returns {Array} Unresolved references
   */
  async getUnresolvedCRReferences(limit = 1000) {
    const query = `
      SELECT 
        r.*,
        a.text as action_text,
        a.action_date,
        a.bill_id
      FROM action_congressional_record_reference r
      JOIN action a ON r.action_id = a.action_id
      WHERE r.is_resolved = false
      ORDER BY a.action_date DESC
      LIMIT $1`;

    const result = await this.query(query, [limit]);
    return result.rows;
  }

  /**
   * Update Congressional Record reference resolution
   * @param {number} referenceId - Reference ID
   * @param {Object} resolutionData - Resolution data
   * @returns {Object} Update result
   */
  async updateCRReferenceResolution(referenceId, resolutionData) {
    const query = `
      UPDATE action_congressional_record_reference 
      SET 
        issue_id = $1,
        section_id = $2,
        article_id = $3,
        is_resolved = $4,
        resolution_confidence = $5,
        resolution_notes = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE reference_id = $7
      RETURNING reference_id`;

    const values = [
      resolutionData.issue_id || null,
      resolutionData.section_id || null,
      resolutionData.article_id || null,
      resolutionData.is_resolved || false,
      resolutionData.resolution_confidence || null,
      resolutionData.resolution_notes || null,
      referenceId
    ];

    const result = await this.query(query, values);
    return {
      success: result.rows.length > 0,
      reference_id: result.rows[0]?.reference_id
    };
  }

  /**
   * Get Congressional Record statistics
   * @returns {Object} CR statistics
   */
  async getCongressionalRecordStats() {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM congressional_record_volume) as total_volumes,
        (SELECT COUNT(*) FROM congressional_record_issue) as total_issues,
        (SELECT COUNT(*) FROM congressional_record_section) as total_sections,
        (SELECT COUNT(*) FROM congressional_record_article) as total_articles,
        (SELECT COUNT(*) FROM congressional_record_article WHERE content_text IS NOT NULL) as articles_with_content,
        (SELECT COUNT(*) FROM action_congressional_record_reference) as total_references,
        (SELECT COUNT(*) FROM action_congressional_record_reference WHERE is_resolved = true) as resolved_references,
        (SELECT COUNT(DISTINCT congress) FROM congressional_record_issue) as congresses_covered,
        (SELECT MIN(issue_date) FROM congressional_record_issue) as earliest_date,
        (SELECT MAX(issue_date) FROM congressional_record_issue) as latest_date`;

    const result = await this.query(query);
    return result.rows[0];
  }

  async testConnection() {
    try {
      const result = await this.query('SELECT NOW()');
      return true;
    } catch (error) {
      logger.error('Database connection test failed', error);
      return false;
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = DatabaseService;