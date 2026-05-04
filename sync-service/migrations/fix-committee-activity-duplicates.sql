-- Migration: Fix Committee Activity Duplicates
-- Problem: NULL activity_dates allow duplicates due to PostgreSQL NULL != NULL behavior
-- Solution: Use partial unique indexes - PostgreSQL best practice

BEGIN;

-- Step 1: Clean up existing duplicates (keep oldest record for each group)
WITH duplicate_groups AS (
  SELECT bill_id, committee_system_code, activity_name,
         MIN(activity_id) as keep_id
  FROM bill_committee_activity 
  WHERE activity_date IS NULL
  GROUP BY bill_id, committee_system_code, activity_name
  HAVING COUNT(*) > 1
)
DELETE FROM bill_committee_activity 
WHERE activity_date IS NULL 
  AND (bill_id, committee_system_code, activity_name) IN (
    SELECT bill_id, committee_system_code, activity_name 
    FROM duplicate_groups
  )
  AND activity_id NOT IN (SELECT keep_id FROM duplicate_groups);

-- Log cleanup results
DO $$
DECLARE
  rows_deleted INTEGER;
BEGIN
  GET DIAGNOSTICS rows_deleted = ROW_COUNT;
  RAISE NOTICE 'Cleaned up % duplicate committee activity records', rows_deleted;
END $$;

-- Step 2: Drop the existing constraint (if it exists)
ALTER TABLE bill_committee_activity 
DROP CONSTRAINT IF EXISTS bill_committee_activity_bill_id_committee_system_code_key;

-- Step 3: Create partial unique index for activities WITH dates
CREATE UNIQUE INDEX IF NOT EXISTS bill_committee_activity_unique_with_date 
ON bill_committee_activity (bill_id, committee_system_code, activity_name, activity_date)
WHERE activity_date IS NOT NULL;

-- Step 4: Create partial unique index for activities WITHOUT dates  
CREATE UNIQUE INDEX IF NOT EXISTS bill_committee_activity_unique_without_date 
ON bill_committee_activity (bill_id, committee_system_code, activity_name)
WHERE activity_date IS NULL;

-- Step 5: Add monitoring view for data quality
CREATE OR REPLACE VIEW committee_activity_quality_check AS
SELECT 
  COUNT(*) FILTER (WHERE activity_date IS NULL) as activities_without_dates,
  COUNT(*) FILTER (WHERE activity_date IS NOT NULL) as activities_with_dates,
  COUNT(*) as total_activities,
  ROUND((COUNT(*) FILTER (WHERE activity_date IS NULL)::numeric / COUNT(*)::numeric * 100), 2) as null_date_percentage
FROM bill_committee_activity;

-- Verify no duplicates remain
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT bill_id, committee_system_code, activity_name, activity_date
    FROM bill_committee_activity
    GROUP BY bill_id, committee_system_code, activity_name, activity_date
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Duplicates still exist after cleanup: %', duplicate_count;
  ELSE
    RAISE NOTICE 'Success: No duplicates remain in bill_committee_activity table';
  END IF;
END $$;

COMMIT;

-- Post-migration validation query
SELECT 
  'Migration Complete' as status,
  COUNT(*) as total_activities,
  COUNT(DISTINCT (bill_id, committee_system_code, activity_name, activity_date)) as unique_activities
FROM bill_committee_activity;