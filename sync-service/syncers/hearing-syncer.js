const CongressClient = require('../lib/congress-client');
const DatabaseService = require('../lib/database');
const logger = require('../lib/logger');
const config = require('../config');

// Validation severity levels
const VALIDATION_SEVERITY = {
  CRITICAL: 'critical',    // Will fail sync if validation fails
  IMPORTANT: 'important',  // Will log warning but continue
  OPTIONAL: 'optional'     // Will log info but continue
};

// Field validation configuration for hearings
const FIELD_VALIDATION_CONFIG = {
  // Critical fields - sync will fail if these are invalid
  jacketNumber: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'string', required: true },
  congress: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'number', required: true, min: 93, max: 125 },
  
  // Important fields - will warn but continue
  chamber: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: true, enum: ['House', 'Senate', 'NoChamber'] },
  title: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: false },
  citation: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: false },
  updateDate: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'date', required: false },
  
  // Optional fields - will info log if issues found
  number: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'string', required: false },
  part: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'string', required: false },
  libraryOfCongressIdentifier: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'string', required: false },
  committees: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false },
  dates: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false },
  formats: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false },
  associatedMeeting: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'object', required: false }
};

class HearingSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      committeesLinked: 0,
      formatsAdded: 0,
      datesAdded: 0,
      meetingsLinked: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };
  }

  /**
   * Validates a field based on its configuration
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateField(value, config, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };
    
    // Check if required field is missing
    if (config.required && (value === null || value === undefined || value === '')) {
      result.isValid = false;
      result.errors.push(`Required field '${fieldName}' is missing or empty`);
      return result;
    }
    
    // Skip further validation if field is optional and missing
    if (!config.required && (value === null || value === undefined || value === '')) {
      return result;
    }
    
    // Type validation
    if (config.type === 'string' && typeof value !== 'string') {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be a string, got ${typeof value}`);
      return result;
    }
    
    if (config.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be a number, got ${typeof value}`);
      return result;
    }
    
    if (config.type === 'array' && !Array.isArray(value)) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be an array, got ${typeof value}`);
      return result;
    }
    
    if (config.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be an object, got ${typeof value}`);
      return result;
    }
    
    // Enum validation
    if (config.enum && !config.enum.includes(value)) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' value '${value}' not in allowed values: ${config.enum.join(', ')}`);
    }
    
    // Range validation for numbers
    if (config.type === 'number') {
      if (config.min && value < config.min) {
        result.warnings.push(`Field '${fieldName}' value ${value} is below minimum ${config.min}`);
      }
      if (config.max && value > config.max) {
        result.warnings.push(`Field '${fieldName}' value ${value} is above maximum ${config.max}`);
      }
    }
    
    return result;
  }

  /**
   * Validates hearing data against the configuration
   * @param {Object} hearing - The hearing data to validate
   * @returns {Object} Validation summary
   */
  validateHearingData(hearing) {
    const summary = { 
      isValid: true, 
      criticalErrors: [], 
      warnings: [], 
      shouldSkip: false 
    };
    
    for (const [fieldName, config] of Object.entries(FIELD_VALIDATION_CONFIG)) {
      const value = hearing[fieldName];
      const validation = this.validateField(value, config, fieldName);
      
      if (!validation.isValid) {
        if (config.severity === VALIDATION_SEVERITY.CRITICAL) {
          summary.isValid = false;
          summary.criticalErrors.push(...validation.errors);
        } else {
          summary.warnings.push(...validation.errors);
        }
      }
      
      summary.warnings.push(...validation.warnings);
    }
    
    // If critical validation fails, mark for skipping
    if (!summary.isValid) {
      summary.shouldSkip = true;
    }
    
    return summary;
  }

  /**
   * Transforms API hearing data to database format
   * @param {Object} apiHearing - Raw hearing data from Congress API
   * @returns {Object} Transformed hearing data
   */
  transformHearingData(apiHearing) {
    // Handle potential nested structure differences between list and item endpoints
    const hearing = apiHearing.hearing || apiHearing;
    
    return {
      jacketNumber: hearing.jacketNumber?.toString() || hearing.jacketNumber,
      congress: parseInt(hearing.congress),
      chamber: hearing.chamber,
      number: hearing.number || null,
      part: hearing.part || null,
      title: hearing.title || null,
      citation: hearing.citation || null,
      libraryOfCongressIdentifier: hearing.libraryOfCongressIdentifier || null,
      updateDate: hearing.updateDate,
      committees: hearing.committees || [],
      dates: hearing.dates || [],
      formats: hearing.formats || [],
      associatedMeeting: hearing.associatedMeeting || null
    };
  }

  /**
   * Processes committee associations for a hearing
   * @param {number} hearingId - The hearing surrogate ID
   * @param {Array} committees - Array of committee data
   */
  async processHearingCommittees(hearingId, committees) {
    if (!committees || !Array.isArray(committees)) return;

    // Ensure committees is always an array (API sometimes returns single object)
    const committeeList = Array.isArray(committees) ? committees : [committees];

    for (const committee of committeeList) {
      try {
        await this.db.query(`
          INSERT INTO hearing_committee (hearing_id, committee_system_code, committee_name, committee_api_url)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT ON CONSTRAINT uq_hearing_committee_association
          DO UPDATE SET
            committee_name = EXCLUDED.committee_name,
            committee_api_url = EXCLUDED.committee_api_url
        `, [
          hearingId,
          committee.systemCode,
          committee.name,
          committee.url
        ]);

        this.stats.committeesLinked++;
      } catch (error) {
        logger.error('Failed to process hearing committee', {
          hearingId,
          committee: committee.systemCode,
          error: error.message
        });
      }
    }
  }

  /**
   * Processes hearing dates
   * @param {number} hearingId - The hearing surrogate ID
   * @param {Array} dates - Array of hearing dates
   */
  async processHearingDates(hearingId, dates) {
    if (!dates || !Array.isArray(dates)) return;

    // Ensure dates is always an array
    const dateList = Array.isArray(dates) ? dates : [dates];

    for (const dateItem of dateList) {
      try {
        const hearingDate = dateItem.date || dateItem;

        await this.db.query(`
          INSERT INTO hearing_date (hearing_id, date)
          VALUES ($1, $2)
          ON CONFLICT ON CONSTRAINT uq_hearing_date DO NOTHING
        `, [hearingId, hearingDate]);

        this.stats.datesAdded++;
      } catch (error) {
        logger.error('Failed to process hearing date', {
          hearingId,
          date: dateItem,
          error: error.message
        });
      }
    }
  }

  /**
   * Processes hearing formats (transcripts)
   * @param {number} hearingId - The hearing surrogate ID
   * @param {Array} formats - Array of format data
   */
  async processHearingFormats(hearingId, formats) {
    if (!formats || !Array.isArray(formats)) return;

    // Ensure formats is always an array
    const formatList = Array.isArray(formats) ? formats : [formats];

    for (const format of formatList) {
      try {
        await this.db.query(`
          INSERT INTO hearing_format (hearing_id, format_type, format_url)
          VALUES ($1, $2, $3)
          ON CONFLICT ON CONSTRAINT uq_hearing_format_type
          DO UPDATE SET format_url = EXCLUDED.format_url
        `, [
          hearingId,
          format.type,
          format.url
        ]);

        this.stats.formatsAdded++;
      } catch (error) {
        logger.error('Failed to process hearing format', {
          hearingId,
          format: format.type,
          error: error.message
        });
      }
    }
  }

  /**
   * Processes associated meeting data
   * @param {number} hearingId - The hearing surrogate ID
   * @param {Object} meeting - Meeting data
   */
  async processAssociatedMeeting(hearingId, meeting) {
    if (!meeting || typeof meeting !== 'object') return;

    try {
      await this.db.query(`
        INSERT INTO hearing_meeting (hearing_id, meeting_event_id, meeting_api_url)
        VALUES ($1, $2, $3)
        ON CONFLICT ON CONSTRAINT uq_hearing_meeting_association
        DO UPDATE SET
          meeting_event_id = EXCLUDED.meeting_event_id,
          meeting_api_url = EXCLUDED.meeting_api_url
      `, [
        hearingId,
        meeting.eventId || meeting.eventID,
        meeting.url || meeting.URL
      ]);

      this.stats.meetingsLinked++;
    } catch (error) {
      logger.error('Failed to process associated meeting', {
        hearingId,
        meeting: meeting.eventID,
        error: error.message
      });
    }
  }

  /**
   * Inserts or updates a single hearing record
   * @param {Object} hearingData - Transformed hearing data
   * @returns {boolean} Whether the operation was successful
   */
  async upsertHearing(hearingData) {
    try {
      // First, upsert the main hearing record
      // Uses composite unique constraint on (jacket_number, chamber)
      const result = await this.db.query(`
        INSERT INTO hearing (
          jacket_number, congress_id, chamber, number, part, title,
          citation, library_of_congress_identifier, api_update_date,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT ON CONSTRAINT uq_hearing_jacket_chamber
        DO UPDATE SET
          congress_id = EXCLUDED.congress_id,
          number = EXCLUDED.number,
          part = EXCLUDED.part,
          title = EXCLUDED.title,
          citation = EXCLUDED.citation,
          library_of_congress_identifier = EXCLUDED.library_of_congress_identifier,
          api_update_date = EXCLUDED.api_update_date,
          updated_at = NOW()
        RETURNING hearing_id,
          CASE WHEN created_at = updated_at THEN 'INSERT' ELSE 'UPDATE' END as operation
      `, [
        hearingData.jacketNumber,
        hearingData.congress,
        hearingData.chamber || null,
        hearingData.number,
        hearingData.part,
        hearingData.title,
        hearingData.citation,
        hearingData.libraryOfCongressIdentifier,
        hearingData.updateDate
      ]);

      const hearingId = result.rows[0]?.hearing_id;
      const operation = result.rows[0]?.operation;

      if (operation === 'INSERT') {
        this.stats.inserted++;
      } else {
        this.stats.updated++;
      }

      // Process associated data using the hearing_id
      await this.processHearingCommittees(hearingId, hearingData.committees);
      await this.processHearingDates(hearingId, hearingData.dates);
      await this.processHearingFormats(hearingId, hearingData.formats);

      if (hearingData.associatedMeeting) {
        await this.processAssociatedMeeting(hearingId, hearingData.associatedMeeting);
      }

      return true;
    } catch (error) {
      logger.error('Failed to upsert hearing', {
        jacketNumber: hearingData.jacketNumber,
        chamber: hearingData.chamber,
        error: error.message,
        stack: error.stack
      });
      this.stats.failed++;
      this.stats.errors.push({
        jacketNumber: hearingData.jacketNumber,
        chamber: hearingData.chamber,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Fetches detailed hearing data for a specific hearing
   * @param {number} congress - Congress number
   * @param {string} chamber - Chamber (house/senate)
   * @param {string} jacketNumber - Hearing jacket number
   * @returns {Object|null} Detailed hearing data
   */
  async fetchHearingDetails(congress, chamber, jacketNumber) {
    try {
      const endpoint = `/hearing/${congress}/${chamber.toLowerCase()}/${jacketNumber}`;
      const response = await this.client.makeRequest(endpoint);
      return response?.hearing || null;
    } catch (error) {
      logger.error('Failed to fetch hearing details', {
        congress,
        chamber,
        jacketNumber,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Syncs hearings for a specific congress
   * @param {number} congress - Congress number
   * @param {Object} options - Sync options
   * @returns {Object} Sync results
   */
  async syncHearingsByCongress(congress, options = {}) {
    const {
      limit = config.sync.batchSizes.hearings,
      fromDate = null,
      toDate = null,
      offset = 0
    } = options;

    // Reset stats at the start of sync
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      committeesLinked: 0,
      formatsAdded: 0,
      datesAdded: 0,
      meetingsLinked: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };

    logger.info('Starting hearing sync', { congress, limit, fromDate, toDate });

    try {
      let allHearings = [];
      let currentOffset = offset;
      const pageSize = Math.min(limit, 250); // API max per request
      
      // Step 1: Get list of all hearings for the congress (all chambers)
      const endpoint = `/hearing/${congress}`;

      while (allHearings.length < limit) {
        const params = { 
          offset: currentOffset,
          limit: pageSize
        };

        // Add date filters if specified
        if (fromDate) params.fromDateTime = fromDate;
        if (toDate) params.toDateTime = toDate;

        logger.info('Fetching hearing list', { 
          congress, 
          offset: currentOffset, 
          pageSize,
          fromDate,
          toDate 
        });

        const response = await this.client.makeRequest(endpoint, params);
        const hearings = response?.hearings || [];
        
        if (!Array.isArray(hearings) || hearings.length === 0) {
          logger.info('No more hearings found', { 
            currentOffset, 
            totalProcessed: allHearings.length 
          });
          break; // No more hearings
        }

        logger.info('Retrieved hearing list page', {
          congress,
          hearingsInPage: hearings.length,
          totalSoFar: allHearings.length,
          totalAvailable: response.pagination?.count || 'unknown'
        });

        // Step 2: Process each hearing from the list
        for (const hearingListItem of hearings) {
          if (allHearings.length >= limit) break;
          
          try {
            // Extract chamber and jacket number from list item
            const chamber = hearingListItem.chamber?.toLowerCase() || 'house';
            const jacketNumber = hearingListItem.jacketNumber;
            
            logger.debug('Fetching hearing details', { 
              jacketNumber, 
              chamber,
              congress 
            });
            
            // Step 3: Fetch detailed hearing data
            const detailedHearing = await this.fetchHearingDetails(
              congress, 
              chamber,
              jacketNumber
            );
            
            if (detailedHearing) {
              // Transform and validate the hearing data
              const transformedHearing = this.transformHearingData(detailedHearing);
              const validation = this.validateHearingData(transformedHearing);
              
              if (validation.shouldSkip) {
                logger.warn('Skipping invalid hearing', {
                  jacketNumber: transformedHearing.jacketNumber,
                  errors: validation.criticalErrors
                });
                this.stats.validationErrors++;
                continue;
              }
              
              if (validation.warnings.length > 0) {
                logger.debug('Hearing validation warnings', {
                  jacketNumber: transformedHearing.jacketNumber,
                  warnings: validation.warnings
                });
                this.stats.validationWarnings++;
              }
              
              // Step 4: Process the hearing
              const success = await this.upsertHearing(transformedHearing);
              if (success) {
                allHearings.push(transformedHearing);
                
                // Log progress every 10 hearings
                if (allHearings.length % 10 === 0) {
                  logger.info('Hearing sync progress', {
                    congress,
                    processed: allHearings.length,
                    inserted: this.stats.inserted,
                    updated: this.stats.updated,
                    failed: this.stats.failed
                  });
                }
              }
            } else {
              logger.warn('Failed to fetch hearing details', {
                jacketNumber,
                chamber,
                congress
              });
            }
            
          } catch (hearingError) {
            logger.error('Error processing individual hearing', {
              jacketNumber: hearingListItem.jacketNumber,
              chamber: hearingListItem.chamber,
              error: hearingError.message
            });
            this.stats.failed++;
            continue;
          }
        }

        currentOffset += hearings.length;
        
        // If we got fewer results than requested, we're at the end
        if (hearings.length < pageSize) {
          logger.info('Reached end of hearing list', {
            lastPageSize: hearings.length,
            pageSize,
            totalProcessed: allHearings.length
          });
          break;
        }
      }

      logger.info('Hearing sync completed', {
        congress,
        processed: allHearings.length,
        stats: this.stats
      });

      return {
        success: true,
        congress,
        processed: allHearings.length,
        stats: { ...this.stats }
      };

    } catch (error) {
      logger.error('Hearing sync failed', {
        congress,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        congress,
        error: error.message,
        stats: { ...this.stats }
      };
    }
  }

  /**
   * Syncs recent hearings across current congress
   * @param {Object} options - Sync options
   * @returns {Object} Sync results
   */
  async syncRecentHearings(options = {}) {
    const {
      days = config.sync.incrementalDays.hearings,
      limit = config.sync.batchSizes.hearings * 2 // Both chambers
    } = options;

    // Reset stats at the start of sync
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      committeesLinked: 0,
      formatsAdded: 0,
      datesAdded: 0,
      meetingsLinked: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };

    try {
      // Get current congress
      const currentCongress = await this.client.getCurrentCongress();
      
      // Calculate from date
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      // Use full ISO-8601 (YYYY-MM-DDThh:mm:ssZ) so the Congress.gov fromDateTime
      // filter is actually honored; a date-only value is silently ignored here.
      const fromDateString = fromDate.toISOString().split('.')[0] + 'Z';

      logger.info('Starting recent hearings sync', {
        congress: currentCongress,
        days,
        fromDate: fromDateString,
        limit
      });

      const results = {
        success: true,
        congress: currentCongress,
        chambers: {},
        totalProcessed: 0,
        combinedStats: { ...this.stats }
      };

      // Sync all hearings from all chambers in one call
      logger.info('Syncing recent hearings for all chambers');
      
      const syncResult = await this.syncHearingsByCongress(currentCongress, {
        fromDate: fromDateString,
        limit: limit
      });
      
      results.chambers['all'] = syncResult;
      results.totalProcessed += syncResult.processed || 0;
      
      if (!syncResult.success) {
        results.success = false;
      }

      // Update combined stats
      results.combinedStats = { ...this.stats };

      // Update sync status on success
      await this.updateSyncStatus('success', {
        congress: currentCongress,
        days,
        fromDate: fromDateString,
        totalProcessed: results.totalProcessed,
        stats: results.combinedStats
      });

      logger.info('Recent hearings sync completed', {
        success: results.success,
        totalProcessed: results.totalProcessed,
        stats: results.combinedStats
      });

      return results;

    } catch (error) {
      // Update sync status on failure
      await this.updateSyncStatus('failure', {
        error: error.message,
        stats: { ...this.stats }
      });

      logger.error('Recent hearings sync failed', {
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        stats: { ...this.stats }
      };
    }
  }

  /**
   * Performs a comprehensive hearing sync across multiple congresses
   * @param {Object} options - Sync options
   * @returns {Object} Sync results
   */
  async syncAllHearings(options = {}) {
    const {
      congresses = [await this.client.getCurrentCongress()],
      limit = config.sync.batchSizes.hearings
    } = options;

    // Reset stats at the start of sync
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      committeesLinked: 0,
      formatsAdded: 0,
      datesAdded: 0,
      meetingsLinked: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };

    logger.info('Starting comprehensive hearing sync', { congresses, limit });

    const results = {
      success: true,
      congresses: {},
      totalProcessed: 0,
      overallStats: { ...this.stats }
    };

    try {
      for (const congress of congresses) {
        logger.info(`Syncing hearings for Congress ${congress}`);
        
        const congressResult = await this.syncHearingsByCongress(congress, { limit });
        
        results.congresses[congress] = {
          processed: congressResult.processed || 0,
          success: congressResult.success,
          stats: congressResult.stats
        };
        
        results.totalProcessed += congressResult.processed || 0;
        
        if (!congressResult.success) {
          results.success = false;
        }
        
        // Delay between congresses to be respectful to API
        if (congresses.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      results.overallStats = { ...this.stats };

      logger.info('Comprehensive hearing sync completed', {
        success: results.success,
        totalProcessed: results.totalProcessed,
        stats: results.overallStats
      });

      return results;

    } catch (error) {
      logger.error('Comprehensive hearing sync failed', {
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message,
        stats: { ...this.stats }
      };
    }
  }

  /**
   * Updates sync status in database
   * @param {string} statusType - Type of sync status (success/failure)
   * @param {Object} metadata - Additional metadata
   */
  async updateSyncStatus(statusType, metadata = {}) {
    try {
      const isSuccess = statusType === 'success' || statusType.includes('completed');
      
      await this.db.query(`
        INSERT INTO sync_status (
          entity_type, 
          last_sync_at, 
          last_successful_sync,
          records_synced,
          records_failed,
          sync_metadata
        )
        VALUES ('hearings', NOW(), $1, $2, $3, $4)
        ON CONFLICT (entity_type, last_sync_at)
        DO UPDATE SET
          last_successful_sync = CASE WHEN $1 IS NOT NULL THEN $1 ELSE sync_status.last_successful_sync END,
          records_synced = EXCLUDED.records_synced,
          records_failed = EXCLUDED.records_failed,
          sync_metadata = EXCLUDED.sync_metadata
      `, [
        isSuccess ? new Date() : null,
        this.stats.inserted + this.stats.updated,
        this.stats.failed,
        JSON.stringify(metadata)
      ]);
    } catch (error) {
      logger.error('Failed to update sync status', { error: error.message });
    }
  }

  /**
   * Closes database connection
   */
  async close() {
    await this.db.close();
  }
}

module.exports = HearingSyncer;