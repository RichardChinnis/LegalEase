-- Rollback for cr-sections-repair-20260921.sql
-- Restores the pre-repair (corrupt) values for the four sections whose
-- end_page equalled start_page while their articles ran past it.
-- Captured 2026-09-21 before the repair was applied.
BEGIN;
UPDATE congressional_record_section SET start_page='S6958', end_page='S6958' WHERE section_id=22938;
UPDATE congressional_record_section SET start_page='E1021', end_page='E1021' WHERE section_id=22991;
UPDATE congressional_record_section SET start_page='H4577', end_page='H4577' WHERE section_id=23007;
UPDATE congressional_record_section SET start_page='H2819', end_page='H2819' WHERE section_id=25597;
COMMIT;
