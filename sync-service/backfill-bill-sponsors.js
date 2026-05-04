#!/usr/bin/env node
/**
 * Backfill Bill Sponsors
 *
 * This script finds bills that are missing sponsor records in the bill_sponsor table
 * and populates them from the sponsor data stored in the bill.notes JSON field.
 *
 * No API calls needed - all data already exists in the database.
 *
 * Usage:
 *   node backfill-bill-sponsors.js [--dry-run]
 *
 * Options:
 *   --dry-run     Don't make changes, just show what would be done
 */

require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

// Configuration from environment
const config = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'congress_api',
    user: process.env.DB_USER || 'congress_admin',
    password: process.env.DB_PASSWORD,
  }
};

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Stats tracking
const stats = {
  processed: 0,
  inserted: 0,
  skipped: 0,
  errors: 0,
  errorDetails: [],
  startTime: Date.now()
};

// Initialize database pool
const pool = new Pool(config.database);

/**
 * Get bills missing sponsor records
 */
async function getBillsMissingSponsors() {
  const query = `
    SELECT
      b.bill_id,
      b.introduced_date,
      s->>'bioguideId' as bioguide_id
    FROM bill b,
         jsonb_array_elements(b.notes->'sponsors') s
    WHERE NOT EXISTS (SELECT 1 FROM bill_sponsor bs WHERE bs.bill_id = b.bill_id)
      AND s->>'bioguideId' IS NOT NULL
    ORDER BY b.congress_id DESC, b.introduced_date DESC
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Insert sponsor record
 */
async function insertSponsor(billId, bioguideId, sponsorshipDate) {
  const query = `
    INSERT INTO bill_sponsor (bill_id, member_bioguide_id, sponsorship_date, is_by_request)
    VALUES ($1, $2, $3, false)
    ON CONFLICT (bill_id) DO NOTHING
    RETURNING bill_id
  `;

  const result = await pool.query(query, [billId, bioguideId, sponsorshipDate]);
  return result.rows.length > 0;
}

/**
 * Verify member exists
 */
async function memberExists(bioguideId) {
  const query = `SELECT 1 FROM member WHERE bioguide_id = $1 LIMIT 1`;
  const result = await pool.query(query, [bioguideId]);
  return result.rows.length > 0;
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('BILL SPONSOR BACKFILL');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  Database: ${config.database.database}@${config.database.host}`);
  console.log(`  Dry Run: ${DRY_RUN}`);
  console.log('');
  console.log('This script populates the bill_sponsor table from existing');
  console.log('sponsor data stored in the bill.notes JSON field.');
  console.log('No API calls will be made.');
  console.log('');

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('Database connection: OK');

    // Get bills missing sponsors
    console.log('');
    console.log('Finding bills without sponsor records...');
    const billsToProcess = await getBillsMissingSponsors();
    console.log(`Found ${billsToProcess.length} bills to process`);
    console.log('');

    if (billsToProcess.length === 0) {
      console.log('No bills need sponsor backfill!');
      return;
    }

    console.log('Processing bills...');
    console.log('-'.repeat(60));

    for (let i = 0; i < billsToProcess.length; i++) {
      const bill = billsToProcess[i];
      stats.processed++;

      // Progress indicator every 100 bills
      if (i > 0 && i % 100 === 0) {
        const elapsed = (Date.now() - stats.startTime) / 1000;
        const rate = stats.processed / elapsed;
        const remaining = (billsToProcess.length - i) / rate;
        console.log('');
        console.log(`Progress: ${i}/${billsToProcess.length} (${((i/billsToProcess.length)*100).toFixed(1)}%)`);
        console.log(`  Inserted: ${stats.inserted}, Skipped: ${stats.skipped}, Errors: ${stats.errors}`);
        console.log(`  Rate: ${rate.toFixed(1)}/sec, ETA: ${remaining.toFixed(1)} sec`);
        console.log('');
      }

      try {
        // Verify member exists (should always be true based on our query)
        const exists = await memberExists(bill.bioguide_id);
        if (!exists) {
          stats.skipped++;
          console.log(`  [SKIPPED] ${bill.bill_id}: Member ${bill.bioguide_id} not found`);
          continue;
        }

        if (DRY_RUN) {
          console.log(`  [DRY RUN] ${bill.bill_id}: Would add sponsor ${bill.bioguide_id}`);
          stats.inserted++;
        } else {
          const inserted = await insertSponsor(bill.bill_id, bill.bioguide_id, bill.introduced_date);
          if (inserted) {
            stats.inserted++;
            console.log(`  [INSERTED] ${bill.bill_id}: Added sponsor ${bill.bioguide_id}`);
          } else {
            stats.skipped++;
            console.log(`  [SKIPPED] ${bill.bill_id}: Sponsor already exists (conflict)`);
          }
        }

      } catch (error) {
        stats.errors++;
        stats.errorDetails.push({
          bill_id: bill.bill_id,
          bioguide_id: bill.bioguide_id,
          error: error.message
        });
        console.error(`  [ERROR] ${bill.bill_id}: ${error.message}`);
      }
    }

    // Final stats
    console.log('');
    console.log('='.repeat(60));
    console.log('BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Results:');
    console.log(`  Bills Processed: ${stats.processed}`);
    console.log(`  Sponsors Inserted: ${stats.inserted}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Duration: ${((Date.now() - stats.startTime) / 1000).toFixed(1)} seconds`);

    if (stats.errorDetails.length > 0) {
      console.log('');
      console.log('Error Details:');
      stats.errorDetails.slice(0, 10).forEach((e, i) => {
        console.log(`  ${i + 1}. ${e.bill_id} (${e.bioguide_id}): ${e.error}`);
      });
      if (stats.errorDetails.length > 10) {
        console.log(`  ... and ${stats.errorDetails.length - 10} more`);
      }
    }

    // Verify final count
    if (!DRY_RUN) {
      console.log('');
      console.log('Verification:');
      const verifyResult = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM bill) as total_bills,
          (SELECT COUNT(DISTINCT bill_id) FROM bill_sponsor) as bills_with_sponsors
      `);
      const v = verifyResult.rows[0];
      console.log(`  Total Bills: ${v.total_bills}`);
      console.log(`  Bills with Sponsors: ${v.bills_with_sponsors}`);
      console.log(`  Missing Sponsors: ${v.total_bills - v.bills_with_sponsors}`);
    }

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
