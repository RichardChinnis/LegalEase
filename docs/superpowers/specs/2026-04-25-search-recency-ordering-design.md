# All Bills Search — Recency-Aware Ordering

**Status:** Approved design, ready for implementation plan
**Date:** 2026-04-25
**Author:** Richard Chinnis (with Claude)

## Problem

The "All Bills" search on the v2 frontend's main page right-side panel returns results in an order that frequently surfaces older-Congress bills above current-Congress bills. A user searching "Russia" on the 119th-Congress site can see a 118th-Congress bill at the top because it has a stronger title match.

Users searching by topic almost always want recent legislation. The current behavior violates that expectation.

## Root cause

The `/api/db/search` endpoint dispatches to two Postgres functions defined in `backend/migrations/011_fuzzy_search_pg_trgm.sql`:

- `search_bills_only_filtered` (used when `contentTypes=['bills']`)
- `search_congressional_content` (used otherwise)

Both functions sort exclusively by relevance:

```sql
ORDER BY
  (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
   GREATEST(
     COALESCE(word_similarity(search_query, b.title), 0),
     COALESCE(word_similarity(search_query, b.policy_area), 0)
   )) DESC
```

There is no congress filter, no congress tiebreaker, and no date tiebreaker. The frontend (`frontend-v2/js/components/all-bills-panel.js:288-293`) sends no congress parameter, so all Congresses are pooled and sorted by relevance alone.

In contrast, browse mode on the same panel correctly sorts `latest_action_date DESC NULLS LAST, bill_id DESC` (`backend/routes/api.js:4124-4138`).

## Design decisions

The full conversation walked through four orthogonal product choices. Each decision is recorded here so future maintainers can re-evaluate any one independently.

| # | Question | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Hard filter or soft bias toward current Congress? | **Soft bias** | A hard filter would prevent legitimate historical lookups (e.g., the original Affordable Care Act). |
| 2 | Recency signal: Congress, action date, or hybrid? | **Hybrid** — Congress primary, action date as tiebreaker | Matches user intent ("almost always recent") while still rewarding intra-Congress activity. |
| 3 | UI surface for the change? | **None** — silent backend fix | One endpoint feeds the All Bills panel, autocomplete dropdown, and header search. A single change improves all three with no new UI. |
| 4 | Strict tiered sort or weighted blend? | **Strict tiered** | Predictable, easy to test, no weights to tune. Within a Congress, relevance still does its full job. |

The combined behavior: **`congress_id DESC` → `relevance DESC` → `latest_action_date DESC NULLS LAST` → `bill_id DESC`**.

## Architecture

Three changes:

1. **New SQL migration** `backend/migrations/012_search_recency_ordering.sql` — `CREATE OR REPLACE FUNCTION` for both search functions with the new ORDER BY. No schema changes.
2. **Cache-key version bump** in `backend/services/search-service.js` — prevents stale pre-deploy results from serving for up to 15 minutes after deploy.
3. **New tests** in `backend/tests/search-ordering.test.js` — regression guard plus intra-Congress ranking and tiebreaker assertions.

No frontend changes. The endpoint contract is unchanged; the All Bills panel, autocomplete dropdown (`search-dropdown.js`), and global header search (`search.js`) all benefit automatically.

## Detailed changes

### Migration 012: SQL function bodies

For **both** `search_bills_only_filtered` and `search_congressional_content`, replace the existing single-key ORDER BY with the four-key tiered sort. The relevance expression stays byte-identical to migration 011; only the surrounding sort keys change.

```sql
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
```

Notes:

- `b.latest_action_date` does **not** need to be added to the function's `RETURNS TABLE`. PostgreSQL allows ORDER BY on any column from the underlying `FROM`.
- `b.bill_id DESC` is a stable final tiebreaker matching the browse-mode pattern at `routes/api.js:4124-4138`.
- The migration mirrors `011`'s pattern of using `DROP FUNCTION IF EXISTS` before recreating `search_congressional_content` (in case the signature ever changes).

### search-service.js: cache version bump

Add a module-scoped constant and prepend it to the cache key in `generateCacheKey()` (currently `services/search-service.js:196-208`):

```js
const SEARCH_CACHE_VERSION = 'v2';

// inside generateCacheKey():
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
```

Any future ranking change bumps the constant; old entries naturally age out via the existing TTL.

### Tests

Three test cases in a new file `backend/tests/search-ordering.test.js`. All run against the real Postgres database, matching the project's existing integration-test convention (`backend/tests/schema-validation.test.js`).

1. **Congress dominates relevance.** Search for a term known to appear in bills from both 119 and 118 (e.g., `'russia'`). Assert: in the returned result list, every 119th-Congress bill has an index strictly less than every 118th-Congress bill. This is the regression guard for the original complaint.

2. **Relevance still works inside a Congress.** Filter to a single Congress (e.g., 119) and search for a term. Assert that a bill with the term in the title ranks above a bill with the term only in `policy_area`. Confirms intra-Congress ranking is unbroken.

3. **Tiebreaker on `latest_action_date`.** For two bills in the same Congress with effectively identical relevance scores, the bill with the newer `latest_action_date` ranks higher.

No frontend tests — there are no behavioral changes to the panel, dropdown, or header components. The cache-version bump is too trivial to require its own test.

## Non-goals

Explicitly **not** included in this work:

- A "Congress" filter pill or dropdown in the UI.
- An "Include older Congresses" toggle.
- A weighted-score ranking model with tunable parameters.
- Changes to the search vector (`migrations/002_add_search_vectors.sql`) or trigram indexes.
- Changes to the `/api/db/bills` browse endpoint (already correctly sorted).
- Analytics/observability for search queries.

Any of these can be added in a follow-up if the simple ranking fix proves insufficient.

## Risk & rollback

**Risk profile:** Low. The migration recreates two function bodies; no data, schema, or index is touched.

**Rollback:** Reapply migration `011`'s function definitions, or write a small `013_revert_search_recency_ordering.sql` that recreates the `011` versions.

**Performance:** The new ORDER BY adds two columns to the sort key, but the sort is over the limited result set (default 50). The GIN index on `search_vector` continues to drive filtering. No measurable slowdown is expected; an `EXPLAIN ANALYZE` on a 5000-row search before/after will be run during implementation as a sanity check.

## Open questions

None. All design decisions are resolved.
