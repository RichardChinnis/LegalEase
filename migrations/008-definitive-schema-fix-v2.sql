-- Definitive Schema Fix v2: Fixed for permission constraints
-- This version works with existing table ownership and permissions
-- Run as postgres superuser

\echo '=============================================='
\echo 'DEFINITIVE CONGRESS API SCHEMA FIX v2'  
\echo '=============================================='
\echo ''

-- Step 1: Fix bill_cosponsor table (need superuser for sequence creation)
\echo '1. FIXING bill_cosponsor table...'

-- Create sequence first (requires superuser)
DO $$
BEGIN
    -- Create sequence if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bill_cosponsor_cosponsor_id_seq') THEN
        CREATE SEQUENCE bill_cosponsor_cosponsor_id_seq OWNED BY bill_cosponsor.cosponsor_id;
        RAISE NOTICE '   ✓ Created cosponsor_id sequence';
    END IF;
END$$;

-- Add the missing cosponsor_id column with sequence default
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS cosponsor_id INTEGER DEFAULT nextval('bill_cosponsor_cosponsor_id_seq');

-- Update existing NULL values to get sequence values
UPDATE bill_cosponsor SET cosponsor_id = nextval('bill_cosponsor_cosponsor_id_seq') WHERE cosponsor_id IS NULL;

-- Make it NOT NULL and set as primary key
ALTER TABLE bill_cosponsor ALTER COLUMN cosponsor_id SET NOT NULL;

-- Update the primary key
DO $$
BEGIN
    -- Drop existing primary key if it exists  
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_cosponsor_pkey') THEN
        ALTER TABLE bill_cosponsor DROP CONSTRAINT bill_cosponsor_pkey;
        RAISE NOTICE '   ✓ Dropped old primary key';
    END IF;
    
    -- Add new primary key on cosponsor_id
    ALTER TABLE bill_cosponsor ADD CONSTRAINT bill_cosponsor_pkey PRIMARY KEY (cosponsor_id);
    RAISE NOTICE '   ✓ Added cosponsor_id primary key';
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Primary key setup issue: %', SQLERRM;
END$$;

-- Ensure the unique constraint exists for sync service ON CONFLICT
DO $$
BEGIN
    -- Make sure we have the constraint the sync service expects
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_cosponsor_unique_sync') THEN
        -- Ensure bioguide_id is populated from member_bioguide_id
        UPDATE bill_cosponsor SET bioguide_id = member_bioguide_id WHERE bioguide_id IS NULL;
        
        -- Remove any potential duplicates first
        DELETE FROM bill_cosponsor a USING bill_cosponsor b 
        WHERE a.cosponsor_id > b.cosponsor_id 
          AND a.bill_id = b.bill_id 
          AND a.bioguide_id = b.bioguide_id;
        
        ALTER TABLE bill_cosponsor ADD CONSTRAINT bill_cosponsor_unique_sync UNIQUE(bill_id, bioguide_id);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, bioguide_id)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Unique constraint issue: %', SQLERRM;
END$$;

\echo ''

-- Step 2: Fix bill_summary table 
\echo '2. FIXING bill_summary table...'

DO $$
BEGIN
    -- Remove duplicates first
    DELETE FROM bill_summary a USING bill_summary b 
    WHERE a.summary_id > b.summary_id 
      AND a.bill_id = b.bill_id 
      AND COALESCE(a.version_code, '') = COALESCE(b.version_code, '');

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_summary_unique_sync') THEN
        ALTER TABLE bill_summary ADD CONSTRAINT bill_summary_unique_sync UNIQUE(bill_id, version_code);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, version_code)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Could not add unique constraint: %', SQLERRM;
END$$;

\echo ''

-- Step 3: Fix bill_title table
\echo '3. FIXING bill_title table...'

DO $$
BEGIN
    -- Remove duplicates first (this is complex due to 3-column unique constraint)
    DELETE FROM bill_title a USING bill_title b 
    WHERE a.title_id > b.title_id 
      AND a.bill_id = b.bill_id 
      AND COALESCE(a.title_type_code, '') = COALESCE(b.title_type_code, '')
      AND COALESCE(a.title, '') = COALESCE(b.title, '');

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_title_unique_sync') THEN
        ALTER TABLE bill_title ADD CONSTRAINT bill_title_unique_sync UNIQUE(bill_id, title_type_code, title);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, title_type_code, title)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Could not add unique constraint: %', SQLERRM;
END$$;

\echo ''

-- Step 4: Fix bill_committee_activity table
\echo '4. FIXING bill_committee_activity table...'

DO $$
BEGIN
    -- Remove duplicates first
    DELETE FROM bill_committee_activity a USING bill_committee_activity b 
    WHERE a.activity_id > b.activity_id 
      AND a.bill_id = b.bill_id 
      AND a.committee_system_code = b.committee_system_code
      AND COALESCE(a.activity_name, '') = COALESCE(b.activity_name, '')
      AND COALESCE(a.activity_date, '1900-01-01'::timestamp) = COALESCE(b.activity_date, '1900-01-01'::timestamp);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_committee_activity_unique_sync') THEN
        ALTER TABLE bill_committee_activity ADD CONSTRAINT bill_committee_activity_unique_sync 
            UNIQUE(bill_id, committee_system_code, activity_name, activity_date);
        RAISE NOTICE '   ✓ Added unique constraint (bill_id, committee_system_code, activity_name, activity_date)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Could not add unique constraint: %', SQLERRM;
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

RAISE NOTICE '   ✓ Data consistency updates completed';

\echo ''

-- Step 6: Fix connection limit issue
\echo '6. FIXING DATABASE CONNECTION LIMITS...'

ALTER ROLE congress_sync_writer CONNECTION LIMIT 50;
RAISE NOTICE '   ✓ Increased connection limit for sync user to 50';

\echo ''

-- Step 7: Verification queries
\echo '7. VERIFICATION...'

SELECT 'bill_cosponsor columns check:' as info;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'bill_cosponsor' 
  AND column_name IN ('cosponsor_id', 'bioguide_id', 'sponsorship_date')
ORDER BY column_name;

SELECT 'Unique constraints check:' as info;
SELECT conname, 'constraint exists' as status
FROM pg_constraint 
WHERE conname LIKE '%_unique_sync' 
ORDER BY conname;

\echo ''
\echo '=============================================='
\echo 'SCHEMA FIX v2 COMPLETED!'
\echo '=============================================='
\echo ''
\echo 'Next steps:'
\echo '1. Restart sync service: sudo systemctl restart congress-sync'
\echo '2. Test with: node manual-sync.js'
\echo '3. Monitor for remaining errors'
\echo ''
\echo 'If successful, old columns can be removed later:'
\echo '- bill_cosponsor.member_bioguide_id'
\echo '- bill_cosponsor.cosponsorship_date' 
\echo '- bill_cosponsor.withdrawn_date'
\echo '- bill_summary.api_update_date'