#!/usr/bin/env node
/**
 * One-time catch-up sync script for bills
 * Fetches 10 pages (2500 bills) with extra throttling
 */

require('dotenv').config({ path: '.env' });
const BillSyncer = require('./syncers/bill-syncer');
const { logger } = require('./lib/logger');

const PAGES_TO_FETCH = 10;  // 2500 bills
const DELAY_BETWEEN_BATCHES_MS = 2000;  // 2 seconds between batches
const PROGRESS_INTERVAL = 10;  // Report every 10 bills

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCatchupSync() {
  console.log('='.repeat(60));
  console.log('CATCH-UP BILL SYNC');
  console.log(`Fetching ${PAGES_TO_FETCH} pages (${PAGES_TO_FETCH * 250} bills max)`);
  console.log('Started:', new Date().toISOString());
  console.log('='.repeat(60));

  const syncer = new BillSyncer();
  const stats = {
    total: 0,
    inserted: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  try {
    // Fetch bill list (10 pages)
    console.log('\nFetching bill list...');
    const bills = await syncer.client.fetchAllPages(
      (p) => syncer.client.getBills(119, p),
      { sort: 'updateDate desc' },
      PAGES_TO_FETCH
    );

    stats.total = bills.length;
    console.log(`Found ${bills.length} bills to process\n`);

    // Filter bills that need syncing
    const billsToSync = [];
    console.log('Checking which bills need updates...');

    for (let i = 0; i < bills.length; i++) {
      const bill = bills[i];

      // Check if bill exists and is up to date
      const existingBill = await syncer.db.query(`
        SELECT api_update_date FROM bill
        WHERE congress_id = 119 AND bill_type = $1 AND bill_number = $2
      `, [bill.type.toLowerCase(), bill.number]);

      if (existingBill.rows.length === 0) {
        billsToSync.push(bill);
      } else {
        const dbUpdateDate = new Date(existingBill.rows[0].api_update_date);
        const apiUpdateDate = new Date(bill.updateDate);
        if (apiUpdateDate > dbUpdateDate) {
          billsToSync.push(bill);
        } else {
          stats.skipped++;
        }
      }

      // Progress for filtering
      if ((i + 1) % 500 === 0) {
        console.log(`  Checked ${i + 1}/${bills.length}...`);
      }
    }

    console.log(`Bills needing sync: ${billsToSync.length}`);
    console.log(`Bills already up-to-date: ${stats.skipped}\n`);

    if (billsToSync.length === 0) {
      console.log('All bills are up to date!');
      return;
    }

    // Process bills one at a time with progress
    const startTime = Date.now();
    for (let i = 0; i < billsToSync.length; i++) {
      const bill = billsToSync[i];
      const billId = `${bill.type} ${bill.number}`;

      try {
        await syncer.syncBillWithDetails(119, bill.type, bill.number);

        // Check if it was insert or update
        const result = await syncer.db.query(`
          SELECT created_at, updated_at FROM bill
          WHERE congress_id = 119 AND bill_type = $1 AND bill_number = $2
        `, [bill.type.toLowerCase(), bill.number]);

        if (result.rows.length > 0) {
          const row = result.rows[0];
          if (Math.abs(new Date(row.created_at) - new Date(row.updated_at)) < 1000) {
            stats.inserted++;
          } else {
            stats.updated++;
          }
        }

      } catch (error) {
        stats.failed++;
        stats.errors.push({ bill: billId, error: error.message });
        console.error(`  ERROR: ${billId} - ${error.message}`);
      }

      // Progress report
      if ((i + 1) % PROGRESS_INTERVAL === 0 || i === billsToSync.length - 1) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (i + 1) / elapsed;
        const remaining = (billsToSync.length - i - 1) / rate;

        console.log(`Progress: ${i + 1}/${billsToSync.length} (${((i + 1) / billsToSync.length * 100).toFixed(1)}%) | ` +
          `Rate: ${rate.toFixed(1)}/sec | ETA: ${Math.ceil(remaining / 60)} min`);
      }

      // Extra delay every 10 bills to be gentle
      if ((i + 1) % 10 === 0) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    // Update sync status
    await syncer.db.query(`
      INSERT INTO sync_status (entity_type, last_sync_at, last_successful_sync, records_synced, records_failed, sync_metadata)
      VALUES ('bills', NOW(), NOW(), $1, $2, $3)
    `, [stats.inserted + stats.updated, stats.failed, JSON.stringify({
      type: 'catchup',
      pages: PAGES_TO_FETCH,
      stats
    })]);

  } catch (error) {
    console.error('Sync failed:', error.message);
    console.error(error.stack);
  } finally {
    await syncer.close();

    console.log('\n' + '='.repeat(60));
    console.log('SYNC COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total bills fetched: ${stats.total}`);
    console.log(`Skipped (up-to-date): ${stats.skipped}`);
    console.log(`Inserted: ${stats.inserted}`);
    console.log(`Updated: ${stats.updated}`);
    console.log(`Failed: ${stats.failed}`);

    if (stats.errors.length > 0) {
      console.log(`\nFirst 10 errors:`);
      stats.errors.slice(0, 10).forEach((e, i) => {
        console.log(`  ${i + 1}. ${e.bill}: ${e.error}`);
      });
    }

    console.log('\nFinished:', new Date().toISOString());
  }
}

runCatchupSync();
