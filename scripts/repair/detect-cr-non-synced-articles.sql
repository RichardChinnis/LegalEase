-- Finds congressional_record_article rows that did not come from Congress.gov.
--
-- REPLACES detect-cr-orphan-articles.sql, which was built on a false premise.
-- That query flagged articles sitting far outside their section's page range,
-- assuming distance implied misassignment. It does not. A Congressional Record
-- issue can genuinely span discontinuous pages: Vol 161 No. 120's House section
-- holds articles at H5564-H5593 AND H8527-H8545, and both clusters' document
-- URLs resolve on congress.gov under 161/120, dated 2015-07-28. 27 sections of
-- 11,725 have spreads over 500 pages and every one checked was real. The old
-- query reported 300 rows, of which 298 were correct data.
--
-- The reliable signal is provenance, not geometry. Every article the sync writes
-- carries at least one source link, because the API always supplies a
-- Formatted Text or PDF url. A row with neither was not synced.
--
-- When this last ran it found exactly 2 rows of 467,091 -- article_id 1 and 2,
-- hand-made development fixtures whose content_text was placeholder prose
-- ("The House considered amendments to the Congressional Accountability
-- Act..."). Both were removed by delete-seed-articles-20260921.sql, so a clean
-- database returns no rows.
--
-- Before deleting anything this reports, confirm against the API:
--   /v3/daily-congressional-record/{volume}/{issue}/articles
-- If the article is absent there and has no source links, it did not come from
-- Congress.gov.

SELECT a.article_id,
       a.section_id,
       v.volume_number,
       i.issue_number,
       s.name::text AS section,
       a.start_page,
       a.end_page,
       a.title,
       a.word_count,
       a.created_at,
       left(coalesce(a.content_text,''), 80) AS content_sample
  FROM congressional_record_article a
  JOIN congressional_record_section s ON s.section_id = a.section_id
  JOIN congressional_record_issue   i ON i.issue_id   = s.issue_id
  JOIN congressional_record_volume  v ON v.volume_id  = i.volume_id
 WHERE a.pdf_url IS NULL
   AND a.text_url IS NULL
 ORDER BY a.article_id;
