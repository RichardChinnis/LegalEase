-- Migration 001: Full Bill Details Schema
-- This migration adds support for comprehensive bill details storage

-- Phase 1: Update existing tables
ALTER TABLE bill ADD COLUMN IF NOT EXISTS origin_chamber_code VARCHAR(1);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_type VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_number VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS congress_notes JSONB;

ALTER TABLE action ADD COLUMN IF NOT EXISTS action_type VARCHAR(50);
ALTER TABLE action ADD COLUMN IF NOT EXISTS committees JSONB;
ALTER TABLE action ADD COLUMN IF NOT EXISTS recorded_votes JSONB;

-- Phase 2: Create new tables for bill relationships

-- Bill cosponsors table
CREATE TABLE IF NOT EXISTS bill_cosponsor (
  cosponsor_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  bioguide_id VARCHAR(10) NOT NULL,
  full_name VARCHAR(255),
  first_name VARCHAR(100),
  middle_name VARCHAR(100),
  last_name VARCHAR(100),
  party VARCHAR(10),
  state VARCHAR(2),
  district INTEGER,
  sponsorship_date DATE,
  is_original_cosponsor BOOLEAN DEFAULT FALSE,
  sponsorship_withdrawn_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, bioguide_id)
);

-- Bill summaries table
CREATE TABLE IF NOT EXISTS bill_summary (
  summary_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  version_code VARCHAR(10),
  action_date DATE,
  action_desc VARCHAR(255),
  update_date TIMESTAMP,
  text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, version_code)
);

-- Bill titles table
CREATE TABLE IF NOT EXISTS bill_title (
  title_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  title_type VARCHAR(100),
  title_type_code INTEGER,
  title TEXT NOT NULL,
  chamber_code VARCHAR(1),
  chamber_name VARCHAR(10),
  bill_text_version_name VARCHAR(100),
  bill_text_version_code VARCHAR(10),
  update_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, title_type_code, title)
);

-- Bill amendments table
CREATE TABLE IF NOT EXISTS bill_amendment (
  amendment_id VARCHAR(30) PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  amendment_number INTEGER,
  congress INTEGER,
  type VARCHAR(10),
  description TEXT,
  purpose TEXT,
  latest_action_date DATE,
  latest_action_text TEXT,
  latest_action_time TIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bill text versions table
CREATE TABLE IF NOT EXISTS bill_text_version (
  text_version_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  version_type VARCHAR(100),
  version_date TIMESTAMP,
  formats JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, version_type, version_date)
);

-- Bill related bills table
CREATE TABLE IF NOT EXISTS bill_related (
  related_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  related_bill_id VARCHAR(20),
  related_bill_congress INTEGER,
  related_bill_type VARCHAR(10),
  related_bill_number INTEGER,
  related_bill_title TEXT,
  relationship_type VARCHAR(100),
  identified_by VARCHAR(10),
  latest_action_date DATE,
  latest_action_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, related_bill_id, relationship_type)
);

-- Bill committee reports table
CREATE TABLE IF NOT EXISTS bill_committee_report (
  report_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  citation VARCHAR(100),
  url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, citation)
);

-- Bill CBO estimates table
CREATE TABLE IF NOT EXISTS bill_cbo_estimate (
  estimate_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  pub_date TIMESTAMP,
  title TEXT,
  url TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, pub_date, title)
);

-- Bill committee activities table
CREATE TABLE IF NOT EXISTS bill_committee_activity (
  activity_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  committee_system_code VARCHAR(20),
  committee_name VARCHAR(255),
  activity_name VARCHAR(100),
  activity_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, committee_system_code, activity_name, activity_date)
);

-- Phase 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_bill_cosponsor_bill_id ON bill_cosponsor(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_cosponsor_bioguide_id ON bill_cosponsor(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_bill_summary_bill_id ON bill_summary(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_title_bill_id ON bill_title(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_amendment_bill_id ON bill_amendment(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_text_version_bill_id ON bill_text_version(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_related_bill_id ON bill_related(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_committee_report_bill_id ON bill_committee_report(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_cbo_estimate_bill_id ON bill_cbo_estimate(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_committee_activity_bill_id ON bill_committee_activity(bill_id);

-- Phase 4: Create updated_at triggers for tables with update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for tables with updated_at columns
DROP TRIGGER IF EXISTS update_bill_cosponsor_updated_at ON bill_cosponsor;
CREATE TRIGGER update_bill_cosponsor_updated_at
    BEFORE UPDATE ON bill_cosponsor
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bill_amendment_updated_at ON bill_amendment;
CREATE TRIGGER update_bill_amendment_updated_at
    BEFORE UPDATE ON bill_amendment
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();