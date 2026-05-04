-- Migration: Add Congressional Database Schema
-- Description: Adds core Congressional tables for bills, hearings, committee reports, actions, and members
-- Created: 2025-08-25
-- Safe to run: Does not affect existing chat tables

-- Start transaction for atomic migration
BEGIN;

-- Create migrations tracking table if it doesn't exist
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id VARCHAR(255) PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Check if this migration has already been applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = '001_add_congressional_schema') THEN
        RAISE EXCEPTION 'Migration 001_add_congressional_schema has already been applied';
    END IF;
END
$$;

-- ---
-- ENUM Types for consistency
-- ---

DO $$ 
BEGIN
    CREATE TYPE chamber AS ENUM ('House', 'Senate', 'Joint', 'NoChamber');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ 
BEGIN
    CREATE TYPE vote_result AS ENUM ('Passed', 'Failed', 'Agreed to', 'Disagreed to');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ 
BEGIN
    CREATE TYPE bill_type AS ENUM ('hr', 's', 'hres', 'sres', 'hjres', 'sjres', 'hconres', 'sconres');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ 
BEGIN
    CREATE TYPE communication_type_house AS ENUM ('EC', 'PM', 'PT', 'ML');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ 
BEGIN
    CREATE TYPE communication_type_senate AS ENUM ('EC', 'POM', 'PM');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ 
BEGIN
    CREATE TYPE related_item_type AS ENUM ('bill', 'treaty', 'nomination');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---
-- Core Tables
-- ---

CREATE TABLE IF NOT EXISTS congress (
    congress_id INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_year INT,
    end_year INT,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE congress IS 'Stores information about each session of Congress.';

CREATE TABLE IF NOT EXISTS congress_session (
    session_id SERIAL PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    chamber chamber,
    type VARCHAR(1), -- 'R' for Regular, 'S' for Special
    number INT,
    start_date DATE,
    end_date DATE
);
COMMENT ON TABLE congress_session IS 'Stores session-specific data for each Congress.';

CREATE TABLE IF NOT EXISTS member (
    bioguide_id VARCHAR(255) PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    middle_name VARCHAR(255),
    suffix_name VARCHAR(255),
    nickname VARCHAR(255),
    direct_order_name VARCHAR(255),
    inverted_order_name VARCHAR(255),
    honorific_name VARCHAR(255),
    birth_year INT,
    death_year INT,
    current_member BOOLEAN,
    depiction_url TEXT,
    depiction_attribution TEXT,
    official_url TEXT,
    office_address TEXT,
    phone_number VARCHAR(255),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE member IS 'Stores detailed information about members of Congress.';

CREATE TABLE IF NOT EXISTS member_term (
    term_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    congress INT,
    chamber chamber,
    member_type VARCHAR(255),
    start_year INT,
    end_year INT,
    state_code VARCHAR(2),
    state_name VARCHAR(255),
    party_code VARCHAR(10),
    party_name VARCHAR(255),
    district INT
);
COMMENT ON TABLE member_term IS 'Normalized table for member terms of service.';

CREATE TABLE IF NOT EXISTS committee (
    system_code VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    chamber chamber,
    committee_type_code VARCHAR(255),
    is_current BOOLEAN,
    parent_committee_code VARCHAR(255) REFERENCES committee(system_code),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE committee IS 'Stores detailed information about congressional committees.';

-- ---
-- Bill Tables (Core for search)
-- ---

CREATE TABLE IF NOT EXISTS bill (
    bill_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    bill_type bill_type,
    bill_number VARCHAR(255),
    origin_chamber chamber,
    title TEXT,
    introduced_date DATE,
    latest_action_date DATE,
    latest_action_text TEXT,
    policy_area VARCHAR(255),
    constitutional_authority_statement_text TEXT,
    api_update_date TIMESTAMPTZ,
    api_update_date_including_text TIMESTAMPTZ,
    notes JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE bill IS 'Stores comprehensive information about bills and resolutions.';

CREATE TABLE IF NOT EXISTS bill_summary (
    summary_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    version_code VARCHAR(10),
    action_date DATE,
    action_desc TEXT,
    text TEXT,
    api_update_date TIMESTAMPTZ
);
COMMENT ON TABLE bill_summary IS 'Stores bill summaries.';

CREATE TABLE IF NOT EXISTS bill_title (
    title_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    title_type TEXT,
    title TEXT,
    chamber_code VARCHAR(1),
    chamber_name VARCHAR(255),
    bill_text_version_name TEXT,
    bill_text_version_code VARCHAR(10),
    title_type_code VARCHAR(10)
);
COMMENT ON TABLE bill_title IS 'Stores the various titles associated with a bill.';

CREATE TABLE IF NOT EXISTS bill_sponsor (
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    sponsorship_date DATE,
    is_by_request BOOLEAN,
    PRIMARY KEY (bill_id) -- A bill has only one sponsor
);

CREATE TABLE IF NOT EXISTS bill_cosponsor (
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    cosponsorship_date DATE,
    is_original_cosponsor BOOLEAN,
    withdrawn_date DATE,
    PRIMARY KEY (bill_id, member_bioguide_id)
);

-- ---
-- Committee Report Tables (Core for search)
-- ---

CREATE TABLE IF NOT EXISTS committee_report (
    report_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    report_type VARCHAR(255),
    report_number VARCHAR(255),
    citation TEXT,
    part INT,
    is_conference_report BOOLEAN,
    issue_date DATE,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE committee_report IS 'Stores information about committee reports.';

CREATE TABLE IF NOT EXISTS committee_report_bill (
    report_id VARCHAR(255) NOT NULL REFERENCES committee_report(report_id),
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    PRIMARY KEY (report_id, bill_id)
);
COMMENT ON TABLE committee_report_bill IS 'Junction table to link committee reports to bills.';

-- ---
-- Hearing Tables (Core for search)
-- ---

CREATE TABLE IF NOT EXISTS hearing (
    jacket_number VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    chamber chamber,
    number VARCHAR(255),
    part VARCHAR(255),
    title TEXT,
    citation VARCHAR(255),
    library_of_congress_identifier VARCHAR(255),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE hearing IS 'Stores information about committee hearings.';

CREATE TABLE IF NOT EXISTS hearing_date (
    hearing_date_id SERIAL PRIMARY KEY,
    hearing_jacket_number VARCHAR(255) NOT NULL REFERENCES hearing(jacket_number),
    date DATE
);
COMMENT ON TABLE hearing_date IS 'Stores the multiple dates a hearing may have occurred.';

-- ---
-- Action Tables (Core for search)
-- ---

CREATE TABLE IF NOT EXISTS action (
    action_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) REFERENCES bill(bill_id),
    amendment_id VARCHAR(255), -- Will reference amendment table when created
    nomination_id VARCHAR(255), -- Will reference nomination table when created
    treaty_id VARCHAR(255), -- Will reference treaty table when created
    action_date DATE,
    action_time TIME,
    action_code VARCHAR(255),
    text TEXT,
    type VARCHAR(255),
    source_system_code INT,
    source_system_name VARCHAR(255),
    calendar_number VARCHAR(255),
    calendar_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE action IS 'Stores legislative actions.';

CREATE TABLE IF NOT EXISTS bill_committee_activity (
    activity_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    committee_system_code VARCHAR(255) NOT NULL REFERENCES committee(system_code),
    activity_name TEXT,
    activity_date TIMESTAMPTZ
);
COMMENT ON TABLE bill_committee_activity IS 'Stores committee activities related to a bill.';

CREATE TABLE IF NOT EXISTS member_committee (
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    committee_system_code VARCHAR(255) NOT NULL REFERENCES committee(system_code),
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    rank INT,
    title VARCHAR(255),
    PRIMARY KEY (member_bioguide_id, committee_system_code, congress_id)
);

CREATE TABLE IF NOT EXISTS action_committee (
    action_id INT NOT NULL REFERENCES action(action_id),
    committee_system_code VARCHAR(255) NOT NULL REFERENCES committee(system_code),
    PRIMARY KEY (action_id, committee_system_code)
);
COMMENT ON TABLE action_committee IS 'Junction table for committees associated with a legislative action.';

-- ---
-- Indexes for Performance (focused on search use cases)
-- ---

-- Bill search indexes
CREATE INDEX IF NOT EXISTS idx_bill_congress_id ON bill(congress_id);
CREATE INDEX IF NOT EXISTS idx_bill_title_gin ON bill USING GIN(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_bill_policy_area ON bill(policy_area);
CREATE INDEX IF NOT EXISTS idx_bill_latest_action_text_gin ON bill USING GIN(to_tsvector('english', latest_action_text));
CREATE INDEX IF NOT EXISTS idx_bill_type ON bill(bill_type);
CREATE INDEX IF NOT EXISTS idx_bill_introduced_date ON bill(introduced_date);
CREATE INDEX IF NOT EXISTS idx_bill_latest_action_date ON bill(latest_action_date);

-- Bill summary search indexes
CREATE INDEX IF NOT EXISTS idx_bill_summary_text_gin ON bill_summary USING GIN(to_tsvector('english', text));
CREATE INDEX IF NOT EXISTS idx_bill_summary_bill_id ON bill_summary(bill_id);

-- Bill title search indexes
CREATE INDEX IF NOT EXISTS idx_bill_title_text_gin ON bill_title USING GIN(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_bill_title_bill_id ON bill_title(bill_id);

-- Committee report search indexes
CREATE INDEX IF NOT EXISTS idx_committee_report_congress_id ON committee_report(congress_id);
CREATE INDEX IF NOT EXISTS idx_committee_report_citation_gin ON committee_report USING GIN(to_tsvector('english', citation));
CREATE INDEX IF NOT EXISTS idx_committee_report_type ON committee_report(report_type);

-- Hearing search indexes
CREATE INDEX IF NOT EXISTS idx_hearing_congress_id ON hearing(congress_id);
CREATE INDEX IF NOT EXISTS idx_hearing_title_gin ON hearing USING GIN(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_hearing_citation_gin ON hearing USING GIN(to_tsvector('english', citation));
CREATE INDEX IF NOT EXISTS idx_hearing_chamber ON hearing(chamber);

-- Action search indexes
CREATE INDEX IF NOT EXISTS idx_action_bill_id ON action(bill_id);
CREATE INDEX IF NOT EXISTS idx_action_text_gin ON action USING GIN(to_tsvector('english', text));
CREATE INDEX IF NOT EXISTS idx_action_date ON action(action_date);
CREATE INDEX IF NOT EXISTS idx_action_type ON action(type);

-- Member search indexes
CREATE INDEX IF NOT EXISTS idx_member_current ON member(current_member);
CREATE INDEX IF NOT EXISTS idx_member_name_gin ON member USING GIN(to_tsvector('english', first_name || ' ' || COALESCE(last_name, '')));

-- Committee search indexes
CREATE INDEX IF NOT EXISTS idx_committee_name_gin ON committee USING GIN(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_committee_current ON committee(is_current);
CREATE INDEX IF NOT EXISTS idx_committee_chamber ON committee(chamber);

-- Junction table indexes
CREATE INDEX IF NOT EXISTS idx_bill_committee_activity_bill_id ON bill_committee_activity(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_committee_activity_committee_code ON bill_committee_activity(committee_system_code);
CREATE INDEX IF NOT EXISTS idx_member_term_member_id ON member_term(member_bioguide_id);
CREATE INDEX IF NOT EXISTS idx_member_term_congress ON member_term(congress);

-- ---
-- Triggers for automatically updating the updated_at timestamp
-- ---

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers only to tables that have updated_at columns and don't already have the trigger
DO $$
DECLARE
    t_name TEXT;
BEGIN
    FOR t_name IN (
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
        AND table_schema = 'public'
        AND table_name IN ('congress', 'member', 'committee', 'bill', 'committee_report', 'hearing')
    )
    LOOP
        -- Check if trigger already exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.triggers 
            WHERE trigger_name = 'update_' || t_name || '_updated_at' 
            AND event_object_table = t_name
        ) THEN
            EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();', t_name, t_name);
        END IF;
    END LOOP;
END;
$$;

-- Insert some basic Congress data to support foreign key relationships
INSERT INTO congress (congress_id, name, start_year, end_year) 
VALUES 
    (118, '118th Congress', 2023, 2025),
    (117, '117th Congress', 2021, 2023),
    (116, '116th Congress', 2019, 2021)
ON CONFLICT (congress_id) DO NOTHING;

-- Record that this migration has been applied
INSERT INTO schema_migrations (migration_id, description) 
VALUES ('001_add_congressional_schema', 'Add core Congressional tables for bills, hearings, committee reports, actions, and members');

COMMIT;

-- Migration completed successfully