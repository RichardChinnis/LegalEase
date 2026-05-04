-- Rollback Migration: 004_enhance_member_schema_for_api_parity
-- Description: Rollback comprehensive member data tables and enhancements
-- Author: Database Administrator
-- Date: 2024-09-02

BEGIN;

-- ======================================
-- 1. DROP THE API VIEW
-- ======================================
DROP VIEW IF EXISTS member_api_view CASCADE;

-- ======================================
-- 2. REMOVE FOREIGN KEY CONSTRAINT FROM MEMBER_TERM
-- ======================================
ALTER TABLE member_term DROP CONSTRAINT IF EXISTS fk_member_term_state;

-- ======================================
-- 3. DROP TRIGGERS
-- ======================================
DROP TRIGGER IF EXISTS update_member_address_updated_at ON member_address;
DROP TRIGGER IF EXISTS update_member_party_history_updated_at ON member_party_history;
DROP TRIGGER IF EXISTS update_member_previous_names_updated_at ON member_previous_names;
DROP TRIGGER IF EXISTS update_member_legislation_stats_updated_at ON member_legislation_stats;

-- ======================================
-- 4. DROP NEW TABLES (ORDER MATTERS DUE TO FOREIGN KEYS)
-- ======================================

-- Drop member-related tables first (they reference member table)
DROP TABLE IF EXISTS member_legislation_stats CASCADE;
DROP TABLE IF EXISTS member_previous_names CASCADE;
DROP TABLE IF EXISTS member_party_history CASCADE;
DROP TABLE IF EXISTS member_address CASCADE;

-- Drop states table (no foreign key dependencies)
DROP TABLE IF EXISTS states CASCADE;

-- ======================================
-- 5. REMOVE MIGRATION RECORD
-- ======================================
DELETE FROM schema_migrations 
WHERE migration_id = '004_enhance_member_schema_for_api_parity';

COMMIT;

-- ======================================
-- ROLLBACK VERIFICATION
-- ======================================
-- After rollback, the schema should return to the state before migration 004:
-- - member table: unchanged (original structure preserved)
-- - member_term table: unchanged (original structure preserved)
-- - All new tables removed
-- - All new indexes removed
-- - All new triggers removed
-- - All new views removed
-- - Foreign key constraints removed