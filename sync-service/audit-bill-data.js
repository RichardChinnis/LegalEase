#!/usr/bin/env node
/**
 * Bill Data Audit Script
 *
 * Checks data quality for Congress 119 bills:
 * - Bills missing actions
 * - Bills missing sponsors
 * - Bills missing titles
 * - Bills missing summaries
 * - Bills missing text versions
 * - Bills missing cosponsors (for those that should have them)
 */

const DatabaseService = require('./lib/database');
const logger = require('./lib/logger');

class BillDataAudit {
  constructor(options = {}) {
    this.db = new DatabaseService();
    this.congress = options.congress || 119;
    this.results = {};
  }

  async runQuery(name, sql, params = []) {
    try {
      const result = await this.db.query(sql, params);
      return result.rows;
    } catch (error) {
      logger.error(`Query failed for ${name}:`, error.message);
      return [];
    }
  }

  async audit() {
    logger.info('='.repeat(60));
    logger.info(`Bill Data Audit - Congress ${this.congress}`);
    logger.info('='.repeat(60));

    // Total bills
    const totalBills = await this.runQuery('total', `
      SELECT COUNT(*) as count FROM bill WHERE congress_id = $1
    `, [this.congress]);
    const total = parseInt(totalBills[0]?.count || 0);
    logger.info(`\nTotal bills: ${total}`);

    // Bills by type
    const byType = await this.runQuery('byType', `
      SELECT bill_type::text, COUNT(*) as count
      FROM bill WHERE congress_id = $1
      GROUP BY bill_type ORDER BY bill_type
    `, [this.congress]);
    logger.info('\nBills by type:');
    byType.forEach(r => logger.info(`  ${r.bill_type.toUpperCase()}: ${r.count}`));

    // Bills missing actions
    const missingActions = await this.runQuery('missingActions', `
      SELECT b.bill_id, b.bill_type::text, b.bill_number
      FROM bill b
      LEFT JOIN action a ON b.bill_id = a.bill_id
      WHERE b.congress_id = $1
      GROUP BY b.bill_id, b.bill_type, b.bill_number
      HAVING COUNT(a.action_id) = 0
    `, [this.congress]);
    this.results.missingActions = missingActions;
    logger.info(`\nBills missing actions: ${missingActions.length}`);
    if (missingActions.length > 0 && missingActions.length <= 20) {
      missingActions.forEach(b => logger.info(`  - ${b.bill_id}`));
    } else if (missingActions.length > 20) {
      missingActions.slice(0, 10).forEach(b => logger.info(`  - ${b.bill_id}`));
      logger.info(`  ... and ${missingActions.length - 10} more`);
    }

    // Bills missing sponsors
    const missingSponsors = await this.runQuery('missingSponsors', `
      SELECT b.bill_id, b.bill_type::text, b.bill_number
      FROM bill b
      LEFT JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
      WHERE b.congress_id = $1 AND bs.bill_id IS NULL
    `, [this.congress]);
    this.results.missingSponsors = missingSponsors;
    logger.info(`\nBills missing sponsors: ${missingSponsors.length}`);
    if (missingSponsors.length > 0 && missingSponsors.length <= 20) {
      missingSponsors.forEach(b => logger.info(`  - ${b.bill_id}`));
    }

    // Bills missing titles (beyond the main title)
    const missingTitles = await this.runQuery('missingTitles', `
      SELECT b.bill_id, b.bill_type::text, b.bill_number
      FROM bill b
      LEFT JOIN bill_title bt ON b.bill_id = bt.bill_id
      WHERE b.congress_id = $1
      GROUP BY b.bill_id, b.bill_type, b.bill_number
      HAVING COUNT(bt.title_id) = 0
    `, [this.congress]);
    this.results.missingTitles = missingTitles;
    logger.info(`\nBills missing titles table entries: ${missingTitles.length}`);

    // Bills with cosponsors_count > 0 but no cosponsor records
    const missingCosponsors = await this.runQuery('missingCosponsors', `
      SELECT b.bill_id, b.bill_type::text, b.bill_number, b.cosponsors_count
      FROM bill b
      LEFT JOIN bill_cosponsor bc ON b.bill_id = bc.bill_id
      WHERE b.congress_id = $1
        AND COALESCE(b.cosponsors_count, 0) > 0
      GROUP BY b.bill_id, b.bill_type, b.bill_number, b.cosponsors_count
      HAVING COUNT(bc.bill_id) = 0
    `, [this.congress]);
    this.results.missingCosponsors = missingCosponsors;
    logger.info(`\nBills with cosponsors but no cosponsor records: ${missingCosponsors.length}`);

    // Bills missing summaries
    const missingSummaries = await this.runQuery('missingSummaries', `
      SELECT b.bill_id, b.bill_type::text, b.bill_number
      FROM bill b
      LEFT JOIN bill_summary bs ON b.bill_id = bs.bill_id
      WHERE b.congress_id = $1
      GROUP BY b.bill_id, b.bill_type, b.bill_number
      HAVING COUNT(bs.summary_id) = 0
    `, [this.congress]);
    this.results.missingSummaries = missingSummaries;
    logger.info(`\nBills missing summaries: ${missingSummaries.length}`);

    // Bills missing text versions
    const missingText = await this.runQuery('missingText', `
      SELECT b.bill_id, b.bill_type::text, b.bill_number
      FROM bill b
      LEFT JOIN bill_text_version btv ON b.bill_id = btv.bill_id
      WHERE b.congress_id = $1
      GROUP BY b.bill_id, b.bill_type, b.bill_number
      HAVING COUNT(btv.version_id) = 0
    `, [this.congress]);
    this.results.missingText = missingText;
    logger.info(`\nBills missing text versions: ${missingText.length}`);

    // Action stats
    const actionStats = await this.runQuery('actionStats', `
      SELECT
        COUNT(DISTINCT a.bill_id) as bills_with_actions,
        COUNT(*) as total_actions,
        ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT a.bill_id), 0), 1) as avg_actions_per_bill
      FROM action a
      JOIN bill b ON a.bill_id = b.bill_id
      WHERE b.congress_id = $1
    `, [this.congress]);
    logger.info(`\nAction statistics:`);
    logger.info(`  Bills with actions: ${actionStats[0]?.bills_with_actions || 0}`);
    logger.info(`  Total actions: ${actionStats[0]?.total_actions || 0}`);
    logger.info(`  Avg actions per bill: ${actionStats[0]?.avg_actions_per_bill || 0}`);

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('AUDIT SUMMARY');
    logger.info('='.repeat(60));

    const issues = [];
    if (missingActions.length > 0) issues.push(`${missingActions.length} bills missing actions`);
    if (missingSponsors.length > 0) issues.push(`${missingSponsors.length} bills missing sponsors`);
    if (missingCosponsors.length > 0) issues.push(`${missingCosponsors.length} bills need cosponsor sync`);

    if (issues.length === 0) {
      logger.info('All critical data present!');
    } else {
      logger.info('Issues found:');
      issues.forEach(i => logger.info(`  - ${i}`));
    }

    // Note about expected missing data
    logger.info('\nNote: Missing summaries and text versions are normal for');
    logger.info('recently introduced bills that haven\'t been processed yet.');

    await this.db.close();
    return this.results;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const congress = args.find(a => a.startsWith('--congress='))?.split('=')[1] || 119;

  const audit = new BillDataAudit({ congress: parseInt(congress) });

  try {
    await audit.audit();
    process.exit(0);
  } catch (error) {
    logger.error('Audit failed:', error);
    process.exit(1);
  }
}

main();
