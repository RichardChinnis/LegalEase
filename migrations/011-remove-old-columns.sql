-- Remove old duplicate columns and constraints from bill_cosponsor
-- This completes the migration to the new schema format

\echo '=============================================='
\echo 'REMOVING OLD DUPLICATE COLUMNS AND CONSTRAINTS'  
\echo '=============================================='
\echo ''

-- Step 1: Copy data from old columns to new columns (if needed)
\echo '1. Ensuring data consistency between old and new columns...'
UPDATE bill_cosponsor SET 
    bioguide_id = member_bioguide_id,
    sponsorship_date = cosponsorship_date,
    sponsorship_withdrawn_date = withdrawn_date
WHERE bioguide_id IS NULL OR sponsorship_date IS NULL;
\echo '   ✓ Data migration completed'

-- Step 2: Drop foreign key constraint on old column
\echo ''
\echo '2. Removing old foreign key constraint...'
ALTER TABLE bill_cosponsor DROP CONSTRAINT IF EXISTS bill_cosponsor_member_bioguide_id_fkey;
\echo '   ✓ Dropped foreign key on member_bioguide_id'

-- Step 3: Drop old indexes
\echo ''
\echo '3. Removing old indexes...'
DROP INDEX IF EXISTS idx_bill_cosponsor_member_bioguide_id;
\echo '   ✓ Dropped old bioguide index'

-- Step 4: Drop old columns
\echo ''
\echo '4. Dropping old duplicate columns...'
ALTER TABLE bill_cosponsor DROP COLUMN IF EXISTS member_bioguide_id;
ALTER TABLE bill_cosponsor DROP COLUMN IF EXISTS cosponsorship_date;  
ALTER TABLE bill_cosponsor DROP COLUMN IF EXISTS withdrawn_date;
\echo '   ✓ Dropped old columns: member_bioguide_id, cosponsorship_date, withdrawn_date'

-- Step 5: Add foreign key constraint on new column
\echo ''
\echo '5. Adding foreign key constraint on new bioguide_id column...'
ALTER TABLE bill_cosponsor ADD CONSTRAINT bill_cosponsor_bioguide_id_fkey 
    FOREIGN KEY (bioguide_id) REFERENCES member(bioguide_id);
\echo '   ✓ Added foreign key on bioguide_id'

-- Step 6: Verification
\echo ''
\echo '6. FINAL VERIFICATION...'

SELECT 'bill_cosponsor final structure:' as info;
\d bill_cosponsor

\echo ''
\echo '=============================================='
\echo 'COLUMN CLEANUP COMPLETED!'
\echo '=============================================='
\echo 'bill_cosponsor now has clean, single-purpose columns'