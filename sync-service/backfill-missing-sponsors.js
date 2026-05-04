#!/usr/bin/env node
/**
 * Backfill Missing Sponsors
 *
 * Finds bills without sponsor data and fetches sponsor info from Congress API
 */

const CongressClient = require('./lib/congress-client');
const DatabaseService = require('./lib/database');
const logger = require('./lib/logger');

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 100;

class MissingSponsorsBackfill {
  constructor(options = {}) {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.congress = options.congress || 119;
    this.stats = { synced: 0, failed: 0, skipped: 0 };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getBillsMissingSponsors() {
    const result = await this.db.query(`
      SELECT b.bill_id, b.bill_type::text as bill_type, b.bill_number, b.introduced_date
      FROM bill b
      LEFT JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
      WHERE b.congress_id = $1 AND bs.bill_id IS NULL
      ORDER BY b.bill_type, b.bill_number::int
    `, [this.congress]);
    return result.rows;
  }

  async syncSponsor(bill) {
    try {
      // Fetch bill details from API
      const response = await this.client.makeRequest(
        `/bill/${this.congress}/${bill.bill_type}/${bill.bill_number}`
      );

      if (!response.bill?.sponsors || response.bill.sponsors.length === 0) {
        logger.debug(`No sponsors for ${bill.bill_id}`);
        this.stats.skipped++;
        return true;
      }

      const sponsor = response.bill.sponsors[0];
      if (!sponsor.bioguideId) {
        logger.debug(`No bioguideId for sponsor of ${bill.bill_id}`);
        this.stats.skipped++;
        return true;
      }

      // Insert sponsor
      await this.db.query(`
        INSERT INTO bill_sponsor (bill_id, member_bioguide_id, sponsorship_date, is_by_request)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (bill_id) DO NOTHING
      `, [bill.bill_id, sponsor.bioguideId, bill.introduced_date, sponsor.isByRequest || false]);

      this.stats.synced++;
      return true;

    } catch (error) {
      logger.error(`Failed to sync sponsor for ${bill.bill_id}:`, error.message);
      this.stats.failed++;
      return false;
    }
  }

  async run() {
    const startTime = Date.now();

    logger.info('='.repeat(50));
    logger.info(`Missing Sponsors Backfill - Congress ${this.congress}`);
    logger.info('='.repeat(50));

    try {
      const bills = await this.getBillsMissingSponsors();
      logger.info(`Found ${bills.length} bills missing sponsors`);

      if (bills.length === 0) {
        logger.info('No missing sponsors to backfill!');
        return this.stats;
      }

      for (let i = 0; i < bills.length; i += BATCH_SIZE) {
        const batch = bills.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(bill => this.syncSponsor(bill)));

        if ((i + batch.length) % 100 === 0 || i + batch.length === bills.length) {
          logger.info(`Progress: ${i + batch.length}/${bills.length} (${this.stats.synced} synced, ${this.stats.skipped} skipped, ${this.stats.failed} failed)`);
        }

        if (i + BATCH_SIZE < bills.length) {
          await this.sleep(DELAY_BETWEEN_BATCHES);
        }
      }

      const duration = Date.now() - startTime;

      logger.info('='.repeat(50));
      logger.info('BACKFILL COMPLETE');
      logger.info(`Duration: ${Math.round(duration / 1000)}s`);
      logger.info(`Synced: ${this.stats.synced}`);
      logger.info(`Skipped (no sponsor): ${this.stats.skipped}`);
      logger.info(`Failed: ${this.stats.failed}`);
      logger.info('='.repeat(50));

      return this.stats;

    } finally {
      await this.db.close();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const congress = args.find(a => a.startsWith('--congress='))?.split('=')[1] || 119;

  const backfill = new MissingSponsorsBackfill({ congress: parseInt(congress) });

  try {
    await backfill.run();
    process.exit(0);
  } catch (error) {
    logger.error('Backfill failed:', error);
    process.exit(1);
  }
}

main();
