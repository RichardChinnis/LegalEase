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

// Field validation configuration for committee meetings
const FIELD_VALIDATION_CONFIG = {
  // Critical fields - sync will fail if these are invalid
  eventId: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'string', required: true },
  congress: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'number', required: true, min: 93, max: 125 },
  chamber: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'string', required: true, enum: ['House', 'Senate'] },

  // Important fields - will warn but continue
  title: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: false },
  date: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: false },
  type: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: false },

  // Optional fields - will info log if issues found
  meetingStatus: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'string', required: false },
  location: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'object', required: false },
  committees: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false },
  relatedItems: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'object', required: false },
  meetingDocuments: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false },
  videos: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false }
};

class CommitteeMeetingSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      billsLinked: 0,
      committeesLinked: 0,
      documentsAdded: 0,
      videosAdded: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };
  }

  /**
   * Validates a field based on its configuration
   */
  validateField(value, fieldConfig, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };

    // Check if required field is missing
    if (fieldConfig.required && (value === null || value === undefined || value === '')) {
      result.isValid = false;
      result.errors.push(`Required field '${fieldName}' is missing or empty`);
      return result;
    }

    // Skip further validation if field is optional and missing
    if (!fieldConfig.required && (value === null || value === undefined || value === '')) {
      return result;
    }

    // Type validation
    if (fieldConfig.type === 'string' && typeof value !== 'string') {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be a string, got ${typeof value}`);
      return result;
    }

    if (fieldConfig.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be a number, got ${typeof value}`);
      return result;
    }

    if (fieldConfig.type === 'array' && !Array.isArray(value)) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be an array, got ${typeof value}`);
      return result;
    }

    if (fieldConfig.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be an object, got ${typeof value}`);
      return result;
    }

    // Enum validation
    if (fieldConfig.enum && !fieldConfig.enum.includes(value)) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' value '${value}' not in allowed values: ${fieldConfig.enum.join(', ')}`);
    }

    // Range validation for numbers
    if (fieldConfig.type === 'number') {
      if (fieldConfig.min && value < fieldConfig.min) {
        result.warnings.push(`Field '${fieldName}' value ${value} is below minimum ${fieldConfig.min}`);
      }
      if (fieldConfig.max && value > fieldConfig.max) {
        result.warnings.push(`Field '${fieldName}' value ${value} is above maximum ${fieldConfig.max}`);
      }
    }

    return result;
  }

  /**
   * Validates meeting data against the configuration
   */
  validateMeetingData(meeting) {
    const summary = {
      isValid: true,
      criticalErrors: [],
      warnings: [],
      shouldSkip: false
    };

    for (const [fieldName, fieldConfig] of Object.entries(FIELD_VALIDATION_CONFIG)) {
      const value = meeting[fieldName];
      const validation = this.validateField(value, fieldConfig, fieldName);

      if (!validation.isValid) {
        if (fieldConfig.severity === VALIDATION_SEVERITY.CRITICAL) {
          summary.isValid = false;
          summary.criticalErrors.push(...validation.errors);
        } else {
          summary.warnings.push(...validation.errors);
        }
      }

      summary.warnings.push(...validation.warnings);
    }

    if (!summary.isValid) {
      summary.shouldSkip = true;
    }

    return summary;
  }

  /**
   * Transforms API meeting data to database format
   */
  transformMeetingData(apiMeeting) {
    // Handle potential nested structure
    const meeting = apiMeeting.committeeMeeting || apiMeeting;

    return {
      eventId: meeting.eventId?.toString() || meeting.eventId,
      congress: parseInt(meeting.congress),
      chamber: meeting.chamber,
      title: meeting.title || null,
      date: meeting.date || null,
      type: meeting.type || null,
      meetingStatus: meeting.meetingStatus || null,
      locationBuilding: meeting.location?.building || null,
      locationRoom: meeting.location?.room || null,
      updateDate: meeting.updateDate || null,
      committees: meeting.committees || [],
      relatedBills: meeting.relatedItems?.bills || [],
      meetingDocuments: meeting.meetingDocuments || [],
      videos: meeting.videos || []
    };
  }

  /**
   * Processes related bills for a meeting (KEY for bill linkage)
   */
  async processRelatedBills(meetingId, bills) {
    if (!bills || !Array.isArray(bills) || bills.length === 0) return;

    for (const bill of bills) {
      try {
        // Extract bill info from API structure
        const congress = bill.congress;
        const billType = bill.type?.toLowerCase() || '';
        const billNumber = bill.number?.toString() || '';

        if (!congress || !billType || !billNumber) {
          logger.debug('Skipping bill with missing info', { bill });
          continue;
        }

        await this.db.query(`
          INSERT INTO committee_meeting_bill (
            meeting_id, congress, bill_type, bill_number, bill_api_url
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT ON CONSTRAINT uq_committee_meeting_bill_association
          DO UPDATE SET
            bill_api_url = EXCLUDED.bill_api_url,
            updated_at = NOW()
        `, [
          meetingId,
          congress,
          billType.toUpperCase(),
          billNumber,
          bill.url || null
        ]);

        this.stats.billsLinked++;
      } catch (error) {
        logger.error('Failed to process meeting bill', {
          meetingId,
          bill,
          error: error.message
        });
      }
    }
  }

  /**
   * Processes committee associations for a meeting
   */
  async processCommittees(meetingId, committees) {
    if (!committees || !Array.isArray(committees) || committees.length === 0) return;

    for (const committee of committees) {
      try {
        // Skip if no committee name
        if (!committee.name) {
          logger.debug('Skipping committee with no name', { meetingId, systemCode: committee.systemCode });
          continue;
        }

        await this.db.query(`
          INSERT INTO committee_meeting_committee (
            meeting_id, committee_name, committee_system_code, committee_api_url
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT ON CONSTRAINT uq_committee_meeting_committee_association
          DO UPDATE SET
            committee_name = EXCLUDED.committee_name,
            committee_api_url = EXCLUDED.committee_api_url,
            updated_at = NOW()
        `, [
          meetingId,
          committee.name,
          committee.systemCode || null,
          committee.url || null
        ]);

        this.stats.committeesLinked++;
      } catch (error) {
        logger.error('Failed to process meeting committee', {
          meetingId,
          committee: committee.systemCode,
          error: error.message
        });
      }
    }
  }

  /**
   * Processes meeting documents
   */
  async processMeetingDocuments(meetingId, documents) {
    if (!documents || !Array.isArray(documents) || documents.length === 0) return;

    for (const doc of documents) {
      try {
        await this.db.query(`
          INSERT INTO committee_meeting_document (
            meeting_id, document_type, description
          )
          VALUES ($1, $2, $3)
          ON CONFLICT ON CONSTRAINT uq_committee_meeting_document
          DO NOTHING
        `, [
          meetingId,
          doc.documentType || 'Unknown',
          doc.description || null
        ]);

        this.stats.documentsAdded++;
      } catch (error) {
        logger.error('Failed to process meeting document', {
          meetingId,
          documentType: doc.documentType,
          error: error.message
        });
      }
    }
  }

  /**
   * Processes meeting videos
   */
  async processMeetingVideos(meetingId, videos) {
    if (!videos || !Array.isArray(videos) || videos.length === 0) return;

    for (const video of videos) {
      try {
        if (!video.url) continue;

        await this.db.query(`
          INSERT INTO committee_meeting_video (
            meeting_id, video_name, video_url
          )
          VALUES ($1, $2, $3)
          ON CONFLICT ON CONSTRAINT uq_committee_meeting_video_url
          DO UPDATE SET
            video_name = EXCLUDED.video_name,
            updated_at = NOW()
        `, [
          meetingId,
          video.name || null,
          video.url
        ]);

        this.stats.videosAdded++;
      } catch (error) {
        logger.error('Failed to process meeting video', {
          meetingId,
          videoUrl: video.url,
          error: error.message
        });
      }
    }
  }

  /**
   * Inserts or updates a single meeting record
   */
  async upsertMeeting(meetingData) {
    try {
      const result = await this.db.query(`
        INSERT INTO committee_meeting (
          event_id, congress_id, chamber, title, meeting_date,
          meeting_type, meeting_status, location_building, location_room,
          api_update_date, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT ON CONSTRAINT uq_committee_meeting_event
        DO UPDATE SET
          title = EXCLUDED.title,
          meeting_date = EXCLUDED.meeting_date,
          meeting_type = EXCLUDED.meeting_type,
          meeting_status = EXCLUDED.meeting_status,
          location_building = EXCLUDED.location_building,
          location_room = EXCLUDED.location_room,
          api_update_date = EXCLUDED.api_update_date,
          updated_at = NOW()
        RETURNING meeting_id,
          CASE WHEN created_at = updated_at THEN 'INSERT' ELSE 'UPDATE' END as operation
      `, [
        meetingData.eventId,
        meetingData.congress,
        meetingData.chamber,
        meetingData.title,
        meetingData.date,
        meetingData.type,
        meetingData.meetingStatus,
        meetingData.locationBuilding,
        meetingData.locationRoom,
        meetingData.updateDate
      ]);

      const meetingId = result.rows[0]?.meeting_id;
      const operation = result.rows[0]?.operation;

      if (operation === 'INSERT') {
        this.stats.inserted++;
      } else {
        this.stats.updated++;
      }

      // Process related data (bills are KEY for enriching Legislative History)
      await this.processRelatedBills(meetingId, meetingData.relatedBills);
      await this.processCommittees(meetingId, meetingData.committees);
      await this.processMeetingDocuments(meetingId, meetingData.meetingDocuments);
      await this.processMeetingVideos(meetingId, meetingData.videos);

      return true;
    } catch (error) {
      logger.error('Failed to upsert meeting', {
        eventId: meetingData.eventId,
        chamber: meetingData.chamber,
        error: error.message,
        stack: error.stack
      });
      this.stats.failed++;
      this.stats.errors.push({
        eventId: meetingData.eventId,
        chamber: meetingData.chamber,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Fetches detailed meeting data for a specific meeting
   */
  async fetchMeetingDetails(congress, chamber, eventId) {
    try {
      const endpoint = `/committee-meeting/${congress}/${chamber.toLowerCase()}/${eventId}`;
      const response = await this.client.makeRequest(endpoint);
      return response?.committeeMeeting || null;
    } catch (error) {
      logger.error('Failed to fetch meeting details', {
        congress,
        chamber,
        eventId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Syncs committee meetings for a specific congress and chamber
   */
  async syncMeetingsByCongressAndChamber(congress, chamber, options = {}) {
    const {
      limit = config.sync.batchSizes.hearings, // Reuse hearings batch size
      fromDate = null,
      offset = 0
    } = options;

    logger.info('Syncing committee meetings', { congress, chamber, limit, fromDate });

    try {
      let allMeetings = [];
      let currentOffset = offset;
      const pageSize = Math.min(limit, 250);

      const endpoint = `/committee-meeting/${congress}/${chamber.toLowerCase()}`;

      while (allMeetings.length < limit) {
        const params = {
          offset: currentOffset,
          limit: pageSize
        };

        if (fromDate) params.fromDateTime = fromDate;

        logger.info('Fetching meeting list', {
          congress,
          chamber,
          offset: currentOffset,
          pageSize
        });

        const response = await this.client.makeRequest(endpoint, params);
        const meetings = response?.committeeMeetings || [];

        if (!Array.isArray(meetings) || meetings.length === 0) {
          logger.info('No more meetings found', {
            currentOffset,
            totalProcessed: allMeetings.length
          });
          break;
        }

        logger.info('Retrieved meeting list page', {
          meetingsInPage: meetings.length,
          totalSoFar: allMeetings.length,
          totalAvailable: response.pagination?.count || 'unknown'
        });

        // Process each meeting from the list
        for (const meetingListItem of meetings) {
          if (allMeetings.length >= limit) break;

          try {
            const eventId = meetingListItem.eventId;

            logger.debug('Fetching meeting details', {
              eventId,
              chamber,
              congress
            });

            // Fetch detailed meeting data
            const detailedMeeting = await this.fetchMeetingDetails(
              congress,
              chamber,
              eventId
            );

            if (detailedMeeting) {
              // Transform and validate
              const transformedMeeting = this.transformMeetingData(detailedMeeting);
              const validation = this.validateMeetingData(transformedMeeting);

              if (validation.shouldSkip) {
                logger.warn('Skipping invalid meeting', {
                  eventId: transformedMeeting.eventId,
                  errors: validation.criticalErrors
                });
                this.stats.validationErrors++;
                continue;
              }

              if (validation.warnings.length > 0) {
                logger.debug('Meeting validation warnings', {
                  eventId: transformedMeeting.eventId,
                  warnings: validation.warnings
                });
                this.stats.validationWarnings++;
              }

              // Process the meeting
              const success = await this.upsertMeeting(transformedMeeting);
              if (success) {
                allMeetings.push(transformedMeeting);

                // Log progress every 25 meetings
                if (allMeetings.length % 25 === 0) {
                  logger.info('Meeting sync progress', {
                    congress,
                    chamber,
                    processed: allMeetings.length,
                    inserted: this.stats.inserted,
                    updated: this.stats.updated,
                    billsLinked: this.stats.billsLinked
                  });
                }
              }
            } else {
              logger.warn('Failed to fetch meeting details', {
                eventId,
                chamber,
                congress
              });
            }
          } catch (meetingError) {
            logger.error('Error processing individual meeting', {
              eventId: meetingListItem.eventId,
              chamber,
              error: meetingError.message
            });
            this.stats.failed++;
            continue;
          }
        }

        currentOffset += meetings.length;

        // If we got fewer results than requested, we're at the end
        if (meetings.length < pageSize) {
          break;
        }
      }

      logger.info('Meeting sync for chamber completed', {
        congress,
        chamber,
        processed: allMeetings.length,
        stats: this.stats
      });

      return {
        success: true,
        congress,
        chamber,
        processed: allMeetings.length
      };

    } catch (error) {
      logger.error('Meeting sync failed', {
        congress,
        chamber,
        error: error.message
      });

      return {
        success: false,
        congress,
        chamber,
        error: error.message
      };
    }
  }

  /**
   * Syncs upcoming meetings (future scheduled) across both chambers.
   * This method queries without date restrictions to ensure we capture
   * all scheduled meetings, then filters to focus on upcoming ones.
   */
  async syncUpcomingMeetings(options = {}) {
    const {
      limit = 200  // Get more to ensure we capture all upcoming
    } = options;

    // Reset stats
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      billsLinked: 0,
      committeesLinked: 0,
      documentsAdded: 0,
      videosAdded: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };

    try {
      const currentCongress = await this.client.getCurrentCongress();

      logger.info('Starting upcoming committee meetings sync', {
        congress: currentCongress,
        limit
      });

      const results = {
        success: true,
        congress: currentCongress,
        chambers: {},
        totalProcessed: 0,
        combinedStats: { ...this.stats }
      };

      // Sync both chambers WITHOUT date filter to get all meetings
      for (const chamber of ['Senate', 'House']) {
        const chamberResult = await this.syncMeetingsByCongressAndChamber(
          currentCongress,
          chamber,
          {
            // No fromDate - get all meetings for current congress
            limit: Math.floor(limit / 2)
          }
        );

        results.chambers[chamber.toLowerCase()] = chamberResult;
        results.totalProcessed += chamberResult.processed || 0;

        if (!chamberResult.success) {
          results.success = false;
        }
      }

      results.combinedStats = { ...this.stats };

      // Update sync status
      await this.updateSyncStatus('success', {
        congress: currentCongress,
        type: 'upcoming',
        totalProcessed: results.totalProcessed,
        stats: results.combinedStats
      });

      logger.info('Upcoming committee meetings sync completed', {
        success: results.success,
        totalProcessed: results.totalProcessed,
        billsLinked: this.stats.billsLinked,
        stats: results.combinedStats
      });

      return results;

    } catch (error) {
      await this.updateSyncStatus('failure', {
        type: 'upcoming',
        error: error.message,
        stats: { ...this.stats }
      });

      logger.error('Upcoming committee meetings sync failed', {
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
   * Syncs recent meetings across both chambers
   */
  async syncRecentMeetings(options = {}) {
    const {
      days = config.sync.incrementalDays.hearings, // Reuse hearings config
      limit = config.sync.batchSizes.hearings * 2
    } = options;

    // Reset stats
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      billsLinked: 0,
      committeesLinked: 0,
      documentsAdded: 0,
      videosAdded: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };

    try {
      const currentCongress = await this.client.getCurrentCongress();

      // Calculate from date
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      const fromDateString = fromDate.toISOString().split('T')[0];

      logger.info('Starting recent committee meetings sync', {
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

      // Sync both chambers
      for (const chamber of ['Senate', 'House']) {
        const chamberResult = await this.syncMeetingsByCongressAndChamber(
          currentCongress,
          chamber,
          {
            fromDate: fromDateString,
            limit: Math.floor(limit / 2)
          }
        );

        results.chambers[chamber.toLowerCase()] = chamberResult;
        results.totalProcessed += chamberResult.processed || 0;

        if (!chamberResult.success) {
          results.success = false;
        }
      }

      results.combinedStats = { ...this.stats };

      // Update sync status
      await this.updateSyncStatus('success', {
        congress: currentCongress,
        days,
        fromDate: fromDateString,
        totalProcessed: results.totalProcessed,
        stats: results.combinedStats
      });

      logger.info('Recent committee meetings sync completed', {
        success: results.success,
        totalProcessed: results.totalProcessed,
        billsLinked: this.stats.billsLinked,
        stats: results.combinedStats
      });

      return results;

    } catch (error) {
      await this.updateSyncStatus('failure', {
        error: error.message,
        stats: { ...this.stats }
      });

      logger.error('Recent committee meetings sync failed', {
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
   * Performs a comprehensive sync across multiple congresses
   */
  async syncAllMeetings(options = {}) {
    const {
      congresses = [await this.client.getCurrentCongress()],
      limit = config.sync.batchSizes.hearings
    } = options;

    // Reset stats
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      billsLinked: 0,
      committeesLinked: 0,
      documentsAdded: 0,
      videosAdded: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };

    logger.info('Starting comprehensive committee meeting sync', { congresses, limit });

    const results = {
      success: true,
      congresses: {},
      totalProcessed: 0,
      overallStats: { ...this.stats }
    };

    try {
      for (const congress of congresses) {
        logger.info(`Syncing committee meetings for Congress ${congress}`);

        for (const chamber of ['Senate', 'House']) {
          const chamberResult = await this.syncMeetingsByCongressAndChamber(
            congress,
            chamber,
            { limit }
          );

          const key = `${congress}-${chamber.toLowerCase()}`;
          results.congresses[key] = {
            processed: chamberResult.processed || 0,
            success: chamberResult.success
          };

          results.totalProcessed += chamberResult.processed || 0;

          if (!chamberResult.success) {
            results.success = false;
          }
        }

        // Delay between congresses
        if (congresses.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      results.overallStats = { ...this.stats };

      logger.info('Comprehensive committee meeting sync completed', {
        success: results.success,
        totalProcessed: results.totalProcessed,
        billsLinked: this.stats.billsLinked,
        stats: results.overallStats
      });

      return results;

    } catch (error) {
      logger.error('Comprehensive committee meeting sync failed', {
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
        VALUES ('committee-meetings', NOW(), $1, $2, $3, $4)
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

module.exports = CommitteeMeetingSyncer;
