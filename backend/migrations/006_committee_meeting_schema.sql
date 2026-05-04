-- PostgreSQL Migration: Committee Meeting Tables
-- Created: 2025-12-21
-- Purpose: Add tables to store committee meetings from Congress.gov API
--          with robust linkage to related legislation (bills)
-- Version: 1.0

-- Committee meetings contain real-time scheduling and bill relationships
-- that are NOT available in the /hearing endpoint (which only has transcripts).
-- This data is critical for enriching Legislative History in the bill detail view.

BEGIN;

-- =====================================================================
-- 1. MAIN COMMITTEE MEETING TABLE
-- =====================================================================
-- Stores the core committee meeting information
-- Each meeting is uniquely identified by (congress_id, chamber, event_id)
CREATE TABLE IF NOT EXISTS committee_meeting (
    meeting_id SERIAL PRIMARY KEY,

    -- Unique identifiers from Congress API
    event_id VARCHAR(50) NOT NULL,
    congress_id INTEGER NOT NULL,
    chamber chamber NOT NULL,

    -- Meeting details (discrete fields, no JSON)
    title TEXT,
    meeting_date TIMESTAMPTZ,
    meeting_type VARCHAR(50),         -- e.g., "Meeting", "Hearing", "Markup"
    meeting_status VARCHAR(50),       -- e.g., "Scheduled", "Held", "Cancelled"

    -- Location (discrete fields)
    location_building VARCHAR(255),   -- e.g., "Russell Senate Office Building"
    location_room VARCHAR(100),       -- e.g., "418"

    -- API metadata
    api_update_date TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Full-text search support
    search_vector TSVECTOR,

    -- Unique constraint for upsert operations
    CONSTRAINT uq_committee_meeting_event
        UNIQUE (congress_id, chamber, event_id)
);

COMMENT ON TABLE committee_meeting IS 'Stores committee meetings from Congress.gov API with real-time scheduling and bill relationships.';
COMMENT ON COLUMN committee_meeting.event_id IS 'Unique event ID from Congress.gov (e.g., "336701")';
COMMENT ON COLUMN committee_meeting.meeting_type IS 'Type of meeting: Meeting, Hearing, Markup, etc.';
COMMENT ON COLUMN committee_meeting.meeting_status IS 'Status: Scheduled, Held, Cancelled, Postponed';

-- =====================================================================
-- 2. COMMITTEE MEETING BILLS JUNCTION TABLE (KEY FOR BILL LINKAGE)
-- =====================================================================
-- This is the critical table that links meetings to legislation
-- Used to enrich Legislative History with hearing/meeting references
CREATE TABLE IF NOT EXISTS committee_meeting_bill (
    committee_meeting_bill_id SERIAL PRIMARY KEY,

    meeting_id INTEGER NOT NULL,

    -- Store bill reference info (for robust matching)
    congress INTEGER NOT NULL,
    bill_type VARCHAR(20) NOT NULL,   -- e.g., "S", "HR", "HJRES"
    bill_number VARCHAR(20) NOT NULL, -- e.g., "607"

    -- Computed bill_id for FK (matches bill table format: "119-S-607")
    bill_id VARCHAR(50) GENERATED ALWAYS AS (
        congress::TEXT || '-' || UPPER(bill_type) || '-' || bill_number
    ) STORED,

    -- API URL for the bill (backup reference)
    bill_api_url TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign key to committee_meeting
    CONSTRAINT fk_committee_meeting_bill_meeting
        FOREIGN KEY (meeting_id)
        REFERENCES committee_meeting(meeting_id)
        ON DELETE CASCADE,

    -- Note: We don't enforce FK to bill table because meetings can reference
    -- bills we haven't synced yet. The bill_id is computed for easy joining.

    -- Prevent duplicate bill associations per meeting
    CONSTRAINT uq_committee_meeting_bill_association
        UNIQUE (meeting_id, congress, bill_type, bill_number)
);

COMMENT ON TABLE committee_meeting_bill IS 'Links committee meetings to related legislation. Critical for enriching bill Legislative History.';
COMMENT ON COLUMN committee_meeting_bill.bill_id IS 'Computed bill ID matching bill table format (e.g., "119-S-607") for easy JOINs';

-- Create index on bill_id for fast lookups from bill detail view
CREATE INDEX IF NOT EXISTS idx_committee_meeting_bill_bill_id
    ON committee_meeting_bill(bill_id);

-- =====================================================================
-- 3. COMMITTEE MEETING COMMITTEES TABLE
-- =====================================================================
-- A meeting can be held by multiple committees (joint meetings)
CREATE TABLE IF NOT EXISTS committee_meeting_committee (
    committee_meeting_committee_id SERIAL PRIMARY KEY,

    meeting_id INTEGER NOT NULL,

    -- Committee info (discrete fields)
    committee_name TEXT NOT NULL,
    committee_system_code VARCHAR(50),
    committee_api_url TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign key to committee_meeting
    CONSTRAINT fk_committee_meeting_committee_meeting
        FOREIGN KEY (meeting_id)
        REFERENCES committee_meeting(meeting_id)
        ON DELETE CASCADE,

    -- Optional foreign key to committee table
    CONSTRAINT fk_committee_meeting_committee_code
        FOREIGN KEY (committee_system_code)
        REFERENCES committee(system_code)
        ON DELETE SET NULL,

    -- Prevent duplicate committee associations per meeting
    CONSTRAINT uq_committee_meeting_committee_association
        UNIQUE (meeting_id, committee_system_code)
);

COMMENT ON TABLE committee_meeting_committee IS 'Links committee meetings to committees. Supports joint committee meetings.';

-- =====================================================================
-- 4. COMMITTEE MEETING DOCUMENTS TABLE
-- =====================================================================
-- Stores documents associated with the meeting (bills, reports, etc.)
CREATE TABLE IF NOT EXISTS committee_meeting_document (
    committee_meeting_document_id SERIAL PRIMARY KEY,

    meeting_id INTEGER NOT NULL,

    -- Document info (discrete fields)
    document_type VARCHAR(100) NOT NULL,  -- e.g., "Bills and Resolutions", "Committee Reports"
    description TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign key to committee_meeting
    CONSTRAINT fk_committee_meeting_document_meeting
        FOREIGN KEY (meeting_id)
        REFERENCES committee_meeting(meeting_id)
        ON DELETE CASCADE,

    -- Prevent exact duplicates
    CONSTRAINT uq_committee_meeting_document
        UNIQUE (meeting_id, document_type, description)
);

COMMENT ON TABLE committee_meeting_document IS 'Stores documents associated with committee meetings.';

-- =====================================================================
-- 5. COMMITTEE MEETING VIDEOS TABLE
-- =====================================================================
-- Stores video links for the meeting (webcast, archive, etc.)
CREATE TABLE IF NOT EXISTS committee_meeting_video (
    committee_meeting_video_id SERIAL PRIMARY KEY,

    meeting_id INTEGER NOT NULL,

    -- Video info (discrete fields)
    video_name TEXT,
    video_url TEXT NOT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign key to committee_meeting
    CONSTRAINT fk_committee_meeting_video_meeting
        FOREIGN KEY (meeting_id)
        REFERENCES committee_meeting(meeting_id)
        ON DELETE CASCADE,

    -- Prevent duplicate video URLs per meeting
    CONSTRAINT uq_committee_meeting_video_url
        UNIQUE (meeting_id, video_url)
);

COMMENT ON TABLE committee_meeting_video IS 'Stores video/webcast links for committee meetings.';

-- =====================================================================
-- 6. PERFORMANCE INDEXES
-- =====================================================================

-- Main table indexes
CREATE INDEX IF NOT EXISTS idx_committee_meeting_congress_chamber
    ON committee_meeting(congress_id, chamber);

CREATE INDEX IF NOT EXISTS idx_committee_meeting_date
    ON committee_meeting(meeting_date DESC);

CREATE INDEX IF NOT EXISTS idx_committee_meeting_event_id
    ON committee_meeting(event_id);

CREATE INDEX IF NOT EXISTS idx_committee_meeting_api_update_date
    ON committee_meeting(api_update_date DESC);

-- Bill junction table indexes (critical for bill detail queries)
CREATE INDEX IF NOT EXISTS idx_committee_meeting_bill_meeting_id
    ON committee_meeting_bill(meeting_id);

CREATE INDEX IF NOT EXISTS idx_committee_meeting_bill_congress_type_number
    ON committee_meeting_bill(congress, bill_type, bill_number);

-- Committee junction table indexes
CREATE INDEX IF NOT EXISTS idx_committee_meeting_committee_meeting_id
    ON committee_meeting_committee(meeting_id);

CREATE INDEX IF NOT EXISTS idx_committee_meeting_committee_system_code
    ON committee_meeting_committee(committee_system_code)
    WHERE committee_system_code IS NOT NULL;

-- Document and video indexes
CREATE INDEX IF NOT EXISTS idx_committee_meeting_document_meeting_id
    ON committee_meeting_document(meeting_id);

CREATE INDEX IF NOT EXISTS idx_committee_meeting_video_meeting_id
    ON committee_meeting_video(meeting_id);

-- =====================================================================
-- 7. FULL-TEXT SEARCH SUPPORT
-- =====================================================================

-- Create search vector index
CREATE INDEX IF NOT EXISTS idx_committee_meeting_search_vector
    ON committee_meeting USING gin(search_vector);

-- Create trigger function for search vector
CREATE OR REPLACE FUNCTION update_committee_meeting_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.meeting_type, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.location_building, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic search vector updates
DROP TRIGGER IF EXISTS trigger_committee_meeting_search_vector_update ON committee_meeting;
CREATE TRIGGER trigger_committee_meeting_search_vector_update
    BEFORE INSERT OR UPDATE ON committee_meeting
    FOR EACH ROW EXECUTE FUNCTION update_committee_meeting_search_vector();

-- =====================================================================
-- 8. UPDATE TIMESTAMP TRIGGERS
-- =====================================================================

-- Main table
DROP TRIGGER IF EXISTS update_committee_meeting_updated_at ON committee_meeting;
CREATE TRIGGER update_committee_meeting_updated_at
    BEFORE UPDATE ON committee_meeting
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Bill junction table
DROP TRIGGER IF EXISTS update_committee_meeting_bill_updated_at ON committee_meeting_bill;
CREATE TRIGGER update_committee_meeting_bill_updated_at
    BEFORE UPDATE ON committee_meeting_bill
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Committee junction table
DROP TRIGGER IF EXISTS update_committee_meeting_committee_updated_at ON committee_meeting_committee;
CREATE TRIGGER update_committee_meeting_committee_updated_at
    BEFORE UPDATE ON committee_meeting_committee
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Document table
DROP TRIGGER IF EXISTS update_committee_meeting_document_updated_at ON committee_meeting_document;
CREATE TRIGGER update_committee_meeting_document_updated_at
    BEFORE UPDATE ON committee_meeting_document
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Video table
DROP TRIGGER IF EXISTS update_committee_meeting_video_updated_at ON committee_meeting_video;
CREATE TRIGGER update_committee_meeting_video_updated_at
    BEFORE UPDATE ON committee_meeting_video
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================================
-- 9. SECURITY AND PERMISSIONS
-- =====================================================================

-- Grant permissions to congress_admin user
GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting TO congress_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_bill TO congress_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_committee TO congress_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_document TO congress_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_video TO congress_admin;

-- Grant sequence permissions
GRANT USAGE, SELECT ON SEQUENCE committee_meeting_meeting_id_seq TO congress_admin;
GRANT USAGE, SELECT ON SEQUENCE committee_meeting_bill_committee_meeting_bill_id_seq TO congress_admin;
GRANT USAGE, SELECT ON SEQUENCE committee_meeting_committee_committee_meeting_committee_id_seq TO congress_admin;
GRANT USAGE, SELECT ON SEQUENCE committee_meeting_document_committee_meeting_document_id_seq TO congress_admin;
GRANT USAGE, SELECT ON SEQUENCE committee_meeting_video_committee_meeting_video_id_seq TO congress_admin;

-- Grant permissions to sync user if exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'congress_sync_writer') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting TO congress_sync_writer;
        GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_bill TO congress_sync_writer;
        GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_committee TO congress_sync_writer;
        GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_document TO congress_sync_writer;
        GRANT SELECT, INSERT, UPDATE, DELETE ON committee_meeting_video TO congress_sync_writer;
        GRANT USAGE, SELECT ON SEQUENCE committee_meeting_meeting_id_seq TO congress_sync_writer;
        GRANT USAGE, SELECT ON SEQUENCE committee_meeting_bill_committee_meeting_bill_id_seq TO congress_sync_writer;
        GRANT USAGE, SELECT ON SEQUENCE committee_meeting_committee_committee_meeting_committee_id_seq TO congress_sync_writer;
        GRANT USAGE, SELECT ON SEQUENCE committee_meeting_document_committee_meeting_document_id_seq TO congress_sync_writer;
        GRANT USAGE, SELECT ON SEQUENCE committee_meeting_video_committee_meeting_video_id_seq TO congress_sync_writer;
    END IF;
END $$;

COMMIT;

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================
-- This migration adds comprehensive committee meeting support by:
-- 1. Creating committee_meeting table for core meeting data
-- 2. Creating committee_meeting_bill junction for bill linkage (KEY!)
-- 3. Creating committee_meeting_committee for committee associations
-- 4. Creating committee_meeting_document for meeting documents
-- 5. Creating committee_meeting_video for video/webcast links
-- 6. Adding performance indexes, especially for bill lookups
-- 7. Implementing full-text search capabilities
-- 8. Setting up proper permissions and triggers
--
-- USAGE: To find meetings for a bill:
--   SELECT cm.* FROM committee_meeting cm
--   JOIN committee_meeting_bill cmb ON cm.meeting_id = cmb.meeting_id
--   WHERE cmb.bill_id = '119-S-607';
-- =====================================================================
