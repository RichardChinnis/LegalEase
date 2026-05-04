-- Add unique constraint for member terms to prevent duplicate entries

\echo '=============================================='
\echo 'ADDING MEMBER TERM UNIQUE CONSTRAINTS'  
\echo '=============================================='
\echo ''

-- Step 1: Remove any existing duplicate member terms
\echo '1. Checking for and removing duplicate member terms...'
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    -- Find duplicates
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT member_bioguide_id, congress, chamber, COUNT(*)
        FROM member_term 
        GROUP BY member_bioguide_id, congress, chamber
        HAVING COUNT(*) > 1
    ) dupes;
    
    IF duplicate_count > 0 THEN
        -- Remove duplicates, keeping the first one (lowest term_id)
        DELETE FROM member_term a USING member_term b 
        WHERE a.term_id > b.term_id 
          AND a.member_bioguide_id = b.member_bioguide_id 
          AND a.congress = b.congress 
          AND COALESCE(a.chamber::text, '') = COALESCE(b.chamber::text, '');
        
        RAISE NOTICE '   ✓ Removed % duplicate member terms', duplicate_count;
    ELSE
        RAISE NOTICE '   ✓ No duplicate member terms found';
    END IF;
END$$;

-- Step 2: Add the unique constraint
\echo ''
\echo '2. Adding unique constraint for member terms...'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_member_term') THEN
        ALTER TABLE member_term 
        ADD CONSTRAINT unique_member_term 
        UNIQUE (member_bioguide_id, congress, chamber);
        RAISE NOTICE '   ✓ Added unique constraint (member_bioguide_id, congress, chamber)';
    ELSE
        RAISE NOTICE '   ✓ Unique constraint already exists';
    END IF;
END$$;

-- Step 3: Add useful indexes for member queries
\echo ''
\echo '3. Adding performance indexes...'

-- Index for state lookups
CREATE INDEX IF NOT EXISTS idx_member_term_state 
    ON member_term(state_code);
\echo '   ✓ Created index for state lookups'

-- Index for party lookups  
CREATE INDEX IF NOT EXISTS idx_member_term_party 
    ON member_term(party_code);
\echo '   ✓ Created index for party lookups'

-- Index for chamber queries
CREATE INDEX IF NOT EXISTS idx_member_term_chamber 
    ON member_term(chamber);
\echo '   ✓ Created index for chamber lookups'

-- Composite index for congress/state queries
CREATE INDEX IF NOT EXISTS idx_member_term_congress_state 
    ON member_term(congress, state_code);
\echo '   ✓ Created composite index for congress/state queries'

-- Step 4: Verification
\echo ''
\echo '4. VERIFICATION...'

SELECT 'Member term constraints:' as info;
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'member_term'::regclass 
  AND contype = 'u';

SELECT 'Member term indexes:' as info;
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'member_term' 
  AND indexname LIKE 'idx_member_term_%'
ORDER BY indexname;

\echo ''
\echo '=============================================='
\echo 'MEMBER TERM CONSTRAINTS COMPLETED!'
\echo '=============================================='
\echo 'member_term table is now ready for sync operations'