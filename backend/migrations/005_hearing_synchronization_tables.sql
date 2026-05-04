-- PostgreSQL Migration: Hearing Synchronization Tables
-- Created: 2025-09-07
-- Purpose: Add missing tables to support full hearing synchronization from Congress.gov API
-- Version: 1.0

-- This migration adds three key tables to complete hearing data storage:
-- 1. hearing_committee: Associates hearings with committees
-- 2. hearing_format: Stores transcript formats (PDF, Formatted Text, etc.)
-- 3. hearing_meeting: Links hearings to associated meetings

BEGIN;

-- =====================================================================
-- 1. HEARING COMMITTEE ASSOCIATIONS TABLE
-- =====================================================================
-- Stores the relationship between hearings and committees
-- A hearing can be associated with multiple committees (joint hearings)
CREATE TABLE hearing_committee (
    hearing_committee_id SERIAL PRIMARY KEY,
    hearing_jacket_number VARCHAR(255) NOT NULL,
    committee_name TEXT NOT NULL,
    committee_system_code VARCHAR(255),
    committee_api_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Foreign key constraint
    CONSTRAINT fk_hearing_committee_hearing 
        FOREIGN KEY (hearing_jacket_number) 
        REFERENCES hearing(jacket_number) 
        ON DELETE CASCADE,
        
    -- Optional foreign key to committee table if system_code exists
    CONSTRAINT fk_hearing_committee_system_code 
        FOREIGN KEY (committee_system_code) 
        REFERENCES committee(system_code) 
        ON DELETE SET NULL,
        
    -- Prevent duplicate committee associations per hearing
    CONSTRAINT uq_hearing_committee_association 
        UNIQUE (hearing_jacket_number, committee_system_code, committee_name)
);

COMMENT ON TABLE hearing_committee IS 'Associates hearings with congressional committees. Supports both joint hearings and hearings by single committees.';
COMMENT ON COLUMN hearing_committee.committee_name IS 'Full committee name from Congress API (e.g., "Senate Banking, Housing, and Urban Affairs Committee")';
COMMENT ON COLUMN hearing_committee.committee_system_code IS 'Committee system code (e.g., "ssbk00"). May be NULL if not available from API.';
COMMENT ON COLUMN hearing_committee.committee_api_url IS 'Congress.gov API URL for the committee information';

-- =====================================================================
-- 2. HEARING TRANSCRIPT FORMATS TABLE
-- =====================================================================
-- Stores different format versions of hearing transcripts
-- Each hearing can have multiple formats (PDF, Formatted Text, etc.)
CREATE TABLE hearing_format (
    hearing_format_id SERIAL PRIMARY KEY,
    hearing_jacket_number VARCHAR(255) NOT NULL,
    format_type VARCHAR(100) NOT NULL,
    format_url TEXT NOT NULL,
    file_size_bytes BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Foreign key constraint
    CONSTRAINT fk_hearing_format_hearing 
        FOREIGN KEY (hearing_jacket_number) 
        REFERENCES hearing(jacket_number) 
        ON DELETE CASCADE,
        
    -- Prevent duplicate formats per hearing
    CONSTRAINT uq_hearing_format_type 
        UNIQUE (hearing_jacket_number, format_type, format_url)
);

COMMENT ON TABLE hearing_format IS 'Stores different format versions of hearing transcripts and documents.';
COMMENT ON COLUMN hearing_format.format_type IS 'Type of format (e.g., "PDF", "Formatted Text", "HTML")';
COMMENT ON COLUMN hearing_format.format_url IS 'Direct URL to download or access the format';
COMMENT ON COLUMN hearing_format.file_size_bytes IS 'File size in bytes, if available from API response';

-- =====================================================================
-- 3. HEARING MEETING ASSOCIATIONS TABLE
-- =====================================================================
-- Links hearings to their associated committee meetings
-- Note: This table stores meeting event IDs but doesn't require the
-- committee_meeting table to exist (foreign key constraint will be added later)
CREATE TABLE hearing_meeting (
    hearing_meeting_id SERIAL PRIMARY KEY,
    hearing_jacket_number VARCHAR(255) NOT NULL,
    meeting_event_id VARCHAR(255) NOT NULL,
    meeting_api_url TEXT,
    relationship_type VARCHAR(50) DEFAULT 'associated',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Foreign key constraint to hearing table
    CONSTRAINT fk_hearing_meeting_hearing 
        FOREIGN KEY (hearing_jacket_number) 
        REFERENCES hearing(jacket_number) 
        ON DELETE CASCADE,
        
    -- Note: Foreign key to committee_meeting will be added when that table exists
    -- CONSTRAINT fk_hearing_meeting_committee_meeting 
    --     FOREIGN KEY (meeting_event_id) 
    --     REFERENCES committee_meeting(event_id) 
    --     ON DELETE CASCADE,
        
    -- Prevent duplicate associations
    CONSTRAINT uq_hearing_meeting_association 
        UNIQUE (hearing_jacket_number, meeting_event_id)
);

COMMENT ON TABLE hearing_meeting IS 'Links hearings to their associated committee meetings for cross-referencing.';
COMMENT ON COLUMN hearing_meeting.meeting_event_id IS 'Meeting event ID from Congress.gov API (will reference committee_meeting.event_id when that table exists)';
COMMENT ON COLUMN hearing_meeting.meeting_api_url IS 'Congress.gov API URL for the associated meeting';
COMMENT ON COLUMN hearing_meeting.relationship_type IS 'Type of relationship (e.g., "associated", "derived_from")';

-- =====================================================================
-- 4. PERFORMANCE INDEXES
-- =====================================================================

-- Indexes for hearing_committee table
CREATE INDEX idx_hearing_committee_jacket_number 
    ON hearing_committee(hearing_jacket_number);
    
CREATE INDEX idx_hearing_committee_system_code 
    ON hearing_committee(committee_system_code) 
    WHERE committee_system_code IS NOT NULL;
    
CREATE INDEX idx_hearing_committee_name 
    ON hearing_committee USING gin(to_tsvector('english', committee_name));

-- Indexes for hearing_format table  
CREATE INDEX idx_hearing_format_jacket_number 
    ON hearing_format(hearing_jacket_number);
    
CREATE INDEX idx_hearing_format_type 
    ON hearing_format(format_type);

-- Indexes for hearing_meeting table
CREATE INDEX idx_hearing_meeting_jacket_number 
    ON hearing_meeting(hearing_jacket_number);
    
CREATE INDEX idx_hearing_meeting_event_id 
    ON hearing_meeting(meeting_event_id);

-- =====================================================================
-- 5. SEARCH OPTIMIZATION
-- =====================================================================

-- Add search vector to hearing table if not already present
-- This supports full-text search across hearing titles
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'hearing' 
        AND column_name = 'search_vector' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE hearing ADD COLUMN search_vector TSVECTOR;
        
        -- Create index for search vector
        CREATE INDEX idx_hearing_search_vector ON hearing USING gin(search_vector);
        
        -- Create trigger to automatically update search vector
        CREATE OR REPLACE FUNCTION update_hearing_search_vector()
        RETURNS TRIGGER AS $trigger$
        BEGIN
            NEW.search_vector := 
                setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(NEW.citation, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(NEW.number, '')), 'C');
            RETURN NEW;
        END;
        $trigger$ LANGUAGE plpgsql;
        
        CREATE TRIGGER trigger_hearing_search_vector_update
            BEFORE INSERT OR UPDATE ON hearing
            FOR EACH ROW EXECUTE FUNCTION update_hearing_search_vector();
            
        -- Update existing records
        UPDATE hearing SET search_vector = 
            setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
            setweight(to_tsvector('english', COALESCE(citation, '')), 'B') ||
            setweight(to_tsvector('english', COALESCE(number, '')), 'C')
        WHERE search_vector IS NULL;
    END IF;
END $$;

-- =====================================================================
-- 6. UPDATE TRIGGERS FOR TIMESTAMP MANAGEMENT
-- =====================================================================

-- Add update triggers for the new tables
CREATE TRIGGER update_hearing_committee_updated_at 
    BEFORE UPDATE ON hearing_committee 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_hearing_format_updated_at 
    BEFORE UPDATE ON hearing_format 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_hearing_meeting_updated_at 
    BEFORE UPDATE ON hearing_meeting 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================================
-- 7. DATA VALIDATION CONSTRAINTS
-- =====================================================================

-- Ensure format_type contains valid values
ALTER TABLE hearing_format 
ADD CONSTRAINT chk_hearing_format_type 
CHECK (format_type IN ('PDF', 'Formatted Text', 'HTML', 'XML', 'TXT', 'Other'));

-- Ensure format_url is a valid URL format
ALTER TABLE hearing_format 
ADD CONSTRAINT chk_hearing_format_url 
CHECK (format_url ~ '^https?://.*');

-- Ensure meeting API URL is valid if provided
ALTER TABLE hearing_meeting 
ADD CONSTRAINT chk_hearing_meeting_api_url 
CHECK (meeting_api_url IS NULL OR meeting_api_url ~ '^https?://.*');

-- Ensure committee API URL is valid if provided  
ALTER TABLE hearing_committee 
ADD CONSTRAINT chk_hearing_committee_api_url 
CHECK (committee_api_url IS NULL OR committee_api_url ~ '^https?://.*');

-- =====================================================================
-- 8. SECURITY AND PERMISSIONS
-- =====================================================================

-- Grant appropriate permissions to congress_admin user
GRANT SELECT, INSERT, UPDATE, DELETE ON hearing_committee TO congress_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON hearing_format TO congress_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON hearing_meeting TO congress_admin;

-- Grant sequence permissions
GRANT USAGE, SELECT ON SEQUENCE hearing_committee_hearing_committee_id_seq TO congress_admin;
GRANT USAGE, SELECT ON SEQUENCE hearing_format_hearing_format_id_seq TO congress_admin;
GRANT USAGE, SELECT ON SEQUENCE hearing_meeting_hearing_meeting_id_seq TO congress_admin;

COMMIT;

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================
-- This migration adds comprehensive hearing synchronization support by:
-- 1. Creating hearing_committee table for committee associations
-- 2. Creating hearing_format table for transcript formats
-- 3. Creating hearing_meeting table for meeting relationships
-- 4. Adding performance indexes for efficient querying
-- 5. Implementing full-text search capabilities
-- 6. Adding data validation constraints
-- 7. Setting up proper permissions and triggers
-- =====================================================================