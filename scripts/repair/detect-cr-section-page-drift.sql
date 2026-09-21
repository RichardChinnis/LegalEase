-- Detects Congressional Record sections whose recorded page range contradicts
-- the articles they contain.
--
-- Background: the daily and backfill CR sync paths used to derive a section's
-- range from whichever article happened to appear first in the API response:
--
--     const startPage = sectionArticles[0]?.startPage || 'S1';
--     const endPage   = sectionArticles[last]?.endPage || startPage;
--
-- Two ways that went wrong. When the last article had no endPage, end_page
-- silently became start_page, collapsing the range to a single page. And because
-- the API response is not ordered by page, "first article" was not necessarily
-- the lowest page, so start_page could sit above articles that precede it.
--
-- The fabrication is fixed in the sync code, but rows written before that fix
-- stay wrong. This finds them. It is safe to run any time -- read-only.
--
-- To repair a row, widen it to the true span its own articles describe:
--
--     UPDATE congressional_record_section s
--        SET start_page = sub.min_start, end_page = sub.max_end
--       FROM (SELECT section_id,
--                    min(start_page) AS min_start,
--                    max(end_page)   AS max_end
--               FROM congressional_record_article
--              WHERE section_id = <id>
--              GROUP BY section_id) sub
--      WHERE s.section_id = sub.section_id;
--
-- Check `count(*) FILTER (WHERE end_page IS NULL)` on the articles first: if any
-- article lacks an end page, max(end_page) understates the span.

SELECT s.section_id,
       s.name::text                AS chamber,
       v.volume_number,
       i.issue_number,
       s.start_page,
       s.end_page,
       min(a.start_page)           AS earliest_article_page,
       max(a.end_page)             AS latest_article_page,
       count(*)                    AS articles,
       count(*) FILTER (WHERE a.end_page IS NULL) AS articles_missing_end_page,
       s.metadata->>'sync_source'  AS sync_source
  FROM congressional_record_section s
  JOIN congressional_record_issue  i ON i.issue_id  = s.issue_id
  JOIN congressional_record_volume v ON v.volume_id = i.volume_id
  JOIN congressional_record_article a ON a.section_id = s.section_id
 -- Only rows whose pages are numeric-with-optional-prefix can be compared.
 WHERE s.start_page ~ '^\w?\d+$'
   AND s.end_page   ~ '^\w?\d+$'
   AND a.start_page ~ '^\w?\d+$'
 GROUP BY s.section_id, s.name, v.volume_number, i.issue_number,
          s.start_page, s.end_page, s.metadata
-- Contradiction in either direction: an article starting past the section's end,
-- or one starting before the section's beginning.
HAVING max(regexp_replace(a.start_page, '\D', '', 'g')::int)
         > regexp_replace(s.end_page,   '\D', '', 'g')::int
    OR min(regexp_replace(a.start_page, '\D', '', 'g')::int)
         < regexp_replace(s.start_page, '\D', '', 'g')::int
 ORDER BY s.section_id;
