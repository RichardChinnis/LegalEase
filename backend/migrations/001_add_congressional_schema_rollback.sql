-- Rollback: Remove Congressional Database Schema
-- Description: Safely removes all Congressional tables added by migration 001
-- Created: 2025-08-25
-- WARNING: This will permanently delete all Congressional data!

-- Start transaction for atomic rollback
BEGIN;

-- Check if the migration was actually applied
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = '001_add_congressional_schema') THEN
        RAISE EXCEPTION 'Migration 001_add_congressional_schema was not found - nothing to rollback';
    END IF;
END
$$;

-- Drop triggers first
DO $$
DECLARE
    t_name TEXT;
BEGIN
    FOR t_name IN (
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
        AND table_schema = 'public'
        AND table_name IN ('congress', 'member', 'committee', 'bill', 'committee_report', 'hearing')
    )
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.triggers 
            WHERE trigger_name = 'update_' || t_name || '_updated_at' 
            AND event_object_table = t_name
        ) THEN
            EXECUTE format('DROP TRIGGER update_%s_updated_at ON %I;', t_name, t_name);
        END IF;
    END LOOP;
END;
$$;

-- Drop the update function
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop tables in reverse dependency order (most dependent first)

-- Junction tables first
DROP TABLE IF EXISTS action_committee CASCADE;
DROP TABLE IF EXISTS member_committee CASCADE;
DROP TABLE IF EXISTS bill_committee_activity CASCADE;
DROP TABLE IF EXISTS committee_report_bill CASCADE;
DROP TABLE IF EXISTS bill_cosponsor CASCADE;
DROP TABLE IF EXISTS bill_sponsor CASCADE;

-- Drop tables with foreign key dependencies
DROP TABLE IF EXISTS hearing_date CASCADE;
DROP TABLE IF EXISTS bill_title CASCADE;
DROP TABLE IF EXISTS bill_summary CASCADE;
DROP TABLE IF EXISTS action CASCADE;
DROP TABLE IF EXISTS member_term CASCADE;

-- Drop main tables
DROP TABLE IF EXISTS hearing CASCADE;
DROP TABLE IF EXISTS committee_report CASCADE;
DROP TABLE IF EXISTS bill CASCADE;
DROP TABLE IF EXISTS committee CASCADE;
DROP TABLE IF EXISTS member CASCADE;
DROP TABLE IF EXISTS congress_session CASCADE;
DROP TABLE IF EXISTS congress CASCADE;

-- Drop ENUM types (only if no other tables use them)
DO $$
BEGIN
    DROP TYPE IF EXISTS related_item_type CASCADE;
    DROP TYPE IF EXISTS communication_type_senate CASCADE;
    DROP TYPE IF EXISTS communication_type_house CASCADE;
    DROP TYPE IF EXISTS bill_type CASCADE;
    DROP TYPE IF EXISTS vote_result CASCADE;
    DROP TYPE IF EXISTS chamber CASCADE;
EXCEPTION
    WHEN dependent_objects_still_exist THEN
        RAISE NOTICE 'Some ENUM types are still in use by other tables - keeping them';
END
$$;

-- Remove migration record
DELETE FROM schema_migrations WHERE migration_id = '001_add_congressional_schema';

COMMIT;

-- Rollback completed successfully
SELECT 'Congressional schema rollback completed successfully' AS status;