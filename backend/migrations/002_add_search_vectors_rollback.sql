-- Rollback Migration: Remove Full-Text Search Vectors from Congressional Tables
-- Description: Removes tsvector columns, GIN indexes, trigger functions, and helper functions added in 002_add_search_vectors
-- Created: 2025-08-25
-- Safe to run: Removes search functionality without affecting core data

-- Start transaction for atomic rollback
BEGIN;

-- ---
-- Drop search helper functions
-- ---
DROP FUNCTION IF EXISTS search_congressional_content(TEXT, INT);
DROP FUNCTION IF EXISTS search_bills_only(TEXT, INT);

-- ---
-- Drop search statistics view
-- ---
DROP VIEW IF EXISTS search_index_stats;

-- ---
-- Drop search vector triggers
-- ---
DROP TRIGGER IF EXISTS bill_search_vector_trigger ON bill;
DROP TRIGGER IF EXISTS hearing_search_vector_trigger ON hearing;
DROP TRIGGER IF EXISTS committee_report_search_vector_trigger ON committee_report;
DROP TRIGGER IF EXISTS action_search_vector_trigger ON action;

-- ---
-- Drop trigger functions
-- ---
DROP FUNCTION IF EXISTS update_bill_search_vector();
DROP FUNCTION IF EXISTS update_hearing_search_vector();
DROP FUNCTION IF EXISTS update_committee_report_search_vector();
DROP FUNCTION IF EXISTS update_action_search_vector();

-- ---
-- Drop GIN indexes
-- ---
DROP INDEX IF EXISTS idx_bill_search_vector_gin;
DROP INDEX IF EXISTS idx_hearing_search_vector_gin;
DROP INDEX IF EXISTS idx_committee_report_search_vector_gin;
DROP INDEX IF EXISTS idx_action_search_vector_gin;

-- ---
-- Drop composite performance indexes added for search
-- ---
DROP INDEX IF EXISTS idx_bill_congress_policy_area;
DROP INDEX IF EXISTS idx_bill_congress_date;
DROP INDEX IF EXISTS idx_hearing_congress_chamber;
DROP INDEX IF EXISTS idx_action_bill_date;
DROP INDEX IF EXISTS idx_committee_report_congress_date;

-- ---
-- Remove search_vector columns
-- ---
ALTER TABLE bill DROP COLUMN IF EXISTS search_vector;
ALTER TABLE hearing DROP COLUMN IF EXISTS search_vector;
ALTER TABLE committee_report DROP COLUMN IF EXISTS search_vector;
ALTER TABLE action DROP COLUMN IF EXISTS search_vector;

-- ---
-- Remove migration record
-- ---
DELETE FROM schema_migrations WHERE migration_id = '002_add_search_vectors';

COMMIT;

-- Rollback completed successfully
-- All search vectors, indexes, triggers, and functions have been removed
-- Core Congressional data remains intact