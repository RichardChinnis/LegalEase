-- Applied 2026-09-21. Widens every congressional_record_section whose recorded
-- page range fails to contain its own articles.
--
-- Root cause (fixed in code, commit 7db0a637): all three CR writers derived a
-- section's range from whichever article appeared first in an unordered API
-- response, and fell back to start_page when the last article had no end page.
-- That produced ranges that were collapsed, reversed, or simply too narrow.
--
-- Semantics -- WIDEN ONLY. A section may legitimately begin before its first
-- article (section header text occupies pages too), so the recorded start is
-- kept when it is already lower. The repair only guarantees the invariant that
-- was violated: a section's range contains every article it holds.
--
--   new start_page = LEAST(recorded start, earliest article page)
--   new end_page   = GREATEST(recorded end, latest article page)
--
-- Only articles whose page prefix MATCHES the section's define its extent.
-- Daily Digest cites other chambers' pages (S/H/E) while being D-paged itself;
-- those citations are references, not extent, and must not widen the range.
--
-- Verified before running: no page value anywhere carries a leading zero, so
-- rebuilding "prefix || integer" is lossless.
--
-- Rollback: cr-section-page-drift-rollback-20260921.sql (240 rows, exact
-- pre-repair values).
--
-- OUTCOME: 240 rows updated, 7 then reverted. Widen-only is only correct if a
-- section's articles actually belong to it. Seven sections hold MISASSIGNED
-- articles -- section 1 (Vol 169 No. 1, Jan 2023) contains article_id 1,
-- "Congressional Accountability Act of 1995 Amendment" at H3218-H3220 -- and
-- widening propagated that into the section, turning H1-H8 into H1-H3220.
-- Those 7 were reverted to their pre-repair values and are excluded below.
-- Their real defect is article assignment, not page range; fixing the range
-- while a 1995 article sits in a 2023 section would only hide it.
--
-- Excluded: 1, 2, 2303, 6729, 8054, 22969, 26627. Investigate with
-- detect-cr-orphan-articles.sql. 233 sections were correctly repaired; these 7
-- remain drifted on purpose.
--
-- The guard below also bounds any single widening to 500 pages, so re-running
-- this cannot reintroduce the same damage.

BEGIN;

WITH matched AS (
  SELECT s.section_id,
         substring(s.start_page from '^[A-Za-z]*')      AS pfx,
         regexp_replace(s.start_page,'\D','','g')::int  AS s_start,
         regexp_replace(s.end_page,'\D','','g')::int    AS s_end,
         min(regexp_replace(a.start_page,'\D','','g')::int) AS a_min,
         max(GREATEST(regexp_replace(a.start_page,'\D','','g')::int,
                      regexp_replace(COALESCE(a.end_page,a.start_page),'\D','','g')::int)) AS a_max
    FROM congressional_record_section s
    JOIN congressional_record_article a ON a.section_id = s.section_id
   WHERE s.start_page ~ '^\w?\d+$'
     AND s.end_page   ~ '^\w?\d+$'
     AND a.start_page ~ '^\w?\d+$'
     AND substring(a.start_page from '^[A-Za-z]*') = substring(s.start_page from '^[A-Za-z]*')
   GROUP BY s.section_id, s.start_page, s.end_page
)
UPDATE congressional_record_section s
   SET start_page = m.pfx || LEAST(m.s_start, m.a_min)::text,
       end_page   = m.pfx || GREATEST(m.s_end,  m.a_max)::text
  FROM matched m
 WHERE s.section_id = m.section_id
   AND (m.s_end < m.s_start OR m.a_max > m.s_end OR m.a_min < m.s_start)
   -- Guard: refuse to widen a section past 500 pages. A CR section spans tens
   -- of pages, not hundreds; anything beyond that means the section holds an
   -- article that does not belong to it, and the range is not the thing to fix.
   AND GREATEST(m.s_end, m.a_max) - LEAST(m.s_start, m.a_min) <= 500;

COMMIT;
