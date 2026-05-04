-- Fix bill_cosponsor table - Correct Order of Operations
-- Run as postgres superuser due to sequence ownership requirements

\echo '=============================================='
\echo 'FIXING bill_cosponsor TABLE - CORRECT ORDER'  
\echo '=============================================='
\echo ''

-- Step 1: Add the cosponsor_id column FIRST (without sequence)
\echo '1. Adding cosponsor_id column...'
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS cosponsor_id INTEGER;
\echo '   ✓ cosponsor_id column added'

-- Step 2: Create the sequence  
\echo '2. Creating sequence...'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bill_cosponsor_cosponsor_id_seq') THEN
        CREATE SEQUENCE bill_cosponsor_cosponsor_id_seq OWNED BY bill_cosponsor.cosponsor_id;
        RAISE NOTICE '   ✓ Created cosponsor_id sequence';
    ELSE
        RAISE NOTICE '   ✓ Sequence already exists';
    END IF;
END$$;

-- Step 3: Set column default to use sequence
\echo '3. Setting sequence as default...'
ALTER TABLE bill_cosponsor ALTER COLUMN cosponsor_id SET DEFAULT nextval('bill_cosponsor_cosponsor_id_seq');
\echo '   ✓ Set sequence as default for cosponsor_id'

-- Step 4: Update existing NULL values to get sequence values
\echo '4. Populating existing NULL values...'
UPDATE bill_cosponsor SET cosponsor_id = nextval('bill_cosponsor_cosponsor_id_seq') WHERE cosponsor_id IS NULL;
\echo '   ✓ Populated cosponsor_id for existing records'

-- Step 5: Make it NOT NULL
\echo '5. Setting NOT NULL constraint...'
ALTER TABLE bill_cosponsor ALTER COLUMN cosponsor_id SET NOT NULL;
\echo '   ✓ cosponsor_id set to NOT NULL'

-- Step 6: Update the primary key
\echo '6. Updating primary key...'
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

-- Step 7: Fix congress_sync_writer connection limit as postgres superuser
\echo '7. Fixing connection limit...'
ALTER ROLE congress_sync_writer CONNECTION LIMIT 50;
\echo '   ✓ Increased connection limit for sync user to 50'

-- Step 8: Verification  
\echo ''
\echo '8. VERIFICATION...'

SELECT 'bill_cosponsor columns check:' as info;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'bill_cosponsor' 
  AND column_name IN ('cosponsor_id', 'bioguide_id', 'sponsorship_date')
ORDER BY column_name;

SELECT 'Primary key check:' as info;
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'bill_cosponsor'::regclass 
  AND contype = 'p';

\echo ''
\echo '=============================================='
\echo 'bill_cosponsor FIX COMPLETED!'
\echo '=============================================='