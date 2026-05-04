#!/usr/bin/env node
/**
 * Backfill Bill Summaries
 *
 * Generates AI summaries for bills that have text but no summaries.
 * Uses parallel workers to speed up processing.
 *
 * Usage:
 *   node backfill-bill-summaries.js [--limit=N] [--workers=N] [--congress=N]
 *
 * Options:
 *   --limit=N     Number of bills to process (default: 100)
 *   --workers=N   Number of parallel workers (default: 4)
 *   --congress=N  Congress number to filter (default: 119)
 *   --dry-run     Show what would be processed without generating
 */

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const { Pool } = require('pg');
const billSummaryService = require('../backend/services/bill-summary-service');

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.replace('--', '').split('=');
    acc[key] = value === undefined ? true : value;
    return acc;
}, {});

const CONFIG = {
    limit: parseInt(args.limit) || 100,
    workers: parseInt(args.workers) || 4,
    congress: parseInt(args.congress) || 119,
    dryRun: args['dry-run'] || false
};

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'congress_api',
    user: process.env.DB_USER || 'congress_admin',
    password: process.env.DB_PASSWORD
});

// Stats tracking
const stats = {
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    startTime: null,
    errors: []
};

/**
 * Get bills that need summaries
 */
async function getBillsNeedingSummaries() {
    const query = `
        SELECT
            b.bill_id,
            b.bill_type,
            b.bill_number,
            b.congress_id,
            b.title,
            btv.version_code,
            btv.full_text_url
        FROM bill b
        JOIN bill_text_version btv ON b.bill_id = btv.bill_id
        LEFT JOIN bill_ai_summary bas ON b.bill_id = bas.bill_id
        WHERE b.congress_id = $1
          AND bas.bill_id IS NULL
          AND btv.full_text IS NOT NULL
          AND LENGTH(btv.full_text) > 100
        ORDER BY b.latest_action_date DESC NULLS LAST
        LIMIT $2
    `;

    const result = await pool.query(query, [CONFIG.congress, CONFIG.limit]);
    return result.rows;
}

/**
 * Get bill text for a bill
 */
async function getBillText(billId) {
    const query = `
        SELECT full_text, version_code
        FROM bill_text_version
        WHERE bill_id = $1
        ORDER BY
            CASE version_code
                WHEN 'ENR' THEN 1
                WHEN 'EAS' THEN 2
                WHEN 'EAH' THEN 3
                WHEN 'RFS' THEN 4
                WHEN 'RFH' THEN 5
                WHEN 'RS' THEN 6
                WHEN 'RH' THEN 7
                WHEN 'IS' THEN 8
                WHEN 'IH' THEN 9
                ELSE 10
            END
        LIMIT 1
    `;

    const result = await pool.query(query, [billId]);
    return result.rows[0] || null;
}

/**
 * Process a single bill
 */
async function processBill(bill) {
    const billId = bill.bill_id;
    const startTime = Date.now();

    try {
        // Get bill text
        const textData = await getBillText(billId);

        if (!textData || !textData.full_text) {
            console.log(`  [SKIP] ${billId} - No text available`);
            stats.skipped++;
            return { success: false, skipped: true };
        }

        if (CONFIG.dryRun) {
            console.log(`  [DRY-RUN] Would process ${billId} (${textData.full_text.length} chars)`);
            return { success: true, dryRun: true };
        }

        // Generate all summaries
        console.log(`  [GENERATING] ${billId} (${textData.full_text.length} chars)...`);

        const results = await billSummaryService.generateAndSaveAll(
            billId,
            textData.full_text,
            textData.version_code
        );

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  [SUCCESS] ${billId} - Generated ${results.length} summaries in ${elapsed}s`);

        stats.success++;
        return { success: true, results };

    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`  [ERROR] ${billId} - ${error.message} (${elapsed}s)`);
        stats.failed++;
        stats.errors.push({ billId, error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Worker function - processes bills from queue
 */
async function worker(workerId, queue) {
    console.log(`Worker ${workerId} started`);

    while (queue.length > 0) {
        const bill = queue.shift();
        if (!bill) break;

        stats.processed++;
        const progress = `[${stats.processed}/${stats.total}]`;
        console.log(`${progress} Worker ${workerId}: Processing ${bill.bill_id}`);

        await processBill(bill);

        // Small delay between bills to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`Worker ${workerId} finished`);
}

/**
 * Main function
 */
async function main() {
    console.log('='.repeat(60));
    console.log('Bill Summary Backfill');
    console.log('='.repeat(60));
    console.log(`Congress: ${CONFIG.congress}`);
    console.log(`Limit: ${CONFIG.limit} bills`);
    console.log(`Workers: ${CONFIG.workers}`);
    console.log(`Dry Run: ${CONFIG.dryRun}`);
    console.log('='.repeat(60));

    stats.startTime = Date.now();

    try {
        // Get bills needing summaries
        console.log('\nFetching bills that need summaries...');
        const bills = await getBillsNeedingSummaries();
        stats.total = bills.length;

        console.log(`Found ${bills.length} bills to process\n`);

        if (bills.length === 0) {
            console.log('No bills need summaries. Exiting.');
            return;
        }

        // Create a shared queue
        const queue = [...bills];

        // Start workers
        const workers = [];
        for (let i = 1; i <= CONFIG.workers; i++) {
            workers.push(worker(i, queue));
        }

        // Wait for all workers to complete
        await Promise.all(workers);

        // Print summary
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
        console.log('\n' + '='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total bills:     ${stats.total}`);
        console.log(`Processed:       ${stats.processed}`);
        console.log(`Successful:      ${stats.success}`);
        console.log(`Failed:          ${stats.failed}`);
        console.log(`Skipped:         ${stats.skipped}`);
        console.log(`Time elapsed:    ${elapsed}s`);

        if (stats.success > 0) {
            const avgTime = (elapsed / stats.success).toFixed(1);
            console.log(`Avg time/bill:   ${avgTime}s`);
        }

        if (stats.errors.length > 0) {
            console.log('\nErrors:');
            stats.errors.slice(0, 10).forEach(e => {
                console.log(`  - ${e.billId}: ${e.error}`);
            });
            if (stats.errors.length > 10) {
                console.log(`  ... and ${stats.errors.length - 10} more`);
            }
        }

        console.log('='.repeat(60));

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run
main().catch(console.error);
