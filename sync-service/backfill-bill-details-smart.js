#!/usr/bin/env node
/**
 * Smart Bill Details Backfill
 *
 * First checks which bills have working API endpoints, then syncs only those.
 * Reports bills with API issues separately.
 */

const axios = require('axios');
const BillSyncer = require('./syncers/bill-syncer');
const DatabaseService = require('./lib/database');
const logger = require('./lib/logger');
const config = require('./config');

const BATCH_SIZE = 10;
const DELAY_BETWEEN_CHECKS = 50;
const DELAY_BETWEEN_SYNCS = 200;

class SmartBillBackfill {
  constructor(options = {}) {
    this.syncer = new BillSyncer();
    this.db = new DatabaseService();
    this.congress = options.congress || 119;
    this.apiKey = config.congressApi.apiKey;
    this.baseUrl = config.congressApi.baseUrl;

    this.stats = {
      total: 0,
      working: 0,
      broken: 0,
      notFound: 0,
      synced: 0,
      failed: 0
    };

    this.brokenBills = [];
    this.notFoundBills = [];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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
   * Quick check if a bill's actions endpoint works
   */
  async checkBillApi(bill) {
    try {
      const url = `${this.baseUrl}/bill/${this.congress}/${bill.bill_type}/${bill.bill_number}/actions`;
      const response = await axios.head(url, {
        params: { api_key: this.apiKey },
        timeout: 5000,
        validateStatus: () => true // Don't throw on any status
      });
      return response.status;
    } catch (error) {
      return error.response?.status || 0;
    }
  }

  /**
   * Pre-filter bills to find which have working APIs
   */
  async filterWorkingBills(bills) {
    logger.info(`Checking API status for ${bills.length} bills...`);

    const working = [];

    for (let i = 0; i < bills.length; i += BATCH_SIZE) {
      const batch = bills.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async bill => {
          const status = await this.checkBillApi(bill);
          return { bill, status };
        })
      );

      for (const { bill, status } of results) {
        if (status === 200) {
          working.push(bill);
          this.stats.working++;
        } else if (status === 404) {
          this.notFoundBills.push(bill.bill_id);
          this.stats.notFound++;
        } else {
          this.brokenBills.push({ bill_id: bill.bill_id, status });
          this.stats.broken++;
        }
      }

      const progress = Math.min(i + BATCH_SIZE, bills.length);
      if (progress % 100 === 0 || progress === bills.length) {
        logger.info(`  Checked ${progress}/${bills.length}: ${this.stats.working} working, ${this.stats.broken} broken, ${this.stats.notFound} not found`);
      }

      await this.sleep(DELAY_BETWEEN_CHECKS);
    }

    return working;
  }

  /**
   * Sync details for working bills
   */
  async syncBills(bills) {
    logger.info(`\nSyncing ${bills.length} bills with working APIs...`);

    for (let i = 0; i < bills.length; i++) {
      const bill = bills[i];

      try {
        await this.syncer.syncBillWithDetails(this.congress, bill.bill_type, bill.bill_number);
        this.stats.synced++;
      } catch (error) {
        logger.warn(`Failed to sync ${bill.bill_id}: ${error.message.substring(0, 50)}`);
        this.stats.failed++;
      }

      const progress = i + 1;
      if (progress % 50 === 0 || progress === bills.length) {
        const pct = Math.round(progress / bills.length * 100);
        logger.info(`  Progress: ${progress}/${bills.length} (${pct}%) - ${this.stats.synced} synced, ${this.stats.failed} failed`);
      }

      await this.sleep(DELAY_BETWEEN_SYNCS);
    }
  }

  async run() {
    const startTime = Date.now();

    logger.info('='.repeat(60));
    logger.info(`Smart Bill Details Backfill - Congress ${this.congress}`);
    logger.info('='.repeat(60));

    try {
      await this.db.ensureCongressExists(this.congress);

      // Get bills missing details
      const allBills = await this.getBillsMissingDetails();
      this.stats.total = allBills.length;
      logger.info(`Found ${allBills.length} bills needing sync`);

      if (allBills.length === 0) {
        logger.info('No bills need syncing!');
        return this.stats;
      }

      // Filter to working bills
      const workingBills = await this.filterWorkingBills(allBills);

      // Sync working bills
      if (workingBills.length > 0) {
        await this.syncBills(workingBills);
      }

      const duration = Date.now() - startTime;
      const minutes = Math.round(duration / 60000);

      // Report
      logger.info('\n' + '='.repeat(60));
      logger.info('BACKFILL COMPLETE');
      logger.info('='.repeat(60));
      logger.info(`Duration: ${minutes} minutes`);
      logger.info(`Total bills checked: ${this.stats.total}`);
      logger.info(`Working APIs: ${this.stats.working}`);
      logger.info(`Broken APIs (500): ${this.stats.broken}`);
      logger.info(`Not found (404): ${this.stats.notFound}`);
      logger.info(`Successfully synced: ${this.stats.synced}`);
      logger.info(`Failed to sync: ${this.stats.failed}`);

      if (this.brokenBills.length > 0) {
        logger.info('\nBills with broken Congress.gov APIs:');
        this.brokenBills.slice(0, 20).forEach(b => logger.info(`  - ${b.bill_id} (HTTP ${b.status})`));
        if (this.brokenBills.length > 20) {
          logger.info(`  ... and ${this.brokenBills.length - 20} more`);
        }
      }

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

  const backfill = new SmartBillBackfill({ congress: parseInt(congress) });

  try {
    await backfill.run();
    process.exit(0);
  } catch (error) {
    logger.error('Backfill failed:', error);
    process.exit(1);
  }
}

main();
