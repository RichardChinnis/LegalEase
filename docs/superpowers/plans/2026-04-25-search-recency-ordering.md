# All Bills Search Recency-Aware Ordering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the All Bills search from returning older-Congress bills above current-Congress bills by adding a tiered ORDER BY (`congress_id DESC, relevance DESC, latest_action_date DESC NULLS LAST, bill_id DESC`) to the two Postgres search functions, plus a cache-key version bump and a regression test suite.

**Architecture:** Pure backend change. New migration `012_search_recency_ordering.sql` recreates two existing search functions with a new ORDER BY; one constant added to `search-service.js` invalidates 15-minute cache entries on deploy; new test file uses fixture rows in the live DB and queries the SQL functions directly via `DatabaseService` to assert ordering. No frontend changes; no schema changes.

**Tech Stack:** Node.js 24 / Jest / supertest (existing), PostgreSQL 16 with `pg_trgm` and `tsvector` already configured, project's existing `migrate.js` runner.

**Spec:** `docs/superpowers/specs/2026-04-25-search-recency-ordering-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/migrations/012_search_recency_ordering.sql` | Create | Recreates both search functions with the new tiered ORDER BY. |
| `backend/migrations/012_search_recency_ordering_rollback.sql` | Create | Restores the migration-011 ORDER BY for rollback via `node migrate.js down`. |
| `backend/services/search-service.js` | Modify (lines ~1, 196-208) | Add `SEARCH_CACHE_VERSION` constant and include it in cache keys. |
| `backend/tests/search-ordering.test.js` | Create | Three Jest integration tests against the live DB, using a unique-token fixture set. |

The migration runner discovers files matching `^\d{3}_.*\.sql$` and ignores `*_rollback.sql` (verified in `backend/migrations/migrate.js:54`). The `down` command uses an explicit `_rollback.sql` file (`migrate.js:81-97`).

---

## Task 1: Set up the failing regression test (cross-Congress dominance)

**Files:**
- Create: `backend/tests/search-ordering.test.js`

This task introduces the test scaffolding and the **most important** assertion — that the original bug (older-Congress bills outranking newer ones) cannot regress. The test must fail before the migration is applied so we know it's actually exercising the ranking logic.

The test inserts three fixture bills sharing a unique nonsense token (`zzzqxbananaville`) so the search returns *only* our fixtures regardless of what's in the live DB. The `search_vector` column is auto-populated by the existing `tsvector_update` trigger from migration 002 (verified in `backend/migrations/002_add_search_vectors.sql:60-73`).

- [ ] **Step 1: Verify the trigger exists and the project's test runner is wired up**

Run: `grep -n "search_vector" /var/www/html/congress-api/backend/migrations/002_add_search_vectors.sql | head -5`
Expected: matches showing `search_vector tsvector` column and the `tsvector_update` trigger.

Run: `cd /var/www/html/congress-api/backend && npx jest --listTests 2>&1 | head -20`
Expected: lists existing `*.test.js` files; confirms Jest picks up files in `backend/tests/`.

- [ ] **Step 2: Create the test file with fixture setup and the cross-Congress assertion**

Create `backend/tests/search-ordering.test.js`:

> **Two project-specific notes baked into the code below:**
> 1. The `bill_type` column is a Postgres ENUM with lowercase values (`'hr'`, `'s'`, etc.) — uppercase is rejected.
> 2. The default `congress_api_backend` role is SELECT-only on `bill`. Fixture INSERT/DELETE require the `congress_admin` credentials from `backend/.env.admin`. The test parses that file with `dotenv.parse()` and passes the values to a `DatabaseService` config override.

```javascript
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

// Fixture design notes:
// The search_vector trigger weights title and policy_area both as 'A', and
// word_similarity caps at 1.0 for exact-word matches. So under the OLD function,
// "title match" and "policy_area match" produce IDENTICAL ranks. The fixture
// set instead varies the NUMBER OF TOKEN OCCURRENCES — verified empirically
// that ts_rank_cd scales 1 → 3 for 1 → 3 occurrences.
//
// Resulting OLD-function ranks (rank = ts_rank_cd * 2 + word_similarity, max 1.0):
//   F1 (3 occurrences in title):    3*2 + 1 = 7  (119)
//   F2 (3 occurrences in title):    3*2 + 1 = 7  (119)  [same title text as F1]
//   F4 (2 occurrences in title):    2*2 + 1 = 5  (118)
//   F3 (1 occurrence in policy):    1*2 + 1 = 3  (119)
//
// OLD function order (rank DESC): F1/F2 tied → F4 (118) → F3 (119)
//   ⇒ a 118 bill (F4) ranks ABOVE a 119 bill (F3) → cross-Congress test FAILS
//
// NEW function order (congress DESC, rank DESC, date DESC, bill_id DESC):
//   119s first: F2 (newer date) → F1 → F3 → F4 (118)
//   ⇒ all 119 before all 118 → cross-Congress test PASSES
const FIXTURES = [
  // F1: 119th, STRONG (3x token in title), older action_date, HIGHER bill_id
  // The higher bill_id means F1 would win the bill_id-DESC tiebreaker; the test
  // for date tiebreaker (Task 4) relies on F2 beating F1 via date alone.
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
  // F2: 119th, identical title to F1 (so identical relevance), NEWER date, LOWER bill_id.
  // Should beat F1 via latest_action_date DESC, NOT via bill_id DESC.
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
    // Insert fixtures. ON CONFLICT handles re-runs after a previous failed cleanup.
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
    await db.query(`DELETE FROM bill WHERE bill_id LIKE 'TEST-%-99%'`);
    await db.close();
  });

  test('every 119th-Congress bill ranks above every 118th-Congress bill', async () => {
    const result = await db.query(
      `SELECT bill_id, congress_id, rank
       FROM search_bills_only_filtered($1, $2, $3, $4, $5)`,
      [TOKEN, 100, null, null, null]
    );

    const rows = result.rows.filter(r => r.bill_id.startsWith('TEST-'));
    // We expect all four fixtures to match.
    expect(rows.length).toBe(4);

    const congresses = rows.map(r => r.congress_id);
    const last119Idx = congresses.lastIndexOf(119);
    const first118Idx = congresses.indexOf(118);

    expect(last119Idx).toBeGreaterThanOrEqual(0);
    expect(first118Idx).toBeGreaterThanOrEqual(0);
    // The 118 bill must appear after every 119 bill.
    expect(last119Idx).toBeLessThan(first118Idx);
  });
});
```

- [ ] **Step 3: Run the new test and verify it FAILS**

Run: `cd /var/www/html/congress-api/backend && npx jest tests/search-ordering.test.js -v`
Expected: the test fails. Under the OLD function (migration 011), F4 (118, rank 5) ranks above F3 (119, rank 3) because the ORDER BY uses pure relevance. The result list looks like `[F1/F2 tied @ 7, F4 (118), F3 (119)]`, so the LAST 119-Congress bill (F3) appears at index 3 while the FIRST 118-Congress bill (F4) appears at index 2 — the assertion `last119Idx < first118Idx` fails (3 is not < 2).

If the test passes unexpectedly, STOP and report DONE_WITH_CONCERNS. Likely causes: the fixture INSERTs failed silently, the trigger didn't populate `search_vector` as expected, or `ts_rank_cd` doesn't scale with frequency in this Postgres version. Run a diagnostic query to inspect the rank values:

```sql
SELECT bill_id, congress_id, rank
FROM search_bills_only_filtered('zzzqxbananaville', 100, NULL, NULL, NULL)
WHERE bill_id LIKE 'TEST-%';
```

If all four rows have identical rank, the relevance differential is missing and the plan needs another revision — escalate.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/search-ordering.test.js
git commit -m "test: add failing regression test for cross-Congress search ordering"
```

---

## Task 2: Write and apply migration 012

**Files:**
- Create: `backend/migrations/012_search_recency_ordering.sql`
- Create: `backend/migrations/012_search_recency_ordering_rollback.sql`

This is the actual fix. The migration recreates both `search_bills_only_filtered` and `search_congressional_content` with the new tiered ORDER BY. Function bodies are byte-identical to migration 011 except for the ORDER BY clause.

- [ ] **Step 1: Create the forward migration**

Create `backend/migrations/012_search_recency_ordering.sql`:

```sql
-- Migration: Recency-aware ordering for search functions
-- Adds congress_id (primary) and latest_action_date (tiebreaker) to the ORDER BY
-- so current-Congress bills surface above older-Congress bills.
-- Function bodies are otherwise byte-identical to migration 011.

CREATE OR REPLACE FUNCTION search_bills_only_filtered(
    search_query TEXT,
    result_limit INT DEFAULT NULL,
    filter_congress INT DEFAULT NULL,
    filter_sponsor TEXT DEFAULT NULL,
    filter_status TEXT DEFAULT NULL
)
RETURNS TABLE(
    bill_id TEXT,
    title TEXT,
    policy_area TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    introduced_date DATE
) AS $$
DECLARE
    prefix_query tsquery;
    word_sim_threshold REAL := 0.4;
BEGIN
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        b.bill_id::TEXT,
        COALESCE(b.title, '')::TEXT,
        COALESCE(b.policy_area, '')::TEXT,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         ))::REAL as rank,
        ts_headline('english',
            COALESCE(b.title, '') || ' ' ||
            COALESCE(b.policy_area, '') || ' ' ||
            COALESCE(b.latest_action_text, ''),
            prefix_query,
            'MaxFragments=2,MaxWords=50,MinWords=15'
        )::TEXT as snippet,
        b.congress_id::INT,
        b.introduced_date::DATE
    FROM bill b
    WHERE
        (b.search_vector @@ prefix_query)
        OR (word_similarity(search_query, b.title) > word_sim_threshold)
        OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
    AND (filter_congress IS NULL OR b.congress_id = filter_congress)
    AND (filter_sponsor IS NULL OR
         EXISTS (
            SELECT 1 FROM bill_sponsor bs
            JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            WHERE bs.bill_id = b.bill_id
            AND (LOWER(m.first_name) LIKE LOWER('%' || filter_sponsor || '%')
                 OR LOWER(m.last_name) LIKE LOWER('%' || filter_sponsor || '%'))
         ))
    ORDER BY
        b.congress_id DESC NULLS LAST,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC,
        b.latest_action_date DESC NULLS LAST,
        b.bill_id DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;


-- Recreate the general-content search function with the same ORDER BY.
DROP FUNCTION IF EXISTS search_congressional_content(TEXT, INT);

CREATE OR REPLACE FUNCTION search_congressional_content(
    search_query TEXT,
    result_limit INT DEFAULT NULL
)
RETURNS TABLE(
    entity_type TEXT,
    entity_id TEXT,
    title TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    date_field DATE
) AS $$
DECLARE
    prefix_query tsquery;
    word_sim_threshold REAL := 0.4;
BEGIN
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        'bill'::TEXT as entity_type,
        b.bill_id::TEXT as entity_id,
        COALESCE(b.title, '')::TEXT,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         ))::REAL as rank,
        ts_headline('english',
            COALESCE(b.title, '') || ' ' ||
            COALESCE(b.policy_area, '') || ' ' ||
            COALESCE(b.latest_action_text, ''),
            prefix_query,
            'MaxFragments=2,MaxWords=50,MinWords=15'
        )::TEXT as snippet,
        b.congress_id::INT,
        b.introduced_date::DATE as date_field
    FROM bill b
    WHERE
        (b.search_vector @@ prefix_query)
        OR (word_similarity(search_query, b.title) > word_sim_threshold)
        OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
    ORDER BY
        b.congress_id DESC NULLS LAST,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC,
        b.latest_action_date DESC NULLS LAST,
        b.bill_id DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Record this migration so the runner doesn't re-apply it.
INSERT INTO schema_migrations (migration_id, description)
VALUES ('012_search_recency_ordering', 'Add congress_id and latest_action_date to search ORDER BY')
ON CONFLICT (migration_id) DO NOTHING;
```

- [ ] **Step 2: Create the rollback migration**

Create `backend/migrations/012_search_recency_ordering_rollback.sql`:

```sql
-- Rollback: restore migration-011 ORDER BY (relevance only)

CREATE OR REPLACE FUNCTION search_bills_only_filtered(
    search_query TEXT,
    result_limit INT DEFAULT NULL,
    filter_congress INT DEFAULT NULL,
    filter_sponsor TEXT DEFAULT NULL,
    filter_status TEXT DEFAULT NULL
)
RETURNS TABLE(
    bill_id TEXT,
    title TEXT,
    policy_area TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    introduced_date DATE
) AS $$
DECLARE
    prefix_query tsquery;
    word_sim_threshold REAL := 0.4;
BEGIN
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        b.bill_id::TEXT,
        COALESCE(b.title, '')::TEXT,
        COALESCE(b.policy_area, '')::TEXT,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         ))::REAL as rank,
        ts_headline('english',
            COALESCE(b.title, '') || ' ' ||
            COALESCE(b.policy_area, '') || ' ' ||
            COALESCE(b.latest_action_text, ''),
            prefix_query,
            'MaxFragments=2,MaxWords=50,MinWords=15'
        )::TEXT as snippet,
        b.congress_id::INT,
        b.introduced_date::DATE
    FROM bill b
    WHERE
        (b.search_vector @@ prefix_query)
        OR (word_similarity(search_query, b.title) > word_sim_threshold)
        OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
    AND (filter_congress IS NULL OR b.congress_id = filter_congress)
    AND (filter_sponsor IS NULL OR
         EXISTS (
            SELECT 1 FROM bill_sponsor bs
            JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            WHERE bs.bill_id = b.bill_id
            AND (LOWER(m.first_name) LIKE LOWER('%' || filter_sponsor || '%')
                 OR LOWER(m.last_name) LIKE LOWER('%' || filter_sponsor || '%'))
         ))
    ORDER BY
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;


DROP FUNCTION IF EXISTS search_congressional_content(TEXT, INT);

CREATE OR REPLACE FUNCTION search_congressional_content(
    search_query TEXT,
    result_limit INT DEFAULT NULL
)
RETURNS TABLE(
    entity_type TEXT,
    entity_id TEXT,
    title TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    date_field DATE
) AS $$
DECLARE
    prefix_query tsquery;
    word_sim_threshold REAL := 0.4;
BEGIN
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        'bill'::TEXT as entity_type,
        b.bill_id::TEXT as entity_id,
        COALESCE(b.title, '')::TEXT,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         ))::REAL as rank,
        ts_headline('english',
            COALESCE(b.title, '') || ' ' ||
            COALESCE(b.policy_area, '') || ' ' ||
            COALESCE(b.latest_action_text, ''),
            prefix_query,
            'MaxFragments=2,MaxWords=50,MinWords=15'
        )::TEXT as snippet,
        b.congress_id::INT,
        b.introduced_date::DATE as date_field
    FROM bill b
    WHERE
        (b.search_vector @@ prefix_query)
        OR (word_similarity(search_query, b.title) > word_sim_threshold)
        OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
    ORDER BY
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

DELETE FROM schema_migrations WHERE migration_id = '012_search_recency_ordering';
```

- [ ] **Step 3: Apply the migration**

Run: `cd /var/www/html/congress-api/backend && node migrations/migrate.js up 012_search_recency_ordering`
Expected: log output `Migration completed successfully: 012_search_recency_ordering`. If migration runner fails, the error will indicate why (most likely a syntax error in the SQL — fix and retry).

Verify with: `cd /var/www/html/congress-api/backend && node migrations/migrate.js status`
Expected: `012_search_recency_ordering` appears in the "Applied migrations" list.

- [ ] **Step 4: Re-run the regression test and verify it now PASSES**

Run: `cd /var/www/html/congress-api/backend && npx jest tests/search-ordering.test.js -v`
Expected: the `every 119th-Congress bill ranks above every 118th-Congress bill` test passes.

If it still fails, the migration didn't take effect. Diagnose by querying directly in psql:
```sql
\df+ search_bills_only_filtered
```
The function definition shown should contain `b.congress_id DESC NULLS LAST` in the ORDER BY.

- [ ] **Step 5: Commit migration + rollback**

```bash
git add backend/migrations/012_search_recency_ordering.sql backend/migrations/012_search_recency_ordering_rollback.sql
git commit -m "feat(search): tier search ordering by congress, relevance, action date"
```

---

## Task 3: Add the intra-Congress relevance test

**Files:**
- Modify: `backend/tests/search-ordering.test.js`

Confirms that within a single Congress, relevance still does its job — a stronger match (more token occurrences) ranks above a weaker one (fewer occurrences). Guards against accidentally over-tiering the sort (e.g., if someone later moves another column above `rank` in the ORDER BY).

Why "more occurrences" instead of "title vs policy_area": the project's `search_vector` trigger (migration 002) weights `title` and `policy_area` equally as 'A', so a token in title vs in policy_area produces an identical `ts_rank_cd`. The number of occurrences IS a real relevance signal that survives the migration unchanged.

- [ ] **Step 1: Add the test inside the existing `describe` block**

Open `backend/tests/search-ordering.test.js` and append this test inside the `describe('Search recency-aware ordering (migration 012)', ...)` block (after the cross-Congress test):

```javascript
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
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `cd /var/www/html/congress-api/backend && npx jest tests/search-ordering.test.js -v`
Expected: both the original test and the new `within a single Congress…` test pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/search-ordering.test.js
git commit -m "test: assert intra-Congress relevance ordering still works"
```

---

## Task 4: Add the latest_action_date tiebreaker test

**Files:**
- Modify: `backend/tests/search-ordering.test.js`

F1 (`99005`) and F2 (`99004`) share an identical title (3× token), so their relevance scores are identical. Critically, F1's bill_id is *higher* than F2's (99005 > 99004), so the final `bill_id DESC` tiebreaker would put F1 first — but the new ORDER BY puts `latest_action_date DESC` ahead of `bill_id DESC`, and F2 has the newer date, so F2 must come first. Asserting `idx99004 < idx99005` therefore confirms `latest_action_date` is doing the work, not `bill_id`.

- [ ] **Step 1: Add the test inside the same `describe` block**

Append this test after the previous one in `backend/tests/search-ordering.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `cd /var/www/html/congress-api/backend && npx jest tests/search-ordering.test.js -v`
Expected: all three tests in the file pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/search-ordering.test.js
git commit -m "test: assert latest_action_date tiebreaker within a Congress"
```

---

## Task 5: Bump the search cache version

**Files:**
- Modify: `backend/services/search-service.js` (lines ~1-10 and ~196-208)

The 15-minute in-memory cache would otherwise serve old-ordering results for up to 15 minutes after deploy. Adding a version constant to the cache key effectively invalidates pre-deploy entries.

- [ ] **Step 1: Add the version constant near the top of the file**

In `backend/services/search-service.js`, find this section at the top:

```javascript
const { logger } = require('../logger');
const { DatabaseService } = require('./database');
const { BadRequestError, InternalServerError, TooManyRequestsError } = require('../utils/errors');
```

Add immediately after these requires (before the `logger.debug` call):

```javascript
// Bump this when changing search ranking/ordering to invalidate cached results.
// v2: migration 012 — tiered ORDER BY (congress_id, relevance, latest_action_date).
const SEARCH_CACHE_VERSION = 'v2';
```

- [ ] **Step 2: Include the version in the cache key**

Find `generateCacheKey()` at `backend/services/search-service.js:196`. Replace the entire method body with:

```javascript
  generateCacheKey(params) {
    const keyParts = [
      'search',
      SEARCH_CACHE_VERSION,
      params.query,
      params.limit,
      params.offset,
      params.contentTypes?.join(',') || 'all',
      params.congress || 'all',
      params.sponsor || '',
      params.status || '',
      params.sortBy
    ];
    return keyParts.join(':');
  }
```

- [ ] **Step 3: Run the existing test suite to confirm nothing regresses**

Run: `cd /var/www/html/congress-api/backend && npx jest`
Expected: all tests pass, including the three new ones in `search-ordering.test.js`. If any unrelated tests fail, investigate before committing — the cache key change should not affect anything other than what's keyed.

- [ ] **Step 4: Commit**

```bash
git add backend/services/search-service.js
git commit -m "fix(search): version search cache key to invalidate post-deploy stale entries"
```

---

## Task 6: End-to-end smoke test against the live endpoint

**Files:** none (verification step only)

Confirms the change reaches the actual HTTP endpoint that the All Bills panel hits. This is a manual sanity check, not a new automated test.

- [ ] **Step 1: Start the backend dev server**

Run (in a separate terminal so it stays running): `cd /var/www/html/congress-api/backend && npm run dev` — or whatever the project's dev command is (check `backend/package.json`'s `scripts` section).

- [ ] **Step 2: Hit the search endpoint**

Run: `curl -s 'http://localhost:3000/api/db/search?q=russia&contentTypes=bills&limit=20&sortBy=relevance' | python3 -c "import sys, json; d = json.load(sys.stdin); print('\\n'.join(f\"{b.get('congress_id')} {b.get('bill_id')} - {b.get('title','')[:80]}\" for b in d.get('results', d.get('data', []))[:20]))"`

(If the server runs on a different port, adjust accordingly — check `backend/.env` for `PORT`.)

Expected: the first ~5-10 results all show `congress_id: 119` (or whatever the current Congress is). 118th-Congress bills should appear later in the list, not at the top.

- [ ] **Step 3: Confirm the dev server logs show a fresh database query, not a cache hit**

In the dev server log, the first request should NOT show `Cache hit for search`. The `cacheKey` value in any logged debug lines should now contain `:v2:`.

- [ ] **Step 4: Stop the dev server**

Press Ctrl+C in the dev server terminal.

(No commit for this task — it's verification only.)

---

## Self-Review Notes

- **Spec coverage:** Sections 1-5 of the spec map to Tasks 2 (migration), 5 (cache), 1/3/4 (the three test cases). Risk/rollback covered by the `_rollback.sql` file in Task 2. Non-goals respected (no UI changes, no schema changes, no analytics).
- **Type/signature consistency:** Function signatures (`search_bills_only_filtered(TEXT, INT, INT, TEXT, TEXT)`, `search_congressional_content(TEXT, INT)`) and `RETURNS TABLE` shapes are byte-identical between migrations 011 and 012, so `CREATE OR REPLACE FUNCTION` works. Cache constant name `SEARCH_CACHE_VERSION` is consistent across declaration and use.
- **Test data isolation:** Fixtures use `bill_id` prefix `TEST-` and a unique nonsense `TOKEN` to ensure they don't collide with real data and the search returns exactly the fixtures.
- **Cleanup:** `afterAll` runs `DELETE FROM bill WHERE bill_id LIKE 'TEST-%-99%'` so fixtures don't pollute the live DB even if a test fails mid-run.
