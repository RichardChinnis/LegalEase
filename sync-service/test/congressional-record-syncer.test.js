'use strict';

// Unit tests for CongressionalRecordSyncer. No test framework is installed, so
// this is a standalone assert-based script:
//   node test/congressional-record-syncer.test.js
//   exit 0 = all pass, exit 1 = a failure.

const assert = require('assert');
const CongressionalRecordSyncer = require('../syncers/congressional-record-syncer');
const logger = require('../lib/logger');
const DailyCongressionalRecordSync = require('../daily-congressional-record-sync');
const BackfillCongressionalRecord = require('../backfill-missing-cr-issues');

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

// congressional_record_section.start_page and congressional_record_article.start_page
// are both `character varying(20) NOT NULL`. The fake db records every attempted
// upsert BEFORE enforcing that rule, so a test can tell "never handed to the DB"
// apart from "handed over and rejected".
function createFakeDb() {
  const attempted = { sections: [], articles: [] };
  const written = { sections: [], articles: [] };

  const enforceNotNullStartPage = (row, relation) => {
    if (row.start_page === null || row.start_page === undefined) {
      throw new Error(
        `null value in column "start_page" of relation "${relation}" violates not-null constraint`
      );
    }
  };

  return {
    attempted,
    written,
    async upsertCongressionalRecordVolume() {
      return { volume_id: 1, inserted: true, updated: false };
    },
    async upsertCongressionalRecordIssue() {
      return { issue_id: 10, inserted: true, updated: false };
    },
    async upsertCongressionalRecordSection(row) {
      attempted.sections.push(row);
      enforceNotNullStartPage(row, 'congressional_record_section');
      written.sections.push(row);
      return { section_id: 100 + written.sections.length, inserted: true, updated: false };
    },
    async upsertCongressionalRecordArticle(row) {
      attempted.articles.push(row);
      enforceNotNullStartPage(row, 'congressional_record_article');
      written.articles.push(row);
      return { article_id: 200 + written.articles.length, inserted: true, updated: false };
    }
  };
}

// The completion line is the operator's view of one issue, so what reaches the
// logger is the behavior under test. Swap logger.info for the duration, restore
// it either way.
async function captureLogMeta(message, run) {
  const original = logger.info;
  let captured;
  logger.info = (msg, meta) => {
    if (msg === message) captured = meta;
    return original.call(logger, msg, meta);
  };
  try {
    await run();
  } finally {
    logger.info = original;
  }
  return captured;
}

// Build off the prototype so no real DB pool or API client is opened.
function createSyncer(db) {
  const syncer = Object.create(CongressionalRecordSyncer.prototype);
  syncer.db = db;
  syncer.resetStats();
  return syncer;
}

// Shape of one real daily issue (Vol. 171 No. 152, 2025-09-17), trimmed to the
// fields the syncer reads. `sections` is supplied per test.
function issuePayload(sections) {
  return {
    issue: {
      volumeNumber: 171,
      issueNumber: 152,
      congress: 119,
      sessionNumber: 1,
      issueDate: '2025-09-17T00:00:00Z',
      year: 2025,
      fullIssueUrl: 'https://www.congress.gov/171/crec/2025/09/17/171-152.pdf',
      sections
    }
  };
}

// Congress.gov intermittently omits startPage. The bad section is listed FIRST so
// that a fix which aborts the loop can't pass by accident.
const SECTION_WITHOUT_START_PAGE = {
  name: 'Daily Digest',
  endPage: 'D1010',
  pdfUrl: 'https://www.congress.gov/171/crec/2025/09/17/171-152-digest.pdf'
};

const VALID_SECTION = {
  name: 'Senate Section',
  startPage: 'S6021',
  endPage: 'S6094',
  pdfUrl: 'https://www.congress.gov/171/crec/2025/09/17/171-152-senate.pdf'
};

// congressional_record_article.start_page is NOT NULL too, so articles need the
// same guard. Bad entries are listed first for the same reason as sections.
const ARTICLE_WITHOUT_START_PAGE = {
  title: 'ADDITIONAL STATEMENTS',
  endPage: 'S6030',
  text: [{ type: 'PDF', url: 'https://www.congress.gov/171/crec/2025/09/17/171-152-S6030.pdf' }]
};

const VALID_ARTICLE = {
  title: 'TRIBUTE TO THE HONORABLE JANE DOE',
  startPage: 'S6022',
  endPage: 'S6023',
  text: [{ type: 'Formatted Text', url: 'https://www.congress.gov/171/crec/2025/09/17/171-152-S6022.htm' }]
};

// --- daily-congressional-record-sync.js -------------------------------------
// The timer job is a parallel CR implementation: it borrows the syncer's db but
// builds its own section/article rows, so it needs the same guards.

const DAILY_ISSUE_DATA = {
  congress: 119,
  sessionNumber: 2,
  issueDate: '2026-09-17T04:00:00Z'
};

// Shape the articles endpoint returns: sections wrapping sectionArticles.
function dailySections(...sections) {
  return sections;
}

// daily-congressional-record-sync.js and backfill-missing-cr-issues.js are the
// same code twice over, down to the fallbacks. Both build rows off the syncer's
// db the same way, so one factory serves both.
function createCrWriter(Cls, db) {
  const writer = Object.create(Cls.prototype);
  writer.syncer = { db };
  writer.stats = {
    issuesProcessed: 0,
    issuesSkipped: 0,
    totalArticlesStored: 0,
    sectionsSkipped: 0,
    sectionsUnmapped: 0,
    articlesSkipped: 0,
    errors: []
  };
  return writer;
}

// Anything these two disagree about is a bug in one of them, so the guards below
// run against both rather than being described twice.
const CR_WRITERS = [
  { label: 'daily sync', Cls: DailyCongressionalRecordSync },
  { label: 'backfill', Cls: BackfillCongressionalRecord }
];

const DAILY_SECTION_NO_PAGES = {
  name: 'Daily Digest',
  sectionArticles: [
    { title: 'DAILY DIGEST', text: [] },
    { title: 'Contents', text: [] }
  ]
};

// Not in mapSectionName's table. Its articles carry Senate pages, so a fallback
// to 'Senate' would look entirely plausible in the data.
const DAILY_SECTION_UNMAPPED = {
  name: 'Senate Podcast Section',
  sectionArticles: [
    { title: 'SOMETHING NEW', startPage: 'S6100', endPage: 'S6101', text: [] },
    { title: 'MORE OF IT', startPage: 'S6102', text: [] }
  ]
};

const DAILY_SECTION_HOUSE = {
  name: 'House Section',
  sectionArticles: [
    { title: 'HOUSE BUSINESS', startPage: 'H5987', endPage: 'H5990', text: [] }
  ]
};

const DAILY_SECTION_VALID = {
  name: 'Senate Section',
  sectionArticles: [
    { title: 'TRIBUTE', startPage: 'S6022', endPage: 'S6023', text: [] },
    { title: 'ADJOURNMENT', startPage: 'S6094', endPage: 'S6094', text: [] }
  ]
};

(async () => {
  await test('a section with no startPage is skipped instead of handed to the DB', async () => {
    const db = createFakeDb();
    const syncer = createSyncer(db);
    syncer.client = {
      async getDailyCongressionalRecord() {
        return issuePayload([SECTION_WITHOUT_START_PAGE, VALID_SECTION]);
      }
    };

    await syncer.syncCongressionalRecordIssue(171, 152, { syncArticles: false });

    assert.deepStrictEqual(
      db.attempted.sections.map(r => r.start_page),
      ['S6021'],
      'a section with no startPage must never reach the DB layer'
    );
    assert.strictEqual(
      syncer.stats.sections.skipped, 1,
      'the dropped section must be counted so the sync report shows the data loss'
    );
  });

  await test('a valid sibling section in the same payload is still written', async () => {
    const db = createFakeDb();
    const syncer = createSyncer(db);
    syncer.client = {
      async getDailyCongressionalRecord() {
        return issuePayload([SECTION_WITHOUT_START_PAGE, VALID_SECTION]);
      }
    };

    const result = await syncer.syncCongressionalRecordIssue(171, 152, { syncArticles: false });

    assert.strictEqual(db.written.sections.length, 1, 'the good section must survive its bad sibling');
    assert.deepStrictEqual(
      {
        issue_id: db.written.sections[0].issue_id,
        name: db.written.sections[0].name,
        start_page: db.written.sections[0].start_page,
        end_page: db.written.sections[0].end_page
      },
      { issue_id: 10, name: 'Senate', start_page: 'S6021', end_page: 'S6094' }
    );
    assert.strictEqual(result.success, true, 'one unusable section must not fail the whole issue');
    assert.strictEqual(syncer.stats.sections.inserted, 1);
    assert.strictEqual(syncer.stats.sections.failed, 0, 'a skip is not an insert failure');
  });

  await test('a section whose startPage is blank is skipped, not written as a blank page', async () => {
    const db = createFakeDb();
    const syncer = createSyncer(db);
    syncer.client = {
      async getDailyCongressionalRecord() {
        // A blank start_page slips past NOT NULL, and the valid_page_numbers
        // CHECK only inspects the format when end_page is present -- so without
        // this guard the row is stored with an unusable page number.
        return issuePayload([{ name: 'House Section', startPage: '   ' }, VALID_SECTION]);
      }
    };

    await syncer.syncCongressionalRecordIssue(171, 152, { syncArticles: false });

    assert.deepStrictEqual(
      db.attempted.sections.map(r => r.start_page),
      ['S6021'],
      'a blank startPage must be treated as missing, not stored'
    );
    assert.strictEqual(syncer.stats.sections.skipped, 1);
  });

  await test('an article with no startPage is skipped instead of handed to the DB', async () => {
    const db = createFakeDb();
    const syncer = createSyncer(db);

    await syncer.syncSectionArticles(100, [ARTICLE_WITHOUT_START_PAGE, VALID_ARTICLE]);

    assert.deepStrictEqual(
      db.attempted.articles.map(r => r.start_page),
      ['S6022'],
      'an article with no startPage must never reach the DB layer'
    );
    assert.strictEqual(
      syncer.stats.articles.skipped, 1,
      'the dropped article must be counted so the sync report shows the data loss'
    );
  });

  await test('a valid sibling article in the same section is still written', async () => {
    const db = createFakeDb();
    const syncer = createSyncer(db);

    await syncer.syncSectionArticles(100, [ARTICLE_WITHOUT_START_PAGE, VALID_ARTICLE]);

    assert.strictEqual(db.written.articles.length, 1, 'the good article must survive its bad sibling');
    assert.deepStrictEqual(
      {
        section_id: db.written.articles[0].section_id,
        title: db.written.articles[0].title,
        start_page: db.written.articles[0].start_page
      },
      { section_id: 100, title: 'TRIBUTE TO THE HONORABLE JANE DOE', start_page: 'S6022' }
    );
    assert.strictEqual(syncer.stats.articles.inserted, 1);
    assert.strictEqual(syncer.stats.articles.failed, 0, 'a skip is not an insert failure');
  });

  await test('the completion log keeps the per-issue section count and the running totals apart', async () => {
    const db = createFakeDb();
    const syncer = createSyncer(db);
    syncer.client = {
      async getDailyCongressionalRecord() {
        return issuePayload([SECTION_WITHOUT_START_PAGE, VALID_SECTION]);
      }
    };

    const meta = await captureLogMeta('CR issue sync completed', () =>
      syncer.syncCongressionalRecordIssue(171, 152, { syncArticles: false })
    );

    assert.ok(meta, 'the sync must log a completion line');
    assert.strictEqual(
      meta.stats.sectionsProcessed, 1,
      'the per-issue section count must reach the log under its own key'
    );
    assert.deepStrictEqual(
      meta.stats.sections, { inserted: 1, updated: 0, failed: 0, skipped: 1 },
      'the running section totals must reach the log alongside the count'
    );
  });

  for (const { label, Cls } of CR_WRITERS) {
    await test(`${label} skips a section whose articles have no start page instead of inventing S1`, async () => {
      const db = createFakeDb();
      const writer = createCrWriter(Cls, db);

      await writer.storeSectionsAndArticles(172, 147, dailySections(DAILY_SECTION_NO_PAGES), DAILY_ISSUE_DATA);

      assert.deepStrictEqual(
        db.attempted.sections.map(r => r.start_page), [],
        'a section with no usable page must be skipped, never stored under a made-up page number'
      );
      assert.strictEqual(writer.stats.sectionsSkipped, 1, 'the skipped section must be counted');
    });

    await test(`${label} still stores a valid sibling section alongside a skipped one`, async () => {
      const db = createFakeDb();
      const writer = createCrWriter(Cls, db);

      const stored = await writer.storeSectionsAndArticles(
        172, 147, dailySections(DAILY_SECTION_NO_PAGES, DAILY_SECTION_VALID), DAILY_ISSUE_DATA
      );

      assert.deepStrictEqual(
        db.written.sections.map(r => ({ name: r.name, start_page: r.start_page, end_page: r.end_page })),
        [{ name: 'Senate', start_page: 'S6022', end_page: 'S6094' }],
        'the good section must survive, with pages taken from its own articles'
      );
      assert.strictEqual(stored, 2, 'both articles of the good section must be stored');
    });

    await test(`${label} skips an article with no start page rather than inheriting the section page`, async () => {
      const db = createFakeDb();
      const writer = createCrWriter(Cls, db);
      const section = {
        name: 'Senate Section',
        sectionArticles: [
          { title: 'TRIBUTE', startPage: 'S6022', endPage: 'S6023', text: [] },
          { title: 'NO PAGE HERE', text: [] }
        ]
      };

      await writer.storeSectionsAndArticles(172, 147, dailySections(section), DAILY_ISSUE_DATA);

      assert.deepStrictEqual(
        db.attempted.articles.map(r => r.start_page), ['S6022'],
        'an article with no start page must not borrow a page number from its section'
      );
      assert.strictEqual(writer.stats.articlesSkipped, 1, 'the skipped article must be counted');
    });

    await test(`${label} leaves end_page null when the API omits it, instead of echoing start_page`, async () => {
      const db = createFakeDb();
      const writer = createCrWriter(Cls, db);
      const section = {
        name: 'Senate Section',
        sectionArticles: [{ title: 'ONE PAGER', startPage: 'S6022', text: [] }]
      };

      await writer.storeSectionsAndArticles(172, 147, dailySections(section), DAILY_ISSUE_DATA);

      assert.strictEqual(
        db.written.articles[0].end_page, null,
        'an unknown end page is null, not a copy of the start page'
      );
    });

    await test(`${label} skips a section whose name it cannot map instead of filing it under Senate`, async () => {
      const db = createFakeDb();
      const writer = createCrWriter(Cls, db);

      const stored = await writer.storeSectionsAndArticles(
        172, 147, dailySections(DAILY_SECTION_UNMAPPED, DAILY_SECTION_HOUSE), DAILY_ISSUE_DATA
      );

      assert.deepStrictEqual(
        db.attempted.sections.map(r => r.name), ['House'],
        'an unrecognized section name must not be relabeled as Senate'
      );
      assert.strictEqual(writer.stats.sectionsUnmapped, 1, 'the unmapped section must be counted');
      assert.strictEqual(stored, 1, "only the mapped section's articles may be stored");
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
