-- Applied 2026-09-21. Repairs four congressional_record_section rows whose
-- page range was derived from whichever article happened to be first in the
-- API response, rather than from the section's actual span.
--
-- Root cause (now fixed in code, commit 7db0a637):
--   const startPage = sectionArticles[0]?.startPage || 'S1';
--   const endPage   = sectionArticles[last]?.endPage || startPage;
-- When the last article had no endPage, end_page silently became start_page.
--
-- Corrected to the true span: min(article.start_page) .. max(article.end_page).
-- Every article under these sections has a non-null end_page, so the max is
-- reliable. page_count is a generated column and stays NULL for prefixed pages.
--
-- Rollback: cr-sections-rollback-20260921.sql
BEGIN;
UPDATE congressional_record_section SET start_page='S6943', end_page='S6960' WHERE section_id=22938;  -- was S6958-S6958
UPDATE congressional_record_section SET start_page='E1019', end_page='E1027' WHERE section_id=22991;  -- was E1021-E1021
UPDATE congressional_record_section SET start_page='H4577', end_page='H4588' WHERE section_id=23007;  -- was H4577-H4577
UPDATE congressional_record_section SET start_page='H2819', end_page='H2822' WHERE section_id=25597;  -- was H2819-H2819
COMMIT;
