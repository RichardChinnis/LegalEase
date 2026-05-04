-- Migration: Add report_type_display column to committee_report table
-- Purpose: Store formatted display name for committee reports (e.g., 'H.Rept.') 
--          alongside system code (e.g., 'HRPT') for complete API parity
-- Date: 2025-09-02

BEGIN;

-- Add new column for storing the formatted display name from Congress API reportType field
ALTER TABLE committee_report 
ADD COLUMN report_type_display VARCHAR(50);

-- Add index for performance on the new column
-- This supports efficient filtering and sorting by display type
CREATE INDEX idx_committee_report_type_display 
ON committee_report(report_type_display);

-- Add composite index for congress_id + report_type_display for common query patterns
CREATE INDEX idx_committee_report_congress_type_display 
ON committee_report(congress_id, report_type_display);

-- Update existing test record with correct display value
-- This maps the HRPT system code to 'H.Rept.' display format
UPDATE committee_report 
SET report_type_display = 'H.Rept.'
WHERE report_id = '119-HRPT-213';

-- Add comment to document the column purpose
COMMENT ON COLUMN committee_report.report_type_display IS 'Formatted display name for report type from Congress API reportType field (e.g., H.Rept., S.Rept.)';

COMMIT;