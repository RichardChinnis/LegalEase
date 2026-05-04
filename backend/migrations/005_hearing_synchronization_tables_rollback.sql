-- PostgreSQL Rollback Migration: Hearing Synchronization Tables
-- Created: 2025-09-07
-- Purpose: Rollback hearing synchronization tables migration
-- Version: 1.0

-- This rollback script removes the hearing synchronization tables:
-- 1. hearing_committee: Associates hearings with committees
-- 2. hearing_format: Stores transcript formats
-- 3. hearing_meeting: Links hearings to associated meetings

BEGIN;

-- Drop triggers
DROP TRIGGER IF EXISTS update_hearing_committee_updated_at ON hearing_committee;
DROP TRIGGER IF EXISTS update_hearing_format_updated_at ON hearing_format;
DROP TRIGGER IF EXISTS update_hearing_meeting_updated_at ON hearing_meeting;

-- Drop tables (order matters due to foreign key constraints)
DROP TABLE IF EXISTS hearing_meeting CASCADE;
DROP TABLE IF EXISTS hearing_format CASCADE; 
DROP TABLE IF EXISTS hearing_committee CASCADE;

-- Remove search vector functionality if it was added by this migration
-- Note: Only remove if the column didn't exist before this migration
DO $$ 
BEGIN
    -- Remove search vector trigger and function if they were created by this migration
    DROP TRIGGER IF EXISTS trigger_hearing_search_vector_update ON hearing;
    
    -- Drop the search vector column if it was added by this migration
    -- (This assumes it was added by this migration - adjust if needed)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'hearing' 
        AND column_name = 'search_vector' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE hearing DROP COLUMN search_vector;
        DROP FUNCTION IF EXISTS update_hearing_search_vector();
    END IF;
END $$;

COMMIT;

-- Rollback complete