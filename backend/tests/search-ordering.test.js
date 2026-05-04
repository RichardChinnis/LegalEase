const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { DatabaseService } = require('../services/database');

// Unique token unlikely to appear in real bills, so the function returns
// only our fixtures and tests are deterministic against the live DB.
const TOKEN = 'zzzqxbananaville';

// .env.admin has the congress_admin role with INSERT/DELETE on bill.
// The default backend role (.env) is read-only and would reject fixture inserts.
const adminEnv = dotenv.parse(
  fs.readFileSync(path.resolve(__dirname, '../.env.admin'), 'utf8')
);

// Fixture design: vary token frequency to create real ts_rank_cd differentials.
// Resulting OLD-function ranks (rank = ts_rank_cd * 2 + word_similarity, max 1.0):
//   F1 (3x token in title):    3*2 + 1 = 7  (119)
//   F2 (3x token in title):    3*2 + 1 = 7  (119)  [same title text as F1]
//   F4 (2x token in title):    2*2 + 1 = 5  (118)
//   F3 (1x token in policy):   1*2 + 1 = 3  (119)
// OLD function order (rank DESC): F1/F2 tied → F4 (118) → F3 (119)
//   ⇒ a 118 bill ranks ABOVE a 119 bill → cross-Congress test FAILS
const FIXTURES = [
  // F1: 119th, STRONG (3x token in title), older action_date, HIGHER bill_id
  {
    bill_id: 'TEST-119-HR-99005',
    congress_id: 119,
    bill_type: 'hr',
    bill_number: 99005,
    title: `Test ${TOKEN} ${TOKEN} ${TOKEN} Sanctions Act`,
    policy_area: 'International Affairs',
    introduced_date: '2026-01-15',
    latest_action_date: '2026-03-01',
  },
  // F2: 119th, identical title to F1, NEWER date, LOWER bill_id
  {
    bill_id: 'TEST-119-HR-99004',
    congress_id: 119,
    bill_type: 'hr',
    bill_number: 99004,
    title: `Test ${TOKEN} ${TOKEN} ${TOKEN} Sanctions Act`,
    policy_area: 'International Affairs',
    introduced_date: '2026-02-15',
    latest_action_date: '2026-04-01',
  },
  // F3: 119th, WEAK (1x token in policy_area only)
  {
    bill_id: 'TEST-119-HR-99003',
    congress_id: 119,
    bill_type: 'hr',
    bill_number: 99003,
    title: 'Test Generic Foreign Policy Act',
    policy_area: `${TOKEN} Affairs`,
    introduced_date: '2026-02-15',
    latest_action_date: '2026-03-15',
  },
  // F4: 118th, MEDIUM (2x token in title) — strong enough to outrank F3 under
  // the OLD function so the cross-Congress test fails before the migration.
  {
    bill_id: 'TEST-118-HR-99002',
    congress_id: 118,
    bill_type: 'hr',
    bill_number: 99002,
    title: `Test ${TOKEN} ${TOKEN} Enhancement Act`,
    policy_area: 'International Affairs',
    introduced_date: '2023-05-15',
    latest_action_date: '2024-11-01',
  },
];

describe('Search recency-aware ordering (migration 012)', () => {
  let db;

  beforeAll(async () => {
    db = new DatabaseService({
      host: adminEnv.DB_HOST,
      port: parseInt(adminEnv.DB_PORT, 10),
      database: adminEnv.DB_DATABASE,
      user: adminEnv.DB_USER,
      password: adminEnv.DB_PASSWORD,
    });
    for (const f of FIXTURES) {
      await db.query(
        `INSERT INTO bill (bill_id, congress_id, bill_type, bill_number, title, policy_area, introduced_date, latest_action_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (bill_id) DO UPDATE SET
           congress_id = EXCLUDED.congress_id,
           title = EXCLUDED.title,
           policy_area = EXCLUDED.policy_area,
           introduced_date = EXCLUDED.introduced_date,
           latest_action_date = EXCLUDED.latest_action_date`,
        [f.bill_id, f.congress_id, f.bill_type, f.bill_number, f.title, f.policy_area, f.introduced_date, f.latest_action_date]
      );
    }
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.query(
        `DELETE FROM bill WHERE bill_id = ANY($1::text[])`,
        [FIXTURES.map(f => f.bill_id)]
      );
    } finally {
      await db.close();
    }
  });

  test('every 119th-Congress bill ranks above every 118th-Congress bill', async () => {
    const result = await db.query(
      `SELECT bill_id, congress_id, rank
       FROM search_bills_only_filtered($1, $2, $3, $4, $5)`,
      [TOKEN, 100, null, null, null]
    );

    const rows = result.rows.filter(r => r.bill_id.startsWith('TEST-'));
    expect(rows.length).toBe(4);

    const congresses = rows.map(r => r.congress_id);
    const last119Idx = congresses.lastIndexOf(119);
    const first118Idx = congresses.indexOf(118);

    expect(last119Idx).toBeGreaterThanOrEqual(0);
    expect(first118Idx).toBeGreaterThanOrEqual(0);
    // The 118 bill must appear after every 119 bill.
    expect(last119Idx).toBeLessThan(first118Idx);
  });

  test('within a single Congress, more token occurrences outrank fewer', async () => {
    const result = await db.query(
      `SELECT bill_id, congress_id, rank
       FROM search_bills_only_filtered($1, $2, $3, $4, $5)`,
      [TOKEN, 100, 119, null, null]  // filter_congress = 119
    );

    const rows = result.rows.filter(r => r.bill_id.startsWith('TEST-'));
    // Three 119th-Congress fixtures: 99005, 99004 (3x token), 99003 (1x token)
    expect(rows.length).toBe(3);

    // F1 (99005) and F2 (99004) have 3 token occurrences in title (rank ≈ 7).
    // F3 (99003) has 1 token occurrence in policy_area (rank ≈ 3).
    const idxStrong = rows.findIndex(r => r.bill_id === 'TEST-119-HR-99005');
    const idxWeak = rows.findIndex(r => r.bill_id === 'TEST-119-HR-99003');
    expect(idxStrong).toBeGreaterThanOrEqual(0);
    expect(idxWeak).toBeGreaterThanOrEqual(0);
    expect(idxStrong).toBeLessThan(idxWeak);
  });

  test('within a Congress, identical relevance breaks ties on latest_action_date DESC', async () => {
    const result = await db.query(
      `SELECT bill_id, congress_id, rank
       FROM search_bills_only_filtered($1, $2, $3, $4, $5)`,
      [TOKEN, 100, 119, null, null]
    );

    const rows = result.rows.filter(r => r.bill_id.startsWith('TEST-'));

    const idx99005 = rows.findIndex(r => r.bill_id === 'TEST-119-HR-99005');
    const idx99004 = rows.findIndex(r => r.bill_id === 'TEST-119-HR-99004');
    expect(idx99005).toBeGreaterThanOrEqual(0);
    expect(idx99004).toBeGreaterThanOrEqual(0);

    // 99005 and 99004 share identical title text (so identical relevance).
    // 99005 has the higher bill_id (would win the bill_id-DESC final tiebreaker)
    // but 99004 has the newer latest_action_date (2026-04-01 vs 2026-03-01).
    // Since latest_action_date DESC sorts before bill_id DESC, 99004 wins.
    expect(idx99004).toBeLessThan(idx99005);
  });
});
