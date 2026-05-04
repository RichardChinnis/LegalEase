#!/usr/bin/env node
/**
 * Backfill Bill Text Versions
 *
 * This script finds bills that are missing text versions in the database,
 * queries the Congress.gov API for text information, and updates the database.
 *
 * Usage:
 *   node backfill-bill-text.js [--limit N] [--congress N] [--dry-run]
 *
 * Options:
 *   --limit N     Process only N bills (default: all)
 *   --congress N  Only process bills from congress N (default: all)
 *   --dry-run     Don't make changes, just show what would be done
 */

require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const axios = require('axios');

// Configuration from environment
const config = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'congress_api',
    user: process.env.DB_USER || 'congress_admin',
    password: process.env.DB_PASSWORD,
  },
  congressApi: {
    baseUrl: 'https://api.congress.gov/v3',
    apiKey: process.env.CONGRESS_API_KEY,
  }
};

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return null;
};

const LIMIT = getArg('--limit') ? parseInt(getArg('--limit'), 10) : null;
const CONGRESS_FILTER = getArg('--congress') ? parseInt(getArg('--congress'), 10) : null;
const DRY_RUN = args.includes('--dry-run');

// Stats tracking
const stats = {
  processed: 0,
  updated: 0,
  noTextAvailable: 0,
  errors: 0,
  apiCalls: 0,
  startTime: Date.now()
};

// Initialize database pool
const pool = new Pool(config.database);

// Rate limiting: 500ms between API calls
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch text versions from Congress.gov API
 */
async function fetchBillTextVersions(congress, billType, billNumber) {
  const url = `${config.congressApi.baseUrl}/bill/${congress}/${billType}/${billNumber}/text`;

  try {
    stats.apiCalls++;
    const response = await axios.get(url, {
      params: {
        api_key: config.congressApi.apiKey,
        format: 'json'
      },
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      // No text versions available for this bill
      return null;
    }
    throw error;
  }
}

/**
 * Upsert a text version into the database
 */
async function upsertTextVersion(billId, textVersion) {
  const formats = textVersion.formats?.map(f => ({
    type: f.type,
    url: f.url
  })) || [];

  // Parse date - handle null/undefined
  let versionDate = null;
  if (textVersion.date) {
    versionDate = textVersion.date.split('T')[0]; // Get just the date part
  }

  if (versionDate === null) {
    // Handle NULL dates with manual check
    const checkQuery = `
      SELECT text_version_id FROM bill_text_version
      WHERE bill_id = $1 AND version_type = $2 AND version_date IS NULL
      LIMIT 1`;

    const existing = await pool.query(checkQuery, [billId, textVersion.type]);

    if (existing.rows.length > 0) {
      // Update existing
      await pool.query(`
        UPDATE bill_text_version
        SET formats = $1
        WHERE text_version_id = $2`,
        [JSON.stringify(formats), existing.rows[0].text_version_id]
      );
    } else {
      // Insert new
      await pool.query(`
        INSERT INTO bill_text_version (bill_id, version_type, version_date, formats)
        VALUES ($1, $2, NULL, $3)`,
        [billId, textVersion.type, JSON.stringify(formats)]
      );
    }
  } else {
    // Standard upsert with date
    await pool.query(`
      INSERT INTO bill_text_version (bill_id, version_type, version_date, formats)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (bill_id, version_type, version_date)
      DO UPDATE SET formats = EXCLUDED.formats`,
      [billId, textVersion.type, versionDate, JSON.stringify(formats)]
    );
  }
}

/**
 * Get bills that are missing text versions
 */
async function getBillsWithoutText() {
  let query = `
    SELECT b.bill_id, b.congress_id, b.bill_type, b.bill_number, b.title
    FROM bill b
    WHERE NOT EXISTS (
      SELECT 1 FROM bill_text_version t WHERE t.bill_id = b.bill_id
    )
  `;

  const params = [];

  if (CONGRESS_FILTER) {
    params.push(CONGRESS_FILTER);
    query += ` AND b.congress_id = $${params.length}`;
  }

  query += ` ORDER BY b.congress_id DESC, b.introduced_date DESC`;

  if (LIMIT) {
    params.push(LIMIT);
    query += ` LIMIT $${params.length}`;
  }

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Process a single bill
 */
async function processBill(bill) {
  const { bill_id, congress_id, bill_type, bill_number, title } = bill;

  try {
    // Fetch text versions from API
    const textData = await fetchBillTextVersions(congress_id, bill_type, bill_number);

    if (!textData?.textVersions || textData.textVersions.length === 0) {
      stats.noTextAvailable++;
      console.log(`  [NO TEXT] ${bill_id}: No text versions available`);
      return;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${bill_id}: Would add ${textData.textVersions.length} text version(s)`);
      stats.updated++;
      return;
    }

    // Insert each text version
    for (const textVersion of textData.textVersions) {
      await upsertTextVersion(bill_id, textVersion);
    }

    stats.updated++;
    console.log(`  [UPDATED] ${bill_id}: Added ${textData.textVersions.length} text version(s)`);

  } catch (error) {
    stats.errors++;
    console.error(`  [ERROR] ${bill_id}: ${error.message}`);
  }

  stats.processed++;
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('BILL TEXT VERSION BACKFILL');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  Database: ${config.database.database}@${config.database.host}`);
  console.log(`  API Key: ${config.congressApi.apiKey ? '****' + config.congressApi.apiKey.slice(-4) : 'NOT SET'}`);
  console.log(`  Limit: ${LIMIT || 'None (all bills)'}`);
  console.log(`  Congress Filter: ${CONGRESS_FILTER || 'None (all congresses)'}`);
  console.log(`  Dry Run: ${DRY_RUN}`);
  console.log('');

  if (!config.congressApi.apiKey) {
    console.error('ERROR: CONGRESS_API_KEY not set in environment');
    process.exit(1);
  }

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('Database connection: OK');

    // Get bills without text
    console.log('');
    console.log('Finding bills without text versions...');
    const bills = await getBillsWithoutText();
    console.log(`Found ${bills.length} bills to process`);
    console.log('');

    if (bills.length === 0) {
      console.log('No bills need text backfill!');
      return;
    }

    console.log('Processing bills...');
    console.log('-'.repeat(60));

    for (let i = 0; i < bills.length; i++) {
      const bill = bills[i];

      // Progress indicator every 50 bills
      if (i > 0 && i % 50 === 0) {
        const elapsed = (Date.now() - stats.startTime) / 1000;
        const rate = stats.processed / elapsed;
        const remaining = (bills.length - i) / rate;
        console.log('');
        console.log(`Progress: ${i}/${bills.length} (${((i/bills.length)*100).toFixed(1)}%)`);
        console.log(`  Updated: ${stats.updated}, No Text: ${stats.noTextAvailable}, Errors: ${stats.errors}`);
        console.log(`  API Calls: ${stats.apiCalls}, Rate: ${rate.toFixed(1)}/sec, ETA: ${(remaining/60).toFixed(1)} min`);
        console.log('');
      }

      await processBill(bill);

      // Rate limiting
      await delay(500);
    }

    // Final stats
    console.log('');
    console.log('='.repeat(60));
    console.log('BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Results:');
    console.log(`  Bills Processed: ${stats.processed}`);
    console.log(`  Bills Updated: ${stats.updated}`);
    console.log(`  No Text Available: ${stats.noTextAvailable}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  API Calls Made: ${stats.apiCalls}`);
    console.log(`  Duration: ${((Date.now() - stats.startTime) / 1000 / 60).toFixed(1)} minutes`);

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
