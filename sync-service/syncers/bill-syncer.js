const CongressClient = require('../lib/congress-client');
const DatabaseService = require('../lib/database');
const logger = require('../lib/logger');
const config = require('../config');

/**
 * Parse a date-only string (e.g., "2025-03-05") correctly for PostgreSQL DATE storage.
 *
 * The issue: node-postgres serializes Date objects using local time (getFullYear,
 * getMonth, getDate), not UTC. When new Date("2025-03-05") creates UTC midnight,
 * it becomes "2025-03-04 20:00:00" in EST (UTC-5), so pg stores "2025-03-04".
 *
 * The fix: Use T12:00:00Z (noon UTC) which stays the correct date in any timezone
 * from UTC-12 to UTC+12 when converted to local time.
 *
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {Date|null} - Date object or null if invalid
 */
function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  // If it's already a full timestamp, parse directly
  if (dateStr.includes('T')) {
    return new Date(dateStr);
  }
  // For date-only strings, append T12:00:00Z (noon UTC) to ensure the local date
  // matches the intended date in any timezone
  return new Date(dateStr + 'T12:00:00Z');
}

class BillSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      apiCallsSaved: 0,
      errors: []
    };
  }

  // Transform API bill data to database format
  transformBillData(apiData, congress) {
    try {
      const bill = apiData.bill || apiData;
      
      // Extract bill ID components
      const billId = `${congress}-${bill.type}-${bill.number}`;
      
      // Parse dates - use parseDateOnly for date-only fields to avoid timezone shift
      const introducedDate = parseDateOnly(bill.introducedDate);
      const updateDate = bill.updateDate ? new Date(bill.updateDate) : null;
      const updateDateIncludingText = bill.updateDateIncludingText ?
        new Date(bill.updateDateIncludingText) : null;
      const latestActionDate = parseDateOnly(bill.latestAction?.actionDate);

      // Extract sponsors
      const sponsors = [];
      if (bill.sponsors && Array.isArray(bill.sponsors)) {
        sponsors.push(...bill.sponsors.map(s => ({
          bioguideId: s.bioguideId,
          name: s.fullName || s.name,
          party: s.party,
          state: s.state,
          district: s.district
        })));
      }

      // Extract subjects
      const subjects = [];
      if (bill.subjects && bill.subjects.legislativeSubjects) {
        subjects.push(...bill.subjects.legislativeSubjects.map(s => s.name));
      }

      // Extract committees
      const committees = [];
      if (bill.committees && Array.isArray(bill.committees)) {
        committees.push(...bill.committees.map(c => ({
          name: c.name,
          chamber: c.chamber,
          type: c.type,
          systemCode: c.systemCode
        })));
      }

      // Map chamber values to database enum
      let originChamber = null;
      let originChamberCode = null;
      if (bill.originChamber) {
        const chamber = bill.originChamber.toLowerCase();
        if (chamber === 'house') {
          originChamber = 'House';
          originChamberCode = 'H';
        } else if (chamber === 'senate') {
          originChamber = 'Senate';
          originChamberCode = 'S';
        } else if (chamber === 'joint') {
          originChamber = 'Joint';
          originChamberCode = 'J';
        } else {
          originChamber = 'NoChamber';
          originChamberCode = null;
        }
      }

      // Extract law information if bill became law
      let lawType = null;
      let lawNumber = null;
      if (bill.laws && Array.isArray(bill.laws) && bill.laws.length > 0) {
        const law = bill.laws[0]; // Take the first law entry
        lawType = law.type;
        lawNumber = law.number;
      }

      return {
        bill_id: billId,
        congress_id: congress,
        bill_type: bill.type ? bill.type.toLowerCase() : null,
        bill_number: bill.number,
        origin_chamber: originChamber,
        origin_chamber_code: originChamberCode,
        title: bill.title,
        introduced_date: introducedDate,
        latest_action_date: latestActionDate,
        latest_action_text: bill.latestAction?.text,
        policy_area: bill.policyArea?.name,
        constitutional_authority_statement_text: bill.constitutionalAuthorityStatementText,
        law_type: lawType,
        law_number: lawNumber,
        congress_notes: bill.notes,
        api_update_date: updateDate,
        api_update_date_including_text: updateDateIncludingText,
        // Additional data goes into notes field
        url: bill.url,
        subjects: subjects,
        sponsors: sponsors,
        cosponsors_count: bill.cosponsors || 0,
        committees: committees
      };
    } catch (error) {
      logger.error('Error transforming bill data', {
        error: error.message,
        billData: apiData
      });
      throw error;
    }
  }

  // Helper method to determine if a bill should be synced based on activity date
  shouldSyncBill(bill, lastSyncTimestamp) {
    try {
      // If no last sync timestamp, sync all bills
      if (!lastSyncTimestamp) {
        return true;
      }

      const lastSync = new Date(lastSyncTimestamp);

      // Check bill's updateDate first (most reliable)
      if (bill.updateDate) {
        const billUpdateDate = new Date(bill.updateDate);
        return billUpdateDate > lastSync;
      }

      // Fall back to latest action date if updateDate not available
      if (bill.latestAction && bill.latestAction.actionDate) {
        const actionDate = parseDateOnly(bill.latestAction.actionDate);
        return actionDate > lastSync;
      }

      // If no dates available, err on side of caution and sync
      logger.warn('No date information available for bill, syncing anyway', {
        billId: `${bill.congress}-${bill.type}-${bill.number}`
      });
      return true;

    } catch (error) {
      logger.error('Error comparing bill dates, syncing anyway', {
        billId: `${bill.congress}-${bill.type}-${bill.number}`,
        error: error.message
      });
      return true;
    }
  }

  // Sync a single bill with all its details
  async syncBillWithDetails(congress, billType, billNumber) {
    // billId uses uppercase type to match database format
    const billId = `${congress}-${billType.toUpperCase()}-${billNumber}`;
    
    try {
      // Get full bill details
      const billData = await this.client.getBillDetails(congress, billType, billNumber);
      
      // Get all additional data in parallel for maximum performance
      // Note: sponsors are already included in main bill response, no separate call needed
      const [
        subjects, 
        committees,
        cosponsors,
        relatedBills,
        summaries,
        titles,
        textVersions,
        amendments
      ] = await Promise.all([
        this.client.getAllBillSubjects(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill subjects', { billId, error: err.message });
          return null;
        }),
        this.client.getBillCommittees(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill committees', { billId, error: err.message });
          return null;
        }),
        this.client.getAllBillCosponsors(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill cosponsors', { billId, error: err.message });
          return null;
        }),
        this.client.getBillRelatedBills(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill related bills', { billId, error: err.message });
          return null;
        }),
        this.client.getBillSummaries(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill summaries', { billId, error: err.message });
          return null;
        }),
        this.client.getBillTitles(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill titles', { billId, error: err.message });
          return null;
        }),
        this.client.getBillTextVersions(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill text versions', { billId, error: err.message });
          return null;
        }),
        this.client.getAllBillAmendments(congress, billType, billNumber).catch(err => {
          logger.warn('Failed to fetch bill amendments', { billId, error: err.message });
          return null;
        })
      ]);

      // Merge additional data into bill data for transformation
      if (subjects) billData.bill.subjects = subjects.subjects;
      // sponsors are already included in billData.bill.sponsors from main API call
      if (committees) billData.bill.committees = committees.committees;

      // Transform and save main bill data
      const transformedBill = this.transformBillData(billData.bill, congress);
      const result = await this.db.upsertBill(transformedBill);

      if (result.inserted) this.stats.inserted++;
      else this.stats.updated++;

      // Sync all related data in parallel for performance
      await Promise.all([
        // Existing actions sync
        this.syncBillActions(congress, billType, billNumber),

        // Sync sponsor from main bill data
        this.syncBillSponsor(billId, billData.bill),

        // New detailed data sync
        cosponsors ? this.syncBillCosponsors(billId, cosponsors) : Promise.resolve(),
        relatedBills ? this.syncBillRelatedBills(billId, relatedBills) : Promise.resolve(),
        summaries ? this.syncBillSummaries(billId, summaries) : Promise.resolve(),
        titles ? this.syncBillTitles(billId, titles) : Promise.resolve(),
        textVersions ? this.syncBillTextVersions(billId, textVersions) : Promise.resolve(),
        amendments ? this.syncBillAmendments(billId, amendments) : Promise.resolve(),

        // Sync subjects (from subjects API call and policy area from main bill)
        subjects ? this.syncBillSubjects(billId, subjects, billData.bill?.policyArea?.name) : Promise.resolve(),

        // Sync data from main bill object
        this.syncBillCommitteeReports(billId, billData.bill),
        this.syncBillCboEstimates(billId, billData.bill),
        this.syncBillCommitteeActivity(billId, billData.bill),
        this.syncBillLaw(billId, billData.bill)
      ]);

      return result;

    } catch (error) {
      this.stats.failed++;
      this.stats.errors.push({
        bill: billId,
        error: error.message
      });
      logger.error('Failed to sync bill with details', {
        billId,
        error: error.message
      });
      throw error;
    }
  }

  // Sync actions for a specific bill
  async syncBillActions(congress, billType, billNumber) {
    try {
      const actionsData = await this.client.getAllBillActions(congress, billType, billNumber);
      // Keep billId format consistent with what's stored in the database (uppercase type)
      const billId = `${congress}-${billType.toUpperCase()}-${billNumber}`;

      if (actionsData.actions && Array.isArray(actionsData.actions)) {
        for (const action of actionsData.actions) {
          // Extract calendar information
          let calendarNumber = null;
          let calendarName = null;
          if (action.calendars && action.calendars.length > 0) {
            calendarNumber = action.calendars[0].number;
            calendarName = action.calendars[0].calendar;
          }

          const actionData = {
            bill_id: billId,
            action_date: action.actionDate || null,
            action_time: action.actionTime,
            text: action.text,
            type: action.type,
            action_code: action.actionCode,
            source_system_code: action.sourceSystem?.code,
            source_system_name: action.sourceSystem?.name,
            calendar_number: calendarNumber,
            calendar_name: calendarName
          };

          await this.db.upsertAction(actionData);
        }
      }
    } catch (error) {
      logger.error('Failed to sync bill actions', {
        congress, billType, billNumber,
        error: error.message
      });
    }
  }

  // Sync sponsor for a specific bill
  async syncBillSponsor(billId, billData) {
    try {
      if (!billData?.sponsors || !Array.isArray(billData.sponsors) || billData.sponsors.length === 0) {
        return;
      }

      // Bills typically have one sponsor (the first one in the array)
      const sponsor = billData.sponsors[0];
      if (!sponsor.bioguideId) {
        logger.warn('Sponsor missing bioguideId', { billId, sponsor });
        return;
      }

      const sponsorData = {
        bill_id: billId,
        bioguide_id: sponsor.bioguideId,
        sponsorship_date: billData.introducedDate ? parseDateOnly(billData.introducedDate) : null,
        is_by_request: sponsor.isByRequest || false
      };

      await this.db.upsertBillSponsor(sponsorData);
    } catch (error) {
      logger.error('Failed to sync bill sponsor', {
        billId,
        error: error.message
      });
    }
  }

  // Sync cosponsors for a specific bill
  async syncBillCosponsors(billId, cosponsorsData) {
    try {
      if (!cosponsorsData?.cosponsors || !Array.isArray(cosponsorsData.cosponsors)) {
        return;
      }

      for (const cosponsor of cosponsorsData.cosponsors) {
        const cosponsorData = {
          bill_id: billId,
          bioguide_id: cosponsor.bioguideId,
          full_name: cosponsor.fullName,
          first_name: cosponsor.firstName,
          middle_name: cosponsor.middleName,
          last_name: cosponsor.lastName,
          suffix: cosponsor.suffix,
          party: cosponsor.party,
          state: cosponsor.state,
          district: cosponsor.district,
          sponsorship_date: parseDateOnly(cosponsor.sponsorshipDate),
          withdrawal_date: parseDateOnly(cosponsor.sponsorshipWithdrawnDate),
          url: cosponsor.url
        };

        await this.db.upsertBillCosponsor(cosponsorData);
      }
    } catch (error) {
      logger.error('Failed to sync bill cosponsors', {
        billId,
        error: error.message
      });
    }
  }

  // Sync related bills for a specific bill
  async syncBillRelatedBills(billId, relatedBillsData) {
    try {
      if (!relatedBillsData?.relatedBills || !Array.isArray(relatedBillsData.relatedBills)) {
        return;
      }

      for (const relatedBill of relatedBillsData.relatedBills) {
        const relatedBillId = `${relatedBill.congress}-${relatedBill.type}-${relatedBill.number}`;
        
        const relatedData = {
          bill_id: billId,
          related_bill_id: relatedBillId,
          related_bill_congress: relatedBill.congress,
          related_bill_type: relatedBill.type?.toLowerCase(),
          related_bill_number: relatedBill.number,
          related_bill_title: relatedBill.title,
          relationship_type: relatedBill.relationshipDetails?.[0]?.type,
          identified_by: relatedBill.relationshipDetails?.[0]?.identifiedBy,
          latest_action_date: parseDateOnly(relatedBill.latestAction?.actionDate),
          latest_action_text: relatedBill.latestAction?.text
        };

        await this.db.upsertBillRelated(relatedData);
      }
    } catch (error) {
      logger.error('Failed to sync bill related bills', {
        billId,
        error: error.message
      });
    }
  }

  // Sync summaries for a specific bill
  async syncBillSummaries(billId, summariesData) {
    try {
      if (!summariesData?.summaries || !Array.isArray(summariesData.summaries)) {
        return;
      }

      for (const summary of summariesData.summaries) {
        const summaryData = {
          bill_id: billId,
          version_code: summary.versionCode,
          action_date: parseDateOnly(summary.actionDate),
          action_desc: summary.actionDesc,
          update_date: summary.updateDate ? new Date(summary.updateDate) : null,
          text: summary.text
        };

        await this.db.upsertBillSummary(summaryData);
      }
    } catch (error) {
      logger.error('Failed to sync bill summaries', {
        billId,
        error: error.message
      });
    }
  }

  // Sync titles for a specific bill
  async syncBillTitles(billId, titlesData) {
    try {
      if (!titlesData?.titles || !Array.isArray(titlesData.titles)) {
        return;
      }

      for (const title of titlesData.titles) {
        const titleData = {
          bill_id: billId,
          title_type: title.titleType,
          title_type_code: title.titleTypeCode,
          title: title.title,
          chamber_code: title.chamberCode,
          chamber_name: title.chamberName,
          bill_text_version_name: title.billTextVersionName,
          bill_text_version_code: title.billTextVersionCode
        };

        await this.db.upsertBillTitle(titleData);
      }
    } catch (error) {
      logger.error('Failed to sync bill titles', {
        billId,
        error: error.message
      });
    }
  }

  // Sync text versions for a specific bill
  async syncBillTextVersions(billId, textVersionsData) {
    try {
      if (!textVersionsData?.textVersions || !Array.isArray(textVersionsData.textVersions)) {
        return;
      }

      for (const textVersion of textVersionsData.textVersions) {
        // Extract available formats
        const formats = [];
        if (textVersion.formats && Array.isArray(textVersion.formats)) {
          formats.push(...textVersion.formats.map(f => ({
            type: f.type,
            url: f.url
          })));
        }

        const textVersionData = {
          bill_id: billId,
          version_type: textVersion.type,
          version_date: parseDateOnly(textVersion.date),
          formats: JSON.stringify(formats)
        };

        await this.db.upsertBillTextVersion(textVersionData);
      }
    } catch (error) {
      logger.error('Failed to sync bill text versions', {
        billId,
        error: error.message
      });
    }
  }

  // Sync amendments for a specific bill
  async syncBillAmendments(billId, amendmentsData) {
    try {
      if (!amendmentsData?.amendments || !Array.isArray(amendmentsData.amendments)) {
        return;
      }

      for (const amendment of amendmentsData.amendments) {
        const amendmentData = {
          amendment_id: `${amendment.congress}-${amendment.type}-${amendment.number}`,
          bill_id: billId,
          amendment_number: amendment.number,
          congress: amendment.congress,
          type: amendment.type?.toLowerCase(),
          description: amendment.description,
          purpose: amendment.purpose,
          submitted_date: parseDateOnly(amendment.submittedDate),
          latest_action_date: parseDateOnly(amendment.latestAction?.actionDate),
          latest_action_text: amendment.latestAction?.text,
          sponsor_bioguide_id: amendment.sponsors?.[0]?.bioguideId,
          sponsor_name: amendment.sponsors?.[0]?.fullName,
          sponsor_party: amendment.sponsors?.[0]?.party,
          sponsor_state: amendment.sponsors?.[0]?.state,
          url: amendment.url
        };

        await this.db.upsertBillAmendment(amendmentData);
      }
    } catch (error) {
      logger.error('Failed to sync bill amendments', {
        billId,
        error: error.message
      });
    }
  }

  // Sync committee reports from main bill data
  async syncBillCommitteeReports(billId, billData) {
    try {
      if (!billData?.committeeReports || !Array.isArray(billData.committeeReports)) {
        return;
      }

      for (const report of billData.committeeReports) {
        const reportData = {
          bill_id: billId,
          citation: report.citation,
          url: report.url
        };

        await this.db.upsertBillCommitteeReport(reportData);
      }
    } catch (error) {
      logger.error('Failed to sync bill committee reports', {
        billId,
        error: error.message
      });
    }
  }

  // Sync CBO estimates from main bill data
  async syncBillCboEstimates(billId, billData) {
    try {
      if (!billData?.cboCostEstimates || !Array.isArray(billData.cboCostEstimates)) {
        return;
      }

      for (const estimate of billData.cboCostEstimates) {
        const estimateData = {
          bill_id: billId,
          pub_date: parseDateOnly(estimate.pubDate),
          title: estimate.title,
          url: estimate.url,
          description: estimate.description
        };

        await this.db.upsertBillCboEstimate(estimateData);
      }
    } catch (error) {
      logger.error('Failed to sync bill CBO estimates', {
        billId,
        error: error.message
      });
    }
  }

  // Sync committee activities for a specific bill
  async syncBillCommitteeActivity(billId, billData) {
    try {
      if (!billData?.committees || !Array.isArray(billData.committees)) {
        return;
      }

      for (const committee of billData.committees) {
        if (committee.activities && Array.isArray(committee.activities)) {
          for (const activity of committee.activities) {
            const activityData = {
              bill_id: billId,
              committee_system_code: committee.systemCode,
              committee_name: committee.name,
              activity_name: activity.name,
              activity_date: parseDateOnly(activity.date)
            };

            await this.db.upsertBillCommitteeActivity(activityData);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to sync bill committee activity', {
        billId,
        error: error.message
      });
    }
  }

  // Sync subjects for a specific bill
  async syncBillSubjects(billId, subjectsData, policyArea) {
    try {
      // First sync the policy area if present
      if (policyArea) {
        await this.db.upsertBillSubject({
          bill_id: billId,
          subject_name: policyArea,
          is_policy_area: true
        });
      }

      // Then sync legislative subjects
      if (!subjectsData?.subjects?.legislativeSubjects) {
        return;
      }

      for (const subject of subjectsData.subjects.legislativeSubjects) {
        await this.db.upsertBillSubject({
          bill_id: billId,
          subject_name: subject.name,
          is_policy_area: false
        });
      }

      logger.debug('Synced bill subjects', {
        billId,
        subjectCount: subjectsData.subjects.legislativeSubjects.length,
        hasPolicyArea: !!policyArea
      });
    } catch (error) {
      logger.error('Failed to sync bill subjects', {
        billId,
        error: error.message
      });
    }
  }

  // Sync law data for a bill that became law
  async syncBillLaw(billId, billData) {
    try {
      if (!billData?.laws || !Array.isArray(billData.laws) || billData.laws.length === 0) {
        return;
      }

      for (const law of billData.laws) {
        if (!law.number || !law.type) {
          logger.warn('Law missing number or type', { billId, law });
          continue;
        }

        const lawData = {
          bill_id: billId,
          law_type: law.type,
          law_number: law.number
        };

        await this.db.upsertBillLaw(lawData);
      }

      logger.debug('Synced bill law data', { billId, lawCount: billData.laws.length });
    } catch (error) {
      logger.error('Failed to sync bill law', {
        billId,
        error: error.message
      });
    }
  }

  // Perform incremental sync (recent updates only)
  async performIncrementalSync(congress, daysSinceUpdate = 7) {
    const startTime = Date.now();

    // Reset stats at the start of sync
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      apiCallsSaved: 0,
      errors: []
    };

    // Get current congress if not specified
    if (!congress) {
      congress = await this.client.getCurrentCongress();
      logger.info(`Using current congress: ${congress}`);
    }
    
    // Ensure congress exists in database
    try {
      const congressDetails = await this.client.getCongressDetails(congress);
      await this.db.ensureCongressExists(congress, congressDetails);
    } catch (error) {
      logger.warn(`Could not fetch congress details, using defaults`, { congress, error: error.message });
      await this.db.ensureCongressExists(congress);
    }
    
    logger.info(`Starting incremental bill sync for Congress ${congress}`, {
      daysSinceUpdate
    });

    // Get last successful sync timestamp for optimization
    let lastSyncTimestamp = null;
    try {
      const syncStatus = await this.db.getSyncStatus('bills');
      if (syncStatus && syncStatus.last_successful_sync) {
        lastSyncTimestamp = syncStatus.last_successful_sync;
        logger.info(`Last successful sync: ${lastSyncTimestamp}`);
      } else {
        logger.info('No previous successful sync found, will sync all bills');
      }
    } catch (error) {
      logger.warn('Could not get sync status, will sync all bills', { error: error.message });
    }

    try {
      // Calculate the date range
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - daysSinceUpdate);
      const fromDateTime = sinceDate.toISOString().split('T')[0] + 'T00:00:00Z';

      // Fetch recently updated bills
      const params = {
        fromDateTime,
        sort: 'updateDate desc'
      };

      const bills = await this.client.fetchAllPages(
        (p) => this.client.getBills(congress, p),
        params,
        1 // Max 1 page for incremental
      );

      logger.info(`Found ${bills.length} bills updated since ${fromDateTime}`);

      // Filter bills based on activity since last sync
      let billsToSync = bills;
      if (config.sync.enableActivityDateCheck !== false && lastSyncTimestamp) {
        billsToSync = bills.filter(bill => {
          const shouldSync = this.shouldSyncBill(bill, lastSyncTimestamp);
          if (!shouldSync) {
            this.stats.skipped++;
            this.stats.apiCallsSaved += 9; // Approximate API calls saved per bill
          }
          return shouldSync;
        });

        logger.info(`Filtered bills: ${billsToSync.length} to sync, ${this.stats.skipped} skipped (${this.stats.apiCallsSaved} API calls saved)`);
      }

      // Process bills in batches
      const batchSize = config.sync.batchSizes.bills;
      for (let i = 0; i < billsToSync.length; i += batchSize) {
        const batch = billsToSync.slice(i, i + batchSize);

        await Promise.all(batch.map(bill =>
          this.syncBillWithDetails(congress, bill.type, bill.number)
            .catch(error => {
              logger.error('Failed to sync bill', {
                bill: `${congress}-${bill.type}-${bill.number}`,
                error: error.message
              });
            })
        ));

        logger.info(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(billsToSync.length / batchSize)}`);
      }

      const duration = Date.now() - startTime;

      // Update sync status
      await this.db.updateSyncStatus('bills', {
        success: true,
        records_synced: this.stats.inserted + this.stats.updated,
        records_failed: this.stats.failed,
        duration,
        metadata: {
          congress,
          incremental: true,
          daysSinceUpdate,
          stats: this.stats
        }
      });

      logger.info('Incremental bill sync completed', {
        duration: `${duration}ms`,
        totalBillsFetched: bills.length,
        billsProcessed: billsToSync ? billsToSync.length : bills.length,
        billsSkipped: this.stats.skipped,
        apiCallsSaved: this.stats.apiCallsSaved,
        stats: this.stats
      });

      return this.stats;

    } catch (error) {
      logger.error('Incremental sync failed', {
        error: error.message,
        congress
      });

      await this.db.updateSyncStatus('bills', {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        metadata: { congress, incremental: true }
      });

      throw error;
    }
  }

  // Perform full sync (all bills for a congress)
  async performFullSync(congress) {
    const startTime = Date.now();

    // Reset stats at the start of sync
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      apiCallsSaved: 0,
      errors: []
    };

    // Get current congress if not specified
    if (!congress) {
      congress = await this.client.getCurrentCongress();
      logger.info(`Using current congress: ${congress}`);
    }
    
    // Ensure congress exists in database
    try {
      const congressDetails = await this.client.getCongressDetails(congress);
      await this.db.ensureCongressExists(congress, congressDetails);
    } catch (error) {
      logger.warn(`Could not fetch congress details, using defaults`, { congress, error: error.message });
      await this.db.ensureCongressExists(congress);
    }
    
    logger.info(`Starting full bill sync for Congress ${congress}`);

    try {
      // Fetch all bills for this congress
      const bills = await this.client.fetchAllPages(
        (p) => this.client.getBills(congress, p)
      );

      logger.info(`Found ${bills.length} total bills in Congress ${congress}`);

      // Process bills in batches
      const batchSize = config.sync.batchSizes.bills;
      for (let i = 0; i < bills.length; i += batchSize) {
        const batch = bills.slice(i, i + batchSize);
        
        await Promise.all(batch.map(bill => 
          this.syncBillWithDetails(congress, bill.type, bill.number)
            .catch(error => {
              logger.error('Failed to sync bill', {
                bill: `${congress}-${bill.type}-${bill.number}`,
                error: error.message
              });
            })
        ));

        logger.info(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(bills.length / batchSize)}`, {
          progress: `${Math.round((i + batch.length) / bills.length * 100)}%`
        });
      }

      const duration = Date.now() - startTime;

      // Update sync status
      await this.db.updateSyncStatus('bills', {
        success: true,
        records_synced: this.stats.inserted + this.stats.updated,
        records_failed: this.stats.failed,
        duration,
        metadata: {
          congress,
          full: true,
          stats: this.stats
        }
      });

      logger.info('Full bill sync completed', {
        duration: `${duration}ms`,
        stats: this.stats
      });

      return this.stats;

    } catch (error) {
      logger.error('Full sync failed', {
        error: error.message,
        congress
      });

      await this.db.updateSyncStatus('bills', {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        metadata: { congress, full: true }
      });

      throw error;
    }
  }

  // Main sync method
  async sync(options = {}) {
    const { full = false, congress = null } = options;

    if (full) {
      return this.performFullSync(congress);
    } else {
      return this.performIncrementalSync(
        congress, 
        config.sync.incrementalDays.bills
      );
    }
  }

  async close() {
    await this.db.close();
  }
}

module.exports = BillSyncer;