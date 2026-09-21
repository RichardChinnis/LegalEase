-- Applied 2026-09-21. Removes the only two non-synced rows in
-- congressional_record_article.
--
-- article_id 1 and 2 are hand-made development fixtures, not Congressional
-- Record content. Evidence, all independently checked:
--   * The Congress.gov API for Vol 169 No. 1 returns House pages 1-8 and Senate
--     1-26 with no outliers. Neither article appears in the response.
--   * content_text is placeholder prose -- "The House considered amendments to
--     the Congressional Accountability Act..." -- not Record text.
--   * They are the ONLY 2 of 467,091 articles with both pdf_url and text_url
--     NULL. Every genuinely synced article carries at least one source link.
--   * Both were inserted at the table's earliest timestamp, as ids 1 and 2.
--
-- They sat in Vol 169 No. 1 (2023-01-03) at H3218 and S1234, thousands of pages
-- outside their sections, which is what made them look like a misassignment bug.
-- They are not: the 298 other articles that looked misassigned are correct
-- upstream data (a CR issue can genuinely span discontinuous pages).
--
-- No action_congressional_record_reference rows point at either (verified 0).
-- Full pre-delete rows: seed-articles-1-2-backup-20260921.json

BEGIN;
DELETE FROM congressional_record_article WHERE article_id IN (1, 2);
COMMIT;
