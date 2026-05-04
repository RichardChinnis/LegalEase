#!/usr/bin/env node
/**
 * Backfill Full Bill Details
 *
 * Syncs complete bill details (actions, cosponsors, summaries, etc.) for bills
 * that are missing this data.
 */

const BillSyncer = require('./syncers/bill-syncer');
const DatabaseService = require('./lib/database');
const logger = require('./lib/logger');

const BATCH_SIZE = 5;  // Smaller batches - full details is API-intensive
const DELAY_BETWEEN_BATCHES = 500;

class BillDetailsBackfill {
  constructor(options = {}) {
    this.syncer = new BillSyncer();
    this.db = new DatabaseService();
    this.congress = options.congress || 119;
    this.stats = { total: 0, synced: 0, failed: 0 };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get bills missing actions (indicator they need full details sync)
   */
  async getBillsMissingDetails() {
    const result = await this.db.query(`
      SELECT b.bill_id, b.bill_type::text as bill_type, b.bill_number
      FROM bill b
      LEFT JOIN action a ON b.bill_id = a.bill_id
      WHERE b.congress_id = $1
      GROUP BY b.bill_id, b.bill_type, b.bill_number
      HAVING COUNT(a.action_id) = 0
      ORDER BY b.bill_type, b.bill_number::int
    `, [this.congress]);
    return result.rows;
  }

  /**
   * Sync full details for a single bill
   * Wraps in timeout to avoid getting stuck on problematic bills
   */
  async syncBillDetails(bill) {
    const timeout = 30000; // 30 second timeout per bill

    try {
      await Promise.race([
        this.syncer.syncBillWithDetails(this.congress, bill.bill_type, bill.bill_number),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ]);
      this.stats.synced++;
      return true;
    } catch (error) {
      // Log but don't spam for known API bugs
      if (error.message.includes('500') || error.message.includes('Timeout')) {
        logger.warn(`Skipping ${bill.bill_id} due to API issue: ${error.message.substring(0, 50)}`);
      } else {
        logger.error(`Failed to sync details for ${bill.bill_id}:`, error.message);
      }
      this.stats.failed++;
      return false;
    }
  }

  async run() {
    const startTime = Date.now();

    logger.info('='.repeat(60));
    logger.info(`Bill Details Backfill - Congress ${this.congress}`);
    logger.info('='.repeat(60));

    try {
      // Ensure congress exists
      await this.db.ensureCongressExists(this.congress);

      const bills = await this.getBillsMissingDetails();
      this.stats.total = bills.length;

      logger.info(`Found ${bills.length} bills needing full details sync`);

      if (bills.length === 0) {
        logger.info('No bills need syncing!');
        return this.stats;
      }

      for (let i = 0; i < bills.length; i += BATCH_SIZE) {
        const batch = bills.slice(i, i + BATCH_SIZE);

        // Process batch sequentially to avoid overwhelming the API
        for (const bill of batch) {
          await this.syncBillDetails(bill);
        }

        const progress = i + batch.length;
        const pct = Math.round(progress / bills.length * 100);

        if (progress % 50 === 0 || progress === bills.length) {
          logger.info(`Progress: ${progress}/${bills.length} (${pct}%) - ${this.stats.synced} synced, ${this.stats.failed} failed`);
        }

        if (i + BATCH_SIZE < bills.length) {
          await this.sleep(DELAY_BETWEEN_BATCHES);
        }
      }

      const duration = Date.now() - startTime;
      const minutes = Math.round(duration / 60000);

      logger.info('='.repeat(60));
      logger.info('BACKFILL COMPLETE');
      logger.info(`Duration: ${minutes} minutes`);
      logger.info(`Total: ${this.stats.total}`);
      logger.info(`Synced: ${this.stats.synced}`);
      logger.info(`Failed: ${this.stats.failed}`);
      logger.info('='.repeat(60));

      return this.stats;

    } finally {
      await this.db.close();
      await this.syncer.close();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const congress = args.find(a => a.startsWith('--congress='))?.split('=')[1] || 119;

  const backfill = new BillDetailsBackfill({ congress: parseInt(congress) });

  try {
    await backfill.run();
    process.exit(0);
  } catch (error) {
    logger.error('Backfill failed:', error);
    process.exit(1);
  }
}

main();
