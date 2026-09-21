# Handoff: Congressional Record sync consolidation

**Written 2026-09-21** after a health-report pass that fixed several CR bugs but
deliberately left the structural ones alone. Everything below was verified
against the live database and the Congress.gov API during that session.

Read `<git-workflow>` in the project `CLAUDE.md` before your first push.

---

## Start here: three things that will cost you an hour if you don't know them

### 1. A CR issue can genuinely span discontinuous pages

This is the single most expensive thing to rediscover, because it looks exactly
like a bug and isn't.

Vol 161 No. 120's House section holds 131 articles in two clusters —
H5564–H5593 and H8527–H8545 — with nothing between. That is **upstream truth**,
not a sync defect:

```
GET /v3/daily-congressional-record/161/120/articles   → House Section, pages 5564..8545
https://www.congress.gov/114/crec/2015/07/28/161/120/modified/CREC-2015-07-28-pt1-PgH5593.htm → 200
https://www.congress.gov/114/crec/2015/07/28/161/120/modified/CREC-2015-07-28-pt1-PgH8545.htm → 200
```

Both URLs resolve, both dated 2015-07-28 under 161/120. 27 sections of 11,725
have article spreads over 500 pages and every one checked was real.

**Consequence:** never validate an article by its distance from its section's
page range. A previous detector did exactly that, reported 300 rows, and was
wrong about 298. The surviving check keys on provenance instead — see
`scripts/repair/detect-cr-non-synced-articles.sql`. An article with no
`pdf_url` and no `text_url` was never synced; that signal cannot misfire on a
legitimately wide section.

Also note: a section's page prefix matters. Daily Digest is D-paged but cites
S/H/E pages from other chambers. Only same-prefix articles define a section's
extent. Ignoring this flags six correct Daily Digest sections as broken.

### 2. Loading either logger rotates the real production logs

`sync-service/lib/logger.js` and `backend/logger.js` are module-level singletons.
Requiring either one opens the real log files, and if a file exceeds `maxsize`
winston rotates it immediately. That means **running the test suite can rotate
production logs** — it happened during the session that wrote this, mid-run.

Always:

```bash
LOG_DIR=$(mktemp -d) npm test          # sync-service
LOG_DIR=$(mktemp -d) npx jest          # backend
```

`LOG_DIR` exists specifically for this. Unset, it resolves to exactly the
previous paths, so production behaviour is unchanged.

### 3. Nothing you change is live until the services restart

`congress-sync` and `congress-api-backend` are long-running; they hold old code
until restarted, and restarting needs root, which the developer account does not
have. Ask for it.

The two timer-driven jobs are different — `congress-record-daily` (18:00) and
`congress-daily-report` (08:00) are `Type=oneshot`, so they spawn a fresh `node`
and pick up edited files with no restart. **A change to
`daily-congressional-record-sync.js` goes live at 18:00 whether or not anyone
asked it to.** Plan around that.

---

## Item 1: Three implementations write the same two tables

**Effort: large. This is the real work.**

| File | Lines | Trigger |
|---|---|---|
| `sync-service/syncers/congressional-record-syncer.js` | 810 | daemon cron, 07:00 daily |
| `sync-service/daily-congressional-record-sync.js` | 538 | `congress-record-daily.timer`, 18:00 daily |
| `sync-service/backfill-missing-cr-issues.js` | 521 | manual |

All three write `congressional_record_section` and `congressional_record_article`.
The second and third are not wrappers around the first — they borrow its client
and DB handle (`this.syncer.db`, `this.syncer.client`) and then reimplement
storage.

**Two of them run daily against the same rows, and the section upsert does
`ON CONFLICT DO UPDATE SET metadata = EXCLUDED.metadata`, so the last writer
wins and erases the previous writer's provenance.** The 07:00 and 18:00 jobs are
not redundant, they are competing. `metadata->>'sync_source'` is therefore
unreliable for attribution — it records whoever wrote last, not who created the
row.

The owner could not explain why two daily jobs exist; treat it as drift.

### What's already been done toward this

- All five page/chamber fabrications (`|| 'S1'`, `|| 'Senate'`, borrowed end
  pages) are removed from **all three** writers. The bug class is closed; a repo
  sweep confirms no `|| 'S1'` or CR `|| 'Senate'` remains.
- `normalizeRequiredPage` and `firstUsablePage` were extracted and now live in
  `syncers/congressional-record-syncer.js` (lines 19 and 36), imported by the
  other two. **This is the wrong home.** A cron script importing from a backfill
  script would be worse, so the syncer was the least-bad option under the file
  scoping of that session. Their honest home is a shared `sync-service/lib/`
  module. Moving them is a natural first step of consolidation.
- Guards run as one parameterised test suite across both writers
  (`sync-service/test/congressional-record-syncer.test.js`, 16 tests), so the
  two cannot silently drift apart again. Keep that property.

### Suggested approach

Decide first whether the 18:00 job should exist at all. It does something the
daemon does not — `cleanupExistingData` deletes an issue's rows and rebuilds
them, which is a repair pass rather than an incremental upsert. If that
behaviour is wanted, it belongs in the syncer behind a flag, not in a parallel
implementation. If it isn't, delete the job and the timer.

Whatever you decide, the backfill script needs the same treatment, and
consolidation is what finally makes `sync_source` meaningful.

---

## Item 2: `cleanupExistingData` can lose an issue's rows

**Effort: small-to-medium. Do not patch it casually.**

`sync-service/daily-congressional-record-sync.js:214`, called from line 415. It
already carries a `CAUTION` block at line 193 documenting the window; read that
first.

The failure: the DELETE runs in its own statement with no surrounding
transaction, so it commits alone. `processIssueArticles` then rethrows on any
API error, and the issue is left with its old rows gone and nothing written
back. Two further windows (empty API result, partial write) are described in the
CAUTION block.

**Why it wasn't just wrapped in a transaction:** the cascade reaches
`action_congressional_record_reference`, whose `issue_id`, `section_id` and
`article_id` are `ON DELETE SET NULL`. That can violate the table's
`logical_resolution` CHECK and make the DELETE itself fail — into a warn-only
handler. Today this is latent (the one resolved reference points at a 2023
issue), but a naive transaction wrapper changes failure behaviour in ways nobody
has characterised. Characterise it before you change it.

If Item 1 removes this script entirely, this item disappears with it. Consider
doing them in that order.

---

## Item 3: Smaller things, all deliberately left

| Item | Where | Note |
|---|---|---|
| Shared helpers in the wrong module | `syncers/congressional-record-syncer.js:19,36` | Move to `lib/`; see Item 1 |
| Page-format validation gap | section `valid_page_numbers` CHECK | Only validates format when `end_page` is non-null, so a malformed `start_page` passes silently when `end_page` is NULL. Bit us once already: a whitespace-only `start_page` was stored as a real row |
| Missing per-section catch | `daily-congressional-record-sync.js` | Unlike the syncer, it lacks a per-section try/catch in one path |
| `member_committee` silently skips | `committee-membership-syncer.js:383-387`, `435-439` | Pre-checks `memberExists` and `continue`s on a miss. No FK error, just missing assignments until the monthly member sync. The cosponsor stub shrank this window but did not close it |
| `member`/`news-ingestion` write no `sync_status` | `syncers/member-syncer.js`, news ingestion job | Both run fine but record nothing, so the daily report is blind to them |
| `first_name`/`last_name` straight overwrite | `syncers/member-syncer.js` `upsertMember` | A thin API response could blank a name. Pre-existing, never observed. The other name fields use `COALESCE(EXCLUDED.x, member.x)` |
| Members sync monthly, bills 6-hourly | `sync-service/config.js` schedules | `ensureMemberStub` papers over the FK race rather than fixing the cadence mismatch |
| Absolute paths in two public docs | `backend/DATABASE_ENDPOINTS_GUIDE.md:136`, `docs/superpowers/plans/2026-04-25-search-recency-ordering.md` | Server paths, already public before 2026-09-21, low severity |

---

## Verifying your work

Both suites must stay green. Baselines as of 2026-09-21:

```bash
cd sync-service && LOG_DIR=$(mktemp -d) npm test     # 29 tests across 3 files, exit 0
cd backend     && LOG_DIR=$(mktemp -d) npx jest      # 106 tests, 8 suites
```

Data invariants — all should return zero rows / zero counts:

```bash
psql -f scripts/repair/detect-cr-section-page-drift.sql       # 0 rows
psql -f scripts/repair/detect-cr-non-synced-articles.sql      # 0 rows
```

`scripts/repair/cr-section-page-drift-repair-20260921.sql` is idempotent —
re-running reports `UPDATE 0`. Every repair applied in that session has a
matching rollback file in `scripts/repair/`.

### Test conventions, which differ per package

- **backend** — Jest + Supertest, tests in `backend/tests/`. Conventional.
- **sync-service** — **no test framework at all.** `npm test` chains plain node
  scripts. Follow the existing pattern in `sync-service/test/member-syncer.test.js`:
  standalone `assert`, a local `test()` helper, `exit 0`/`exit 1`, and instances
  built via `Object.create(Syncer.prototype)` to avoid opening a real DB pool.
  Do not add Jest here without asking; the existing style is deliberate and the
  tests run with no dependencies.

---

## Environment facts worth knowing

- **The Congress.gov API key cannot be rotated** — the provider issues one key
  per email and will not reissue. It is permanently in the private repo's
  history. Keeping it out of the public repo is the only mitigation, which is
  why the public branch is a re-rooted orphan and releases copy the tree rather
  than the history. Be economical with API calls, and never add the key to a
  tracked file.
- **Postgres roles are per-component.** `backend/.env` is the app runtime role,
  `backend/.env.admin` is the admin role (also used by the postgres MCP server),
  `sync-service/.env` is the sync role. Do not conflate them. Passwords may
  contain characters needing shell escaping.
- **Row estimates lie.** The postgres MCP `list_tables` reports 0 estimated rows
  for populated tables. Use real `COUNT(*)`.
- **Releases** go out only via `./release-to-public.sh "msg"`, which runs
  secret, forbidden-path and internal-path checks. Never push to the `public`
  remote by hand, and never weaken those checks. Note its personal-info check
  looks for a full name and email address but **not a bare username** — that gap
  let `su <username> <username>` nearly ship in a logrotate config.

---

## Things the previous session got wrong

Recorded because the same traps are still there:

1. **"No log rotation configured."** It was configured and inert:
   `maxSize: '20m'` as a string, and winston compares `size >= this.maxsize`
   numerically, so `'20m'` coerced to NaN. 349 MB accumulated under a config
   that read as correct. Values are byte counts now, validated on load.
2. **"`/hearing/119` is a live bug."** All 292 occurrences were from 2025. The
   unrotated log made year-old errors look current.
3. **"Four corrupted sections."** It was 240, and the first detector's premise
   was wrong besides.
4. **A 500-page cap added to the repair script** to stop "absurd" widening. That
   cap was rejecting legitimately discontinuous issues. It was removed. Do not
   reintroduce a geometry-based guard.
5. **The first repair pass damaged 7 rows** before a spot-check caught it,
   because widen-only assumes a section's articles belong to it.

The pattern in all five: the database disagreed with the first reasonable
explanation, and checking the primary source — the API, the document URL, the
actual log timestamps — was faster than reasoning about it.
