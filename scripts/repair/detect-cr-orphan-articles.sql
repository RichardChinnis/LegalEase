-- Finds articles assigned to a section whose page numbers place them far outside
-- that section's issue -- i.e. articles that belong to a different issue entirely.
--
-- This is the defect underneath the seven sections that cr-section-page-drift-
-- repair-20260921.sql deliberately leaves alone. Example: section 1 is the House
-- section of Vol 169 No. 1 (Jan 2023), pages H1-H8, but holds article_id 1,
-- "Congressional Accountability Act of 1995 Amendment", at H3218-H3220.
--
-- Repairing the section's PAGE RANGE cannot fix this; it only launders the bad
-- assignment into a 3,220-page section. The article needs to be reassigned to
-- its real section or removed. That needs a judgement call per row, which is why
-- there is no accompanying repair script.

SELECT a.article_id,
       a.section_id,
       s.name::text   AS section_chamber,
       v.volume_number,
       i.issue_number,
       s.start_page   AS section_start,
       s.end_page     AS section_end,
       a.start_page   AS article_start,
       a.end_page     AS article_end,
       regexp_replace(a.start_page,'\D','','g')::int
         - regexp_replace(s.end_page,'\D','','g')::int AS pages_past_section_end,
       left(a.title, 60) AS title
  FROM congressional_record_article a
  JOIN congressional_record_section s ON s.section_id = a.section_id
  JOIN congressional_record_issue   i ON i.issue_id   = s.issue_id
  JOIN congressional_record_volume  v ON v.volume_id  = i.volume_id
 WHERE s.start_page ~ '^\w?\d+$' AND s.end_page ~ '^\w?\d+$' AND a.start_page ~ '^\w?\d+$'
   AND substring(a.start_page from '^[A-Za-z]*') = substring(s.start_page from '^[A-Za-z]*')
   -- more than 500 pages outside the section in either direction
   AND (regexp_replace(a.start_page,'\D','','g')::int
          > regexp_replace(s.end_page,'\D','','g')::int + 500
     OR regexp_replace(a.start_page,'\D','','g')::int
          < regexp_replace(s.start_page,'\D','','g')::int - 500)
 ORDER BY abs(regexp_replace(a.start_page,'\D','','g')::int
                - regexp_replace(s.end_page,'\D','','g')::int) DESC;
