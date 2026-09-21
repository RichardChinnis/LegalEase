-- Detects Congressional Record sections whose recorded page range fails to
-- contain the articles they hold. Read-only; safe to run any time.
--
-- Background: all three CR sync paths used to derive a section's range from
-- whichever article appeared first in an unordered API response, and fell back
-- to start_page when the last article had no end page:
--
--     const startPage = sectionArticles[0]?.startPage || 'S1';
--     const endPage   = sectionArticles[last]?.endPage || startPage;
--
-- That produced ranges that were collapsed (end == start), reversed (end <
-- start), or merely too narrow. Fixed in code, but rows written before the fix
-- stay wrong until repaired.
--
-- TWO RULES THIS QUERY GETS RIGHT, AND A NAIVE VERSION DOES NOT:
--
-- 1. Only articles whose page prefix MATCHES the section's define its extent.
--    Daily Digest is D-paged but cites S/H/E pages from other chambers; those
--    are references, not extent. Without this filter every Daily Digest section
--    looks broken. (Six did, in the first version of this query.)
--
-- 2. An article's extent is GREATEST(start_page, end_page), not start_page
--    alone -- a section can be too short by less than one article.
--
-- Repair with cr-section-page-drift-repair-20260921.sql, which widens only:
--   new start = LEAST(recorded start, earliest article page)
--   new end   = GREATEST(recorded end, latest article page)
-- A section may legitimately begin before its first article, so a recorded
-- start that is already lower is kept.

SELECT s.section_id,
       s.name::text               AS chamber,
       v.volume_number,
       i.issue_number,
       s.start_page,
       s.end_page,
       min(a.start_page)          AS earliest_article_page,
       max(COALESCE(a.end_page, a.start_page)) AS latest_article_page,
       count(*)                   AS articles,
       s.metadata->>'sync_source' AS sync_source,
       CASE
         WHEN regexp_replace(s.end_page,'\D','','g')::int
                < regexp_replace(s.start_page,'\D','','g')::int THEN 'reversed'
         WHEN s.start_page = s.end_page                          THEN 'collapsed'
         ELSE 'too narrow'
       END                        AS defect
  FROM congressional_record_section s
  JOIN congressional_record_issue  i ON i.issue_id  = s.issue_id
  JOIN congressional_record_volume v ON v.volume_id = i.volume_id
  JOIN congressional_record_article a ON a.section_id = s.section_id
 WHERE s.start_page ~ '^\w?\d+$'
   AND s.end_page   ~ '^\w?\d+$'
   AND a.start_page ~ '^\w?\d+$'
   -- rule 1: same-prefix articles only
   AND substring(a.start_page from '^[A-Za-z]*') = substring(s.start_page from '^[A-Za-z]*')
 GROUP BY s.section_id, s.name, v.volume_number, i.issue_number,
          s.start_page, s.end_page, s.metadata
HAVING regexp_replace(s.end_page,'\D','','g')::int
         < regexp_replace(s.start_page,'\D','','g')::int
    -- rule 2: compare against the article's full extent
    OR max(GREATEST(regexp_replace(a.start_page,'\D','','g')::int,
                    regexp_replace(COALESCE(a.end_page,a.start_page),'\D','','g')::int))
         > regexp_replace(s.end_page,'\D','','g')::int
    OR min(regexp_replace(a.start_page,'\D','','g')::int)
         < regexp_replace(s.start_page,'\D','','g')::int
 ORDER BY s.section_id;
