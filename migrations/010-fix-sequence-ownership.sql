-- Fix sequence ownership and default value for bill_cosponsor.cosponsor_id
-- Must run as postgres superuser to manage ownership properly

\echo '=============================================='
\echo 'FIXING SEQUENCE OWNERSHIP AND DEFAULT VALUE'  
\echo '=============================================='
\echo ''

-- Step 1: Check current table ownership
\echo '1. Checking table ownership...'
SELECT 'bill_cosponsor table owner:' as info, tableowner 
FROM pg_tables 
WHERE tablename = 'bill_cosponsor';

-- Step 2: Create sequence with matching ownership
\echo ''
\echo '2. Creating sequence with correct ownership...'
DO $$
DECLARE
    table_owner TEXT;
BEGIN
    -- Get the table owner
    SELECT tableowner INTO table_owner 
    FROM pg_tables 
    WHERE tablename = 'bill_cosponsor';
    
    RAISE NOTICE '   Table owner is: %', table_owner;
    
    -- Drop existing sequence if it exists
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bill_cosponsor_cosponsor_id_seq') THEN
        DROP SEQUENCE bill_cosponsor_cosponsor_id_seq;
        RAISE NOTICE '   ✓ Dropped existing sequence';
    END IF;
    
    -- Create sequence as superuser first
    CREATE SEQUENCE bill_cosponsor_cosponsor_id_seq;
    
    -- Set the ownership to match the table
    EXECUTE format('ALTER SEQUENCE bill_cosponsor_cosponsor_id_seq OWNER TO %I', table_owner);
    RAISE NOTICE '   ✓ Created sequence with owner: %', table_owner;
    
    -- Now set the OWNED BY relationship
    ALTER SEQUENCE bill_cosponsor_cosponsor_id_seq OWNED BY bill_cosponsor.cosponsor_id;
    RAISE NOTICE '   ✓ Set OWNED BY relationship';
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   ⚠ Sequence creation issue: %', SQLERRM;
END$$;

-- Step 3: Set the default value
\echo ''
\echo '3. Setting default value...'
ALTER TABLE bill_cosponsor ALTER COLUMN cosponsor_id SET DEFAULT nextval('bill_cosponsor_cosponsor_id_seq');
\echo '   ✓ Set sequence as default for cosponsor_id'

-- Step 4: Update existing NULL values (if any)  
\echo ''
\echo '4. Updating any NULL cosponsor_id values...'
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count FROM bill_cosponsor WHERE cosponsor_id IS NULL;
    
    IF null_count > 0 THEN
        UPDATE bill_cosponsor SET cosponsor_id = nextval('bill_cosponsor_cosponsor_id_seq') WHERE cosponsor_id IS NULL;
        RAISE NOTICE '   ✓ Updated % NULL cosponsor_id values', null_count;
    ELSE
        RAISE NOTICE '   ✓ No NULL cosponsor_id values found';
    END IF;
END$$;

-- Step 5: Set sequence to current max value to avoid conflicts
\echo ''
\echo '5. Synchronizing sequence with existing data...'
DO $$
DECLARE
    max_id INTEGER;
BEGIN
    SELECT COALESCE(MAX(cosponsor_id), 0) INTO max_id FROM bill_cosponsor;
    PERFORM setval('bill_cosponsor_cosponsor_id_seq', max_id);
    RAISE NOTICE '   ✓ Set sequence to start at %', max_id + 1;
END$$;

-- Step 6: Final verification
\echo ''
\echo '6. FINAL VERIFICATION...'

SELECT 'Sequence info:' as info;
SELECT 
    schemaname,
    sequencename, 
    sequenceowner,
    last_value
FROM pg_sequences 
WHERE sequencename = 'bill_cosponsor_cosponsor_id_seq';

SELECT 'Column with default:' as info;
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'bill_cosponsor' 
  AND column_name = 'cosponsor_id';

\echo ''
\echo '=============================================='
\echo 'SEQUENCE FIX COMPLETED!'
\echo '=============================================='
\echo 'bill_cosponsor table is now ready for sync service'