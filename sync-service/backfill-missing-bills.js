#!/usr/bin/env node
/**
 * Backfill Missing Bills
 *
 * Compares Congress.gov API bill lists against our database and syncs only missing bills.
 * Handles all bill types and uses pagination with throttling.
 */

const CongressClient = require('./lib/congress-client');
const DatabaseService = require('./lib/database');
const logger = require('./lib/logger');
const config = require('./config');

// All bill types in Congress.gov
const BILL_TYPES = ['hr', 'hres', 's', 'sres', 'hjres', 'sjres', 'hconres', 'sconres'];

// Throttle settings
const DELAY_BETWEEN_PAGES = 200;  // ms between pagination requests
const DELAY_BETWEEN_SYNCS = 100;  // ms between individual bill syncs
const BATCH_SIZE = 10;            // concurrent bill detail fetches

class MissingBillsBackfill {
  constructor(options = {}) {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.congress = options.congress || 119;
    this.dryRun = options.dryRun || false;

    this.stats = {
      billTypesProcessed: 0,
      totalApiCalls: 0,
      totalMissing: 0,
      totalSynced: 0,
      totalFailed: 0,
      byType: {}
    };
  }

  /**
   * Sleep helper for throttling
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch all bills of a type from Congress API with pagination
   */
  async fetchAllBillsFromApi(billType) {
    const bills = [];
    let offset = 0;
    let hasMore = true;
    let pageCount = 0;

    logger.info(`Fetching ${billType.toUpperCase()} bills from Congress API...`);

    while (hasMore) {
      try {
        const response = await this.client.makeRequest(`/bill/${this.congress}/${billType}`, {
          limit: 250,
          offset: offset
        });

        this.stats.totalApiCalls++;
        pageCount++;

        if (response.bills && response.bills.length > 0) {
          bills.push(...response.bills.map(b => ({
            type: b.type?.toLowerCase(),
            number: String(b.number)
          })));

          hasMore = response.bills.length === 250;
          offset += 250;

          if (pageCount % 10 === 0) {
            logger.info(`  ${billType.toUpperCase()}: Fetched ${bills.length} bills (page ${pageCount})...`);
          }
        } else {
          hasMore = false;
        }

        // Throttle between pages
        if (hasMore) {
          await this.sleep(DELAY_BETWEEN_PAGES);
        }

      } catch (error) {
        logger.error(`Error fetching ${billType} page ${pageCount}:`, error.message);
        // Wait longer on error and retry once
        await this.sleep(2000);
        try {
          const response = await this.client.makeRequest(`/bill/${this.congress}/${billType}`, {
            limit: 250,
            offset: offset
          });
          this.stats.totalApiCalls++;

          if (response.bills && response.bills.length > 0) {
            bills.push(...response.bills.map(b => ({
              type: b.type?.toLowerCase(),
              number: String(b.number)
            })));
            hasMore = response.bills.length === 250;
            offset += 250;
          } else {
            hasMore = false;
          }
        } catch (retryError) {
          logger.error(`Retry failed for ${billType} page ${pageCount}, skipping:`, retryError.message);
          hasMore = false;
        }
      }
    }

    logger.info(`  ${billType.toUpperCase()}: Total ${bills.length} bills from API (${pageCount} pages)`);
    return bills;
  }

  /**
   * Get existing bills from our database for a bill type
   */
  async getExistingBills(billType) {
    const result = await this.db.query(`
      SELECT bill_number
      FROM bill
      WHERE congress_id = $1 AND bill_type::text = $2
    `, [this.congress, billType]);

    return new Set(result.rows.map(r => String(r.bill_number)));
  }

  /**
   * Find missing bills by comparing API list to database
   */
  async findMissingBills(billType) {
    // Get bills from API
    const apiBills = await this.fetchAllBillsFromApi(billType);

    // Deduplicate API bills (same bill can appear multiple times due to updateDate sorting)
    const uniqueApiBills = [...new Map(apiBills.map(b => [b.number, b])).values()];

    // Get bills from database
    const existingNumbers = await this.getExistingBills(billType);

    // Find missing
    const missing = uniqueApiBills.filter(b => !existingNumbers.has(b.number));

    logger.info(`  ${billType.toUpperCase()}: ${uniqueApiBills.length} unique in API, ${existingNumbers.size} in DB, ${missing.length} missing`);

    return missing;
  }

  /**
   * Sync a single bill with full details
   */
  async syncBill(billType, billNumber) {
    try {
      // Fetch bill details
      const response = await this.client.makeRequest(
        `/bill/${this.congress}/${billType}/${billNumber}`
      );
      this.stats.totalApiCalls++;

      if (!response.bill) {
        logger.warn(`No bill data returned for ${this.congress}-${billType}-${billNumber}`);
        return false;
      }

      const bill = response.bill;
      const billId = `${this.congress}-${bill.type?.toUpperCase()}-${bill.number}`;

      // Parse dates safely
      const introducedDate = bill.introducedDate ?
        new Date(bill.introducedDate + 'T12:00:00Z') : null;
      const latestActionDate = bill.latestAction?.actionDate ?
        new Date(bill.latestAction.actionDate + 'T12:00:00Z') : null;
      const updateDate = bill.updateDate ? new Date(bill.updateDate) : null;
      const updateDateIncludingText = bill.updateDateIncludingText ?
        new Date(bill.updateDateIncludingText) : null;

      // Map chamber
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
        }
      }

      // Extract law info
      let lawType = null;
      let lawNumber = null;
      if (bill.laws && bill.laws.length > 0) {
        lawType = bill.laws[0].type;
        lawNumber = bill.laws[0].number;
      }

      // Insert bill
      await this.db.query(`
        INSERT INTO bill (
          bill_id, congress_id, bill_type, bill_number,
          origin_chamber, origin_chamber_code, title,
          introduced_date, latest_action_date, latest_action_text,
          policy_area, constitutional_authority_statement_text,
          law_type, law_number, api_update_date, api_update_date_including_text
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (bill_id) DO UPDATE SET
          title = EXCLUDED.title,
          latest_action_date = EXCLUDED.latest_action_date,
          latest_action_text = EXCLUDED.latest_action_text,
          policy_area = EXCLUDED.policy_area,
          law_type = EXCLUDED.law_type,
          law_number = EXCLUDED.law_number,
          api_update_date = EXCLUDED.api_update_date,
          api_update_date_including_text = EXCLUDED.api_update_date_including_text
      `, [
        billId,
        this.congress,
        bill.type?.toLowerCase(),
        String(bill.number),
        originChamber,
        originChamberCode,
        bill.title,
        introducedDate,
        latestActionDate,
        bill.latestAction?.text,
        bill.policyArea?.name,
        bill.constitutionalAuthorityStatementText,
        lawType,
        lawNumber,
        updateDate,
        updateDateIncludingText
      ]);

      // Sync sponsor if available
      if (bill.sponsors && bill.sponsors.length > 0) {
        const sponsor = bill.sponsors[0];
        if (sponsor.bioguideId) {
          await this.db.query(`
            INSERT INTO bill_sponsor (bill_id, member_bioguide_id, sponsorship_date, is_by_request)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (bill_id) DO NOTHING
          `, [billId, sponsor.bioguideId, introducedDate, sponsor.isByRequest || false]);
        }
      }

      return true;

    } catch (error) {
      logger.error(`Failed to sync ${this.congress}-${billType}-${billNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Sync missing bills in batches
   */
  async syncMissingBills(billType, missingBills) {
    if (missingBills.length === 0) return;

    logger.info(`  Syncing ${missingBills.length} missing ${billType.toUpperCase()} bills...`);

    let synced = 0;
    let failed = 0;

    for (let i = 0; i < missingBills.length; i += BATCH_SIZE) {
      const batch = missingBills.slice(i, i + BATCH_SIZE);

      if (this.dryRun) {
        logger.info(`  [DRY RUN] Would sync: ${batch.map(b => `${b.type}-${b.number}`).join(', ')}`);
        synced += batch.length;
      } else {
        const results = await Promise.all(
          batch.map(b => this.syncBill(b.type, b.number))
        );

        synced += results.filter(r => r).length;
        failed += results.filter(r => !r).length;
      }

      // Progress update
      if ((i + batch.length) % 50 === 0 || i + batch.length === missingBills.length) {
        logger.info(`  ${billType.toUpperCase()}: ${i + batch.length}/${missingBills.length} processed (${synced} synced, ${failed} failed)`);
      }

      // Throttle between batches
      if (i + BATCH_SIZE < missingBills.length) {
        await this.sleep(DELAY_BETWEEN_SYNCS);
      }
    }

    return { synced, failed };
  }

  /**
   * Process a single bill type
   */
  async processBillType(billType) {
    logger.info(`\nProcessing ${billType.toUpperCase()}...`);

    this.stats.byType[billType] = {
      inApi: 0,
      inDb: 0,
      missing: 0,
      synced: 0,
      failed: 0
    };

    try {
      // Find missing bills
      const missing = await this.findMissingBills(billType);

      this.stats.byType[billType].missing = missing.length;
      this.stats.totalMissing += missing.length;

      if (missing.length === 0) {
        logger.info(`  ${billType.toUpperCase()}: No missing bills!`);
        return;
      }

      // Sync missing bills
      const result = await this.syncMissingBills(billType, missing);

      this.stats.byType[billType].synced = result.synced;
      this.stats.byType[billType].failed = result.failed;
      this.stats.totalSynced += result.synced;
      this.stats.totalFailed += result.failed;

      logger.info(`  ${billType.toUpperCase()}: Completed - ${result.synced} synced, ${result.failed} failed`);

    } catch (error) {
      logger.error(`Error processing ${billType}:`, error.message);
    }

    this.stats.billTypesProcessed++;
  }

  /**
   * Run the full backfill
   */
  async run() {
    const startTime = Date.now();

    logger.info('='.repeat(60));
    logger.info(`Missing Bills Backfill - Congress ${this.congress}`);
    logger.info(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}`);
    logger.info('='.repeat(60));

    try {
      // Process each bill type
      for (const billType of BILL_TYPES) {
        await this.processBillType(billType);

        // Small delay between bill types
        await this.sleep(500);
      }

      const duration = Date.now() - startTime;

      // Final summary
      logger.info('\n' + '='.repeat(60));
      logger.info('BACKFILL COMPLETE');
      logger.info('='.repeat(60));
      logger.info(`Duration: ${Math.round(duration / 1000)}s`);
      logger.info(`API Calls: ${this.stats.totalApiCalls}`);
      logger.info(`Total Missing: ${this.stats.totalMissing}`);
      logger.info(`Total Synced: ${this.stats.totalSynced}`);
      logger.info(`Total Failed: ${this.stats.totalFailed}`);
      logger.info('\nBy Type:');

      for (const [type, stats] of Object.entries(this.stats.byType)) {
        if (stats.missing > 0) {
          logger.info(`  ${type.toUpperCase()}: ${stats.missing} missing, ${stats.synced} synced, ${stats.failed} failed`);
        } else {
          logger.info(`  ${type.toUpperCase()}: Complete`);
        }
      }

      return this.stats;

    } finally {
      await this.db.close();
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const congress = args.find(a => a.startsWith('--congress='))?.split('=')[1] || 119;

  const backfill = new MissingBillsBackfill({
    congress: parseInt(congress),
    dryRun
  });

  try {
    await backfill.run();
    process.exit(0);
  } catch (error) {
    logger.error('Backfill failed:', error);
    process.exit(1);
  }
}

main();
