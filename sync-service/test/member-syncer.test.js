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

// upsertMember only uses this.db.query, so give an isolated prototype instance a
// recording db and read back the statement it would send to Postgres.
function captureUpsertMember() {
  const instance = Object.create(MemberSyncer.prototype);
  let captured = null;
  instance.db = {
    query: async (text, params) => {
      captured = { text, params };
      return { rowCount: 1, rows: [{ bioguide_id: params[0], inserted: true }] };
    }
  };
  return instance.upsertMember({ bioguide_id: 'F000484', first_name: 'Randy', last_name: 'Fine' })
    .then(() => captured);
}

// Pull the INSERT column list and the ON CONFLICT ... DO UPDATE SET targets out of
// the statement so the test follows the SQL rather than a hardcoded copy of it.
function insertedColumns(text) {
  const open = text.indexOf('INSERT INTO member (') + 'INSERT INTO member ('.length;
  return text.slice(open, text.indexOf(') VALUES'))
    .split(',').map(s => s.trim()).filter(Boolean);
}

function refreshedColumns(text) {
  const setClause = text.slice(
    text.indexOf('DO UPDATE SET') + 'DO UPDATE SET'.length,
    text.indexOf('RETURNING')
  );
  return [...setClause.matchAll(/^\s*(\w+)\s*=/gm)].map(m => m[1]);
}

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

  await test('upsertMember refreshes every column it inserts, so a stub row converges to a full row', async () => {
    const { text } = await captureUpsertMember();
    const inserted = insertedColumns(text);
    const refreshed = refreshedColumns(text);

    // bioguide_id is the conflict key, so it is the one column that must not be reassigned.
    const stranded = inserted.filter(col => col !== 'bioguide_id' && !refreshed.includes(col));
    assert.deepStrictEqual(stranded, [],
      `these columns are written on INSERT but never refreshed on conflict, so a stub row ` +
      `keeps its NULLs forever: ${stranded.join(', ')}`);
  });

  await test('a sync that omits a stable biographical field cannot blank an existing value', async () => {
    const { text } = await captureUpsertMember();

    // Congress.gov omitting a field in one response is not the same as asserting it
    // is now empty, so these must preserve on null rather than overwrite.
    const preserveOnNull = [
      'middle_name', 'suffix_name', 'nickname', 'direct_order_name', 'inverted_order_name',
      'honorific_name', 'birth_year', 'death_year', 'depiction_url', 'depiction_attribution',
      'official_url'
    ];

    for (const col of preserveOnNull) {
      const pattern = new RegExp(`${col}\\s*=\\s*COALESCE\\(\\s*EXCLUDED\\.${col}\\s*,\\s*member\\.${col}\\s*\\)`, 'i');
      assert.ok(pattern.test(text),
        `${col} must be COALESCE(EXCLUDED.${col}, member.${col}) so a missing field does not blank a good value`);
    }
  });

  await test('current_member is a straight overwrite so a member leaving office is recorded', async () => {
    const { text } = await captureUpsertMember();

    assert.ok(/current_member\s*=\s*EXCLUDED\.current_member/i.test(text),
      'current_member must take the incoming value directly');
    assert.ok(!/current_member\s*=\s*COALESCE/i.test(text),
      'current_member must not be preserve-on-null: a member becoming false must always win');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
