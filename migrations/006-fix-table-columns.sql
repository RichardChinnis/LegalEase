-- Step 6: Fix Table Schema to Match Sync Service Expectations
-- Adds missing columns that the sync service expects but don't exist in current schema
-- Run as congress_admin (table owner)

\echo 'Adding missing columns to match sync service expectations...'

-- Fix bill_cosponsor table - add missing columns
\echo 'Updating bill_cosponsor table...'
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS bioguide_id VARCHAR(10);
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100);
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS party VARCHAR(10);
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS state VARCHAR(2);
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS district INTEGER;
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS sponsorship_date DATE;
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS sponsorship_withdrawn_date DATE;
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE bill_cosponsor ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Copy existing data to new columns where applicable
UPDATE bill_cosponsor SET 
    bioguide_id = member_bioguide_id,
    sponsorship_date = cosponsorship_date,
    sponsorship_withdrawn_date = withdrawn_date
WHERE bioguide_id IS NULL;

-- Fix bill_summary table
\echo 'Updating bill_summary table...'
ALTER TABLE bill_summary ADD COLUMN IF NOT EXISTS update_date TIMESTAMP;
ALTER TABLE bill_summary ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Copy existing data
UPDATE bill_summary SET update_date = api_update_date WHERE update_date IS NULL;

-- Fix bill_title table
\echo 'Updating bill_title table...'
ALTER TABLE bill_title ADD COLUMN IF NOT EXISTS update_date TIMESTAMP;
ALTER TABLE bill_title ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Fix bill_committee_activity table  
\echo 'Updating bill_committee_activity table...'
ALTER TABLE bill_committee_activity ADD COLUMN IF NOT EXISTS committee_name VARCHAR(255);
ALTER TABLE bill_committee_activity ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add missing columns to bill table (from sync service migration)
\echo 'Updating bill table...'
ALTER TABLE bill ADD COLUMN IF NOT EXISTS origin_chamber_code VARCHAR(1);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_type VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_number VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS congress_notes JSONB;

-- Add missing columns to action table
\echo 'Updating action table...'
ALTER TABLE action ADD COLUMN IF NOT EXISTS action_type VARCHAR(50);
ALTER TABLE action ADD COLUMN IF NOT EXISTS committees JSONB;
ALTER TABLE action ADD COLUMN IF NOT EXISTS recorded_votes JSONB;

-- Fix unique constraints to match sync service expectations
\echo 'Fixing unique constraints...'

-- Drop existing constraints if they exist and recreate with correct columns
DO $$
BEGIN
    -- Fix bill_cosponsor unique constraint
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_cosponsor_pkey') THEN
        ALTER TABLE bill_cosponsor DROP CONSTRAINT bill_cosponsor_pkey;
    END IF;
    
    -- Create new unique constraint on (bill_id, bioguide_id) as expected by sync service
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_cosponsor_unique_sync') THEN
        ALTER TABLE bill_cosponsor ADD CONSTRAINT bill_cosponsor_unique_sync UNIQUE(bill_id, bioguide_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Some constraint operations may have failed - this is often normal if constraints already exist';
END$$;

-- Add indexes for performance (matching sync service migration)
\echo 'Adding performance indexes...'
CREATE INDEX IF NOT EXISTS idx_bill_cosponsor_bioguide_sync ON bill_cosponsor(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_bill_summary_created_at ON bill_summary(created_at);
CREATE INDEX IF NOT EXISTS idx_bill_title_created_at ON bill_title(created_at);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at trigger to bill_cosponsor if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_bill_cosponsor_updated_at_sync') THEN
        CREATE TRIGGER update_bill_cosponsor_updated_at_sync
            BEFORE UPDATE ON bill_cosponsor
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END$$;

\echo ''
\echo 'Schema updates completed successfully!'
\echo 'Sync service should now be able to use the database without column errors.'