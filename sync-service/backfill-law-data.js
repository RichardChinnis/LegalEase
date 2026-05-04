#!/usr/bin/env node
/**
 * Backfill Law Data
 *
 * This script populates law data for existing bills that have become laws.
 * It extracts law information from:
 * 1. The latest_action_text field (e.g., "Became Public Law No: 119-21.")
 * 2. The Congress API (for verification and to get any missing data)
 *
 * Run: node backfill-law-data.js [--congress=119] [--dry-run]
 */

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.database);

async function backfillLaws(options = {}) {
  const { congress, dryRun = false } = options;

  console.log('='.repeat(60));
  console.log('Law Data Backfill Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  if (congress) console.log(`Congress: ${congress}`);
  console.log('');

  try {
    // Build query to find bills that became laws
    let query = `
      SELECT bill_id, congress_id, bill_type, bill_number, title,
             latest_action_text, law_type, law_number
      FROM bill
      WHERE (latest_action_text ILIKE '%Became Public Law%'
         OR latest_action_text ILIKE '%Became Private Law%')
    `;
    const params = [];

    if (congress) {
      query += ` AND congress_id = $1`;
      params.push(congress);
    }

    query += ` ORDER BY congress_id DESC, bill_id`;

    const bills = await pool.query(query, params);
    console.log(`Found ${bills.rows.length} bills that became laws`);
    console.log('');

    let stats = {
      updated: 0,
      alreadySet: 0,
      failed: 0,
      billLawInserted: 0
    };

    for (const bill of bills.rows) {
      try {
        // Extract law number from latest_action_text
        // Format: "Became Public Law No: 119-21." or "Became Private Law No: 119-1."
        const match = bill.latest_action_text.match(/Became (Public|Private) Law No: (\d+-\d+)/);

        if (!match) {
          console.log(`  [SKIP] ${bill.bill_id}: Could not parse law number from: "${bill.latest_action_text}"`);
          stats.failed++;
          continue;
        }

        const lawType = match[1] + ' Law';
        const lawNumber = match[2];

        // Check if already set
        if (bill.law_type === lawType && bill.law_number === lawNumber) {
          console.log(`  [OK] ${bill.bill_id}: Already has ${lawType} ${lawNumber}`);
          stats.alreadySet++;
          continue;
        }

        console.log(`  [UPDATE] ${bill.bill_id}: ${lawType} ${lawNumber}`);

        if (!dryRun) {
          // Update bill table
          await pool.query(`
            UPDATE bill
            SET law_type = $1, law_number = $2, updated_at = CURRENT_TIMESTAMP
            WHERE bill_id = $3
          `, [lawType, lawNumber, bill.bill_id]);

          // Insert into bill_law table
          const insertResult = await pool.query(`
            INSERT INTO bill_law (bill_id, law_type, law_number)
            VALUES ($1, $2, $3)
            ON CONFLICT (bill_id, law_type, law_number) DO NOTHING
            RETURNING law_id
          `, [bill.bill_id, lawType, lawNumber]);

          if (insertResult.rows.length > 0) {
            stats.billLawInserted++;
          }
        }

        stats.updated++;

      } catch (error) {
        console.error(`  [ERROR] ${bill.bill_id}: ${error.message}`);
        stats.failed++;
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));
    console.log(`  Bills updated:        ${stats.updated}`);
    console.log(`  Already set:          ${stats.alreadySet}`);
    console.log(`  Bill_law inserted:    ${stats.billLawInserted}`);
    console.log(`  Failed/skipped:       ${stats.failed}`);
    console.log(`  Total processed:      ${bills.rows.length}`);
    console.log('');

    if (dryRun) {
      console.log('This was a DRY RUN. No changes were made.');
      console.log('Run without --dry-run to apply changes.');
    }

    return stats;

  } finally {
    await pool.end();
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--congress=')) {
      options.congress = parseInt(arg.split('=')[1]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node backfill-law-data.js [options]

Options:
  --congress=N    Only process bills from congress N (e.g., --congress=119)
  --dry-run       Show what would be done without making changes
  --help, -h      Show this help message

Examples:
  node backfill-law-data.js                    # Backfill all congresses
  node backfill-law-data.js --congress=119     # Only 119th Congress
  node backfill-law-data.js --dry-run          # Preview changes
`);
      process.exit(0);
    }
  }

  return options;
}

// Main execution
if (require.main === module) {
  const options = parseArgs();

  backfillLaws(options)
    .then(() => {
      console.log('Backfill complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Backfill failed:', error);
      process.exit(1);
    });
}

module.exports = backfillLaws;
