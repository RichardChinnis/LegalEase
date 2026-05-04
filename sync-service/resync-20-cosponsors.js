#!/usr/bin/env node
/**
 * Re-sync bills that have exactly 20 cosponsors
 * These bills likely hit the old pagination limit and need to fetch all cosponsors
 */

const { Pool } = require('pg');
const BillSyncer = require('./syncers/bill-syncer');
const config = require('./config');
const logger = require('./lib/logger');

async function main() {
  const pool = new Pool(config.database);
  const syncer = new BillSyncer();

  try {
    // Find all bills with exactly 20 cosponsors
    const result = await pool.query(`
      SELECT b.bill_id, b.congress_id, b.bill_type, b.bill_number, COUNT(*) as cosponsor_count
      FROM bill b
      JOIN bill_cosponsor bc ON b.bill_id = bc.bill_id
      GROUP BY b.bill_id, b.congress_id, b.bill_type, b.bill_number
      HAVING COUNT(*) = 20
      ORDER BY b.congress_id DESC, b.bill_id
    `);

    const bills = result.rows;
    console.log(`Found ${bills.length} bills with exactly 20 cosponsors to re-sync\n`);

    if (bills.length === 0) {
      console.log('No bills to sync.');
      return;
    }

    // Process in batches
    const batchSize = 5;
    let processed = 0;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < bills.length; i += batchSize) {
      const batch = bills.slice(i, i + batchSize);

      await Promise.all(batch.map(async (bill) => {
        try {
          // Get current cosponsor count from API to check if we need to sync
          const cosponsorsData = await syncer.client.getAllBillCosponsors(
            bill.congress_id,
            bill.bill_type,
            bill.bill_number
          );

          const apiCount = cosponsorsData.cosponsors?.length || 0;

          if (apiCount > 20) {
            console.log(`[${bill.bill_id}] DB: 20, API: ${apiCount} - Syncing...`);
            await syncer.syncBillCosponsors(bill.bill_id, cosponsorsData);
            updated++;
          } else {
            console.log(`[${bill.bill_id}] DB: 20, API: ${apiCount} - Already correct, skipping`);
          }

          processed++;
        } catch (error) {
          console.error(`[${bill.bill_id}] Error: ${error.message}`);
          failed++;
          processed++;
        }
      }));

      // Progress update
      const pct = Math.round((processed / bills.length) * 100);
      console.log(`\nProgress: ${processed}/${bills.length} (${pct}%) - Updated: ${updated}, Failed: ${failed}\n`);
    }

    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Total bills checked: ${processed}`);
    console.log(`Bills updated: ${updated}`);
    console.log(`Bills already correct: ${processed - updated - failed}`);
    console.log(`Failed: ${failed}`);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
    await syncer.close();
  }
}

main();
