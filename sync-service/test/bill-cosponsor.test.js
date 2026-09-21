'use strict';

// Unit tests for the bill cosponsor write path: DatabaseService.ensureMemberStub
// and BillSyncer.syncBillCosponsors. No test framework is installed, so this is a
// standalone assert-based script:  node test/bill-cosponsor.test.js
//   exit 0 = all pass, exit 1 = a failure.

const assert = require('assert');
const BillSyncer = require('../syncers/bill-syncer');
const DatabaseService = require('../lib/database');

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

// ensureMemberStub only uses this.query, so build an instance off the prototype to
// avoid opening a DB pool, and record the statements it would send.
function recordingDb() {
  const db = Object.create(DatabaseService.prototype);
  db.calls = [];
  db.query = async (text, params) => {
    db.calls.push({ text, params });
    return { rowCount: 1, rows: [{ bioguide_id: params[0] }] };
  };
  return db;
}

// A fake db that mirrors the one constraint under test: bill_cosponsor.bioguide_id
// REFERENCES member(bioguide_id), so writing a cosponsor whose member row is absent
// fails exactly the way Postgres fails it.
function fakeDb({ members = [], rejectCosponsor = () => false } = {}) {
  const db = {
    members: new Set(members),
    cosponsors: [],
    sponsors: [],
    stubbed: [],
    async ensureMemberStub(memberData) {
      if (!memberData?.bioguide_id) throw new Error('ensureMemberStub requires a bioguide_id');
      db.stubbed.push(memberData);
      const inserted = !db.members.has(memberData.bioguide_id);
      db.members.add(memberData.bioguide_id);
      return { bioguide_id: memberData.bioguide_id, inserted };
    },
    async upsertBillSponsor(sponsorData) {
      if (!db.members.has(sponsorData.bioguide_id)) {
        throw new Error('insert or update on table "bill_sponsor" violates foreign key ' +
          'constraint "bill_sponsor_member_bioguide_id_fkey"');
      }
      db.sponsors.push(sponsorData);
      return { bill_id: sponsorData.bill_id, inserted: true };
    },
    async upsertBillCosponsor(cosponsorData) {
      if (!db.members.has(cosponsorData.bioguide_id)) {
        throw new Error('insert or update on table "bill_cosponsor" violates foreign key ' +
          'constraint "bill_cosponsor_bioguide_id_fkey"');
      }
      if (rejectCosponsor(cosponsorData)) {
        throw new Error(`write rejected for ${cosponsorData.bioguide_id}`);
      }
      db.cosponsors.push(cosponsorData);
      return { cosponsor_id: db.cosponsors.length, inserted: true };
    }
  };
  return db;
}

// syncBillCosponsors only uses this.db and this.stats, so build the syncer off the
// prototype to avoid opening a DB pool or API client.
function makeSyncer(db) {
  const syncer = Object.create(BillSyncer.prototype);
  syncer.db = db;
  syncer.stats = { inserted: 0, updated: 0, failed: 0, skipped: 0, apiCallsSaved: 0, errors: [] };
  return syncer;
}

// The Congress.gov cosponsor payload shape, as returned for a newly seated member.
function cosponsorPayload(bioguideId, lastName) {
  return {
    bioguideId,
    fullName: `Rep. ${lastName}, Test [R-FL-6]`,
    firstName: 'Test',
    middleName: null,
    lastName,
    party: 'R',
    state: 'FL',
    district: 6,
    sponsorshipDate: '2025-04-02',
    url: `https://api.congress.gov/v3/member/${bioguideId}`
  };
}

// A db that runs the real DatabaseService methods against a recording query(), so a
// test can inspect the parameters that would actually reach Postgres.
function recordingWriteDb() {
  const db = Object.create(DatabaseService.prototype);
  db.calls = [];
  db.query = async (text, params) => {
    db.calls.push({ text, params });
    return { rowCount: 1, rows: [{ cosponsor_id: 1, bill_id: params[0], bioguide_id: params[0], inserted: true }] };
  };
  return db;
}

// Read the value bound to a named column by matching the INSERT column list against
// the parameter array, so the assertion follows the statement instead of an index.
function boundValue(call, columnName) {
  const open = call.text.indexOf('(', call.text.indexOf('INSERT INTO')) + 1;
  const cols = call.text.slice(open, call.text.indexOf(') VALUES')).split(',').map(s => s.trim());
  const idx = cols.indexOf(columnName);
  assert.ok(idx >= 0, `${columnName} is not in the INSERT column list: ${cols.join(', ')}`);
  return call.params[idx];
}

function cosponsorInsert(db) {
  return db.calls.find(c => /INSERT INTO bill_cosponsor/i.test(c.text));
}

(async () => {
  await test('ensureMemberStub inserts a placeholder member and leaves an existing row alone', async () => {
    const db = recordingDb();

    await db.ensureMemberStub({
      bioguide_id: 'F000484',
      first_name: 'Randy',
      last_name: 'Fine'
    });

    assert.strictEqual(db.calls.length, 1, `expected exactly 1 statement, got ${db.calls.length}`);
    const { text, params } = db.calls[0];
    assert.ok(/INSERT\s+INTO\s+member\b/i.test(text), `expected an INSERT INTO member, got: ${text}`);
    assert.ok(
      /ON\s+CONFLICT\s*\(\s*bioguide_id\s*\)\s*DO\s+NOTHING/i.test(text),
      `an already-synced member must not be clobbered: expected ON CONFLICT (bioguide_id) DO NOTHING, got: ${text}`
    );
    assert.ok(params.includes('F000484'), 'bioguide_id must be sent as a bound parameter');
    assert.ok(!text.includes('F000484'), 'values must never be concatenated into the SQL text');
  });

  await test('a cosponsor seated before the monthly member sync is still written', async () => {
    // F000484 is a real case: Congress.gov listed the member as a cosponsor days
    // before the monthly member sync inserted them, so member(bioguide_id) was empty.
    const db = fakeDb({ members: [] });
    const syncer = makeSyncer(db);

    await syncer.syncBillCosponsors('119-HR-1', {
      cosponsors: [cosponsorPayload('F000484', 'Fine')]
    });

    assert.strictEqual(db.cosponsors.length, 1,
      'the cosponsor must be written even though the member row did not exist yet');
    assert.strictEqual(db.cosponsors[0].bioguide_id, 'F000484');
    const stub = db.stubbed.find(m => m.bioguide_id === 'F000484');
    assert.ok(stub, 'a member stub must be created before the cosponsor insert');
    assert.strictEqual(stub.last_name, 'Fine',
      'the stub should carry the names the cosponsor payload offers, not just the id');
  });

  await test('one unwritable cosponsor does not abort the rest of the bill', async () => {
    const db = fakeDb({ rejectCosponsor: c => c.bioguide_id === 'B000002' });
    const syncer = makeSyncer(db);

    await syncer.syncBillCosponsors('119-HR-1', {
      cosponsors: [
        cosponsorPayload('A000001', 'Able'),
        cosponsorPayload('B000002', 'Baker'),
        cosponsorPayload('C000003', 'Charlie')
      ]
    });

    assert.deepStrictEqual(
      db.cosponsors.map(c => c.bioguide_id),
      ['A000001', 'C000003'],
      'cosponsors after the failing one must still be written'
    );
  });

  await test('cosponsor failures are counted for the caller and the sync stats', async () => {
    const db = fakeDb({ rejectCosponsor: c => c.bioguide_id === 'B000002' });
    const syncer = makeSyncer(db);

    const result = await syncer.syncBillCosponsors('119-HR-1', {
      cosponsors: [
        cosponsorPayload('A000001', 'Able'),
        cosponsorPayload('B000002', 'Baker'),
        cosponsorPayload('C000003', 'Charlie')
      ]
    });

    assert.ok(result, 'syncBillCosponsors must report what it did instead of returning undefined');
    assert.strictEqual(result.synced, 2, `expected 2 synced, got ${result && result.synced}`);
    assert.strictEqual(result.failed, 1, `expected 1 failure, got ${result && result.failed}`);
    assert.strictEqual(syncer.stats.cosponsorsFailed, 1,
      'the failure must show up in the sync stats instead of staying invisible');
    assert.ok(
      syncer.stats.errors.some(e => e.bill === '119-HR-1' && e.bioguide_id === 'B000002'),
      'the recorded error must name the bill and the member that failed'
    );
  });

  await test('a malformed cosponsor payload is isolated instead of escaping the loop', async () => {
    const db = fakeDb();
    const syncer = makeSyncer(db);
    const malformed = cosponsorPayload('B000002', 'Baker');
    malformed.sponsorshipDate = 20250402; // a non-string date blows up parseDateOnly

    const result = await syncer.syncBillCosponsors('119-HR-1', {
      cosponsors: [
        cosponsorPayload('A000001', 'Able'),
        malformed,
        cosponsorPayload('C000003', 'Charlie')
      ]
    });

    assert.deepStrictEqual(
      db.cosponsors.map(c => c.bioguide_id),
      ['A000001', 'C000003'],
      'a cosponsor that cannot even be transformed must not take the others down'
    );
    assert.strictEqual(result.failed, 1, `expected 1 failure, got ${result && result.failed}`);
  });

  await test('a bill sponsor seated before the monthly member sync is still written', async () => {
    const db = fakeDb({ members: [] });
    const syncer = makeSyncer(db);

    await syncer.syncBillSponsor('119-HR-1', {
      introducedDate: '2025-04-02',
      sponsors: [{
        bioguideId: 'F000484',
        fullName: 'Rep. Fine, Randy [R-FL-6]',
        firstName: 'Randy',
        middleName: null,
        lastName: 'Fine',
        party: 'R',
        state: 'FL',
        district: 6,
        isByRequest: false
      }]
    });

    assert.strictEqual(db.sponsors.length, 1,
      'the sponsor must be written even though the member row did not exist yet');
    assert.strictEqual(db.sponsors[0].bioguide_id, 'F000484');
  });

  await test('a withdrawn cosponsorship keeps its withdrawal date all the way to the SQL parameters', async () => {
    const db = recordingWriteDb();
    const syncer = makeSyncer(db);
    const withdrawn = cosponsorPayload('B000002', 'Baker');
    withdrawn.sponsorshipWithdrawnDate = '2025-06-15'; // distinct from sponsorshipDate

    await syncer.syncBillCosponsors('119-HR-1', { cosponsors: [withdrawn] });

    const insert = cosponsorInsert(db);
    assert.ok(insert, 'expected an INSERT INTO bill_cosponsor');
    const bound = boundValue(insert, 'sponsorship_withdrawn_date');
    assert.ok(bound instanceof Date,
      `the withdrawal date must reach the statement, got ${bound === undefined ? 'undefined' : bound}`);
    assert.ok(bound.toISOString().startsWith('2025-06-15'),
      `expected the 2025-06-15 withdrawal, got ${bound.toISOString()}`);
  });

  await test('is_original_cosponsor carries the value Congress.gov reports', async () => {
    for (const reported of [true, false]) {
      const db = recordingWriteDb();
      const syncer = makeSyncer(db);
      const payload = cosponsorPayload('A000001', 'Able');
      payload.isOriginalCosponsor = reported;

      await syncer.syncBillCosponsors('119-HR-1', { cosponsors: [payload] });

      const bound = boundValue(cosponsorInsert(db), 'is_original_cosponsor');
      assert.strictEqual(bound, reported,
        `expected is_original_cosponsor=${reported} to be bound, got ${bound}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
