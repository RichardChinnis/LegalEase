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
-- HISTORY. The first run updated 240 rows; 7 were then reverted because widening
-- turned them into 500-8,400 page sections, which looked absurd. A 500-page cap
-- was added. Investigating the API showed the cap was WRONG: a Congressional
-- Record issue can genuinely span discontinuous pages. Vol 161 No. 120's House
-- section really does hold articles at H5564-H5593 and H8527-H8545, and both
-- clusters' document URLs resolve on congress.gov under 161/120, dated
-- 2015-07-28. 27 sections of 11,725 have spreads over 500 pages and are real.
--
-- The cap is therefore removed and those sections are repaired to their true
-- span. Two of the 7 needed no range fix at all: sections 1 and 2 were skewed
-- only by article_id 1 and 2, hand-made development fixtures with no source
-- links, deleted by delete-seed-articles-20260921.sql. With those gone the
-- sections' own articles describe them correctly.
--
-- Widen-only remains right, but for a better reason than caution: min..max of a
-- section's own articles is the honest extent, however wide it looks.

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
   AND (m.s_end < m.s_start OR m.a_max > m.s_end OR m.a_min < m.s_start);

COMMIT;
