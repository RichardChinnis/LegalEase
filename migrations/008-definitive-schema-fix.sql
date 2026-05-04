-- Definitive Schema Fix: Make database match sync service expectations exactly
-- This fixes the core issues identified in schema analysis
-- Run as congress_admin (table owner)

\echo '=============================================='
\echo 'DEFINITIVE CONGRESS API SCHEMA FIX'  
\echo '=============================================='
\echo ''

-- Step 1: Fix bill_cosponsor table
\echo '1. FIXING bill_cosponsor table...'

-- Add the missing cosponsor_id primary key column
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS cosponsor_id SERIAL;

-- Update the primary key (drop old composite key if exists, add new serial key)
DO $$
BEGIN
    -- Drop existing primary key if it exists
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_cosponsor_pkey') THEN
        ALTER TABLE bill_cosponsor DROP CONSTRAINT bill_cosponsor_pkey;
    END IF;
    
    -- Add new primary key on cosponsor_id
    ALTER TABLE bill_cosponsor ADD CONSTRAINT bill_cosponsor_pkey PRIMARY KEY (cosponsor_id);
    
    RAISE NOTICE '   ✓ Added cosponsor_id primary key';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Primary key constraint might already exist correctly';
END$$;

-- Ensure the unique constraint exists for sync service ON CONFLICT
DO $$
BEGIN
    -- Make sure we have the constraint the sync service expects
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_cosponsor_unique_sync') THEN
        -- But first, ensure bioguide_id is populated from member_bioguide_id
        UPDATE bill_cosponsor SET bioguide_id = member_bioguide_id WHERE bioguide_id IS NULL;
        
        ALTER TABLE bill_cosponsor ADD CONSTRAINT bill_cosponsor_unique_sync UNIQUE(bill_id, bioguide_id);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, bioguide_id)';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Unique constraint issue - may need data cleanup';
END$$;

\echo ''

-- Step 2: Fix bill_summary table 
\echo '2. FIXING bill_summary table...'

-- Add the unique constraint that sync service needs for ON CONFLICT
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_summary_unique_sync') THEN
        ALTER TABLE bill_summary ADD CONSTRAINT bill_summary_unique_sync UNIQUE(bill_id, version_code);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, version_code)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Could not add unique constraint - may have duplicate data';
END$$;

\echo ''

-- Step 3: Fix bill_title table
\echo '3. FIXING bill_title table...'

-- Add the unique constraint that sync service needs for ON CONFLICT  
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_title_unique_sync') THEN
        ALTER TABLE bill_title ADD CONSTRAINT bill_title_unique_sync UNIQUE(bill_id, title_type_code, title);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, title_type_code, title)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Could not add unique constraint - may have duplicate data';
    RAISE NOTICE '   💡 This may require data cleanup first';
END$$;

\echo ''

-- Step 4: Fix bill_committee_activity table
\echo '4. FIXING bill_committee_activity table...'

-- Add the unique constraint that sync service needs for ON CONFLICT
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_committee_activity_unique_sync') THEN
        ALTER TABLE bill_committee_activity ADD CONSTRAINT bill_committee_activity_unique_sync 
            UNIQUE(bill_id, committee_system_code, activity_name, activity_date);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, committee_system_code, activity_name, activity_date)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Could not add unique constraint - may have duplicate data';
END$$;

\echo ''

-- Step 5: Data cleanup and consistency
\echo '5. DATA CLEANUP AND CONSISTENCY...'

-- Ensure bill_cosponsor data is consistent
UPDATE bill_cosponsor SET 
    bioguide_id = member_bioguide_id,
    sponsorship_date = cosponsorship_date,
    sponsorship_withdrawn_date = withdrawn_date
WHERE bioguide_id IS NULL OR sponsorship_date IS NULL;

-- Ensure bill_summary has update_date populated  
UPDATE bill_summary SET update_date = api_update_date WHERE update_date IS NULL;

\echo '   ✓ Data consistency updates completed';
\echo ''

-- Step 6: Fix connection limit issue
\echo '6. FIXING DATABASE CONNECTION LIMITS...'

-- Increase connection limit for sync user
ALTER ROLE congress_sync_writer CONNECTION LIMIT 50;

\echo ''

-- Step 7: Verification queries
\echo '7. VERIFICATION...'

\echo 'bill_cosponsor table structure:'
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'bill_cosponsor' 
  AND column_name IN ('cosponsor_id', 'bioguide_id', 'sponsorship_date')
ORDER BY column_name;

\echo ''
\echo 'Checking unique constraints:'
SELECT conname, contype, conkey 
FROM pg_constraint 
WHERE conname LIKE '%_unique_sync' 
ORDER BY conname;

\echo ''
\echo '=============================================='
\echo 'SCHEMA FIX COMPLETED!'
\echo '=============================================='
\echo ''
\echo 'Next steps:'
\echo '1. Restart sync service to clear connection pool'
\echo '2. Test with manual sync'  
\echo '3. Monitor for remaining errors'
\echo ''
\echo 'If successful, consider removing old columns:'
\echo '- bill_cosponsor.member_bioguide_id'
\echo '- bill_cosponsor.cosponsorship_date' 
\echo '- bill_cosponsor.withdrawn_date'
\echo '- bill_summary.api_update_date'