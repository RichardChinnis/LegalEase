-- Migration to rename congress_id to congress in bill table
-- This maintains the foreign key relationship while using the more intuitive column name

BEGIN;

-- Drop existing indexes that reference congress_id
DROP INDEX IF EXISTS idx_bill_congress_id;
DROP INDEX IF EXISTS idx_bill_congress_date;
DROP INDEX IF EXISTS idx_bill_congress_policy_area;

-- Drop foreign key constraint
ALTER TABLE bill DROP CONSTRAINT IF EXISTS bill_congress_id_fkey;

-- Rename the column
ALTER TABLE bill RENAME COLUMN congress_id TO congress;

-- Recreate foreign key constraint
ALTER TABLE bill ADD CONSTRAINT bill_congress_fkey 
  FOREIGN KEY (congress) REFERENCES congress(congress_id);

-- Recreate indexes with new column name
CREATE INDEX idx_bill_congress ON bill (congress);
CREATE INDEX idx_bill_congress_date ON bill (congress, introduced_date DESC);
CREATE INDEX idx_bill_congress_policy_area ON bill (congress, policy_area);

COMMIT;