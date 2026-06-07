'use strict';

// Unit tests for MemberSyncer. No test framework is installed, so this is a
// standalone assert-based script:  node test/member-syncer.test.js
//   exit 0 = all pass, exit 1 = a failure.

const assert = require('assert');
const MemberSyncer = require('../syncers/member-syncer');

// transformPreviousNames / syncMemberSubEntity don't use `this`, so build an
// instance off the prototype to avoid opening a DB pool or API client.
const syncer = Object.create(MemberSyncer.prototype);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${name}\n         ${err.message}`);
    failed++;
  }
}

// The exact malformed payload Congress.gov returns for the 2025 special-election
// members (Randy Fine F000484, Jimmy Patronis P000622): all four entries are the
// same name, and index [2] has endDate ~26 days BEFORE startDate — which violates
// the member_previous_names check constraint (end_date >= start_date).
const malformedPreviousNames = [
  { firstName: 'Randy', lastName: 'Fine', directOrderName: 'Randy Fine', startDate: '2025-04-02T04:00:00Z', endDate: '2025-04-28T13:04:16Z' },
  { firstName: 'Randy', lastName: 'Fine', directOrderName: 'Randy Fine', startDate: '2025-04-28T13:04:17Z', endDate: '2025-04-28T13:06:18Z' },
  { firstName: 'Randy', lastName: 'Fine', directOrderName: 'Randy Fine', startDate: '2025-04-28T13:06:19Z', endDate: '2025-04-02T03:59:59Z' },
  { firstName: 'Randy', lastName: 'Fine', directOrderName: 'Randy Fine', startDate: '2025-04-02T04:00:00Z' }
];

(async () => {
  await test('transformPreviousNames drops rows whose end_date precedes start_date', () => {
    const rows = syncer.transformPreviousNames(malformedPreviousNames, 'F000484');
    assert.strictEqual(rows.length, 3, `expected the 1 inverted row dropped (3 remain), got ${rows.length}`);
    for (const r of rows) {
      if (r.start_date && r.end_date) {
        assert.ok(
          r.end_date >= r.start_date,
          `surviving row violates end_date >= start_date: start=${r.start_date.toISOString()} end=${r.end_date.toISOString()}`
        );
      }
    }
    assert.ok(
      rows.some(r => r.start_date && r.end_date === null),
      'the valid open-ended (current) name should be preserved, not over-filtered'
    );
  });

  await test('syncMemberSubEntity isolates a failing sub-sync so later steps still run', async () => {
    const order = [];
    await syncer.syncMemberSubEntity('TEST', 'explodes', async () => {
      order.push('explodes');
      throw new Error('boom');
    });
    await syncer.syncMemberSubEntity('TEST', 'runs-after', async () => {
      order.push('runs-after');
    });
    assert.deepStrictEqual(order, ['explodes', 'runs-after'],
      'a thrown sub-sync must be swallowed so subsequent sub-syncs still execute');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
