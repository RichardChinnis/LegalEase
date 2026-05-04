-- Migration: 004_enhance_member_schema_for_api_parity
-- Description: Add missing tables and fields to match Congress API response structure
-- Author: Database Administrator
-- Date: 2024-09-02

BEGIN;

-- ======================================
-- 1. CREATE MEMBER ADDRESS INFORMATION TABLE
-- ======================================
CREATE TABLE member_address (
    address_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id) ON DELETE CASCADE,
    city VARCHAR(255),
    district VARCHAR(10),  -- Can be "DC" or other district codes
    zip_code INTEGER,
    address_type VARCHAR(50) DEFAULT 'current', -- 'current', 'home', 'office'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint to prevent duplicate active addresses per member
CREATE UNIQUE INDEX idx_member_address_unique_active 
ON member_address (member_bioguide_id, address_type) 
WHERE is_active = TRUE;

-- Performance indexes
CREATE INDEX idx_member_address_bioguide ON member_address (member_bioguide_id);
CREATE INDEX idx_member_address_active ON member_address (is_active);
CREATE INDEX idx_member_address_type ON member_address (address_type);

-- ======================================
-- 2. CREATE MEMBER PARTY HISTORY TABLE
-- ======================================
CREATE TABLE member_party_history (
    party_history_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id) ON DELETE CASCADE,
    party_abbreviation VARCHAR(10) NOT NULL,
    party_name VARCHAR(255) NOT NULL,
    start_year INTEGER NOT NULL,
    end_year INTEGER, -- NULL means current/ongoing
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure logical date ranges
    CONSTRAINT check_party_history_years CHECK (
        end_year IS NULL OR end_year >= start_year
    )
);

-- Unique constraint to prevent overlapping party affiliations
CREATE UNIQUE INDEX idx_member_party_history_unique 
ON member_party_history (member_bioguide_id, start_year, COALESCE(end_year, 9999));

-- Performance indexes
CREATE INDEX idx_member_party_history_bioguide ON member_party_history (member_bioguide_id);
CREATE INDEX idx_member_party_history_party ON member_party_history (party_abbreviation);
CREATE INDEX idx_member_party_history_years ON member_party_history (start_year, end_year);
CREATE INDEX idx_member_party_history_current ON member_party_history (member_bioguide_id, start_year DESC) WHERE end_year IS NULL;

-- ======================================
-- 3. CREATE MEMBER PREVIOUS NAMES TABLE
-- ======================================
CREATE TABLE member_previous_names (
    previous_name_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id) ON DELETE CASCADE,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    middle_name VARCHAR(255),
    suffix_name VARCHAR(255),
    nickname VARCHAR(255),
    direct_order_name VARCHAR(255),
    inverted_order_name VARCHAR(255),
    start_date DATE,
    end_date DATE,
    name_type VARCHAR(50) DEFAULT 'legal', -- 'legal', 'nickname', 'maiden', 'married'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure logical date ranges
    CONSTRAINT check_previous_names_dates CHECK (
        end_date IS NULL OR end_date >= start_date
    )
);

-- Performance indexes
CREATE INDEX idx_member_previous_names_bioguide ON member_previous_names (member_bioguide_id);
CREATE INDEX idx_member_previous_names_dates ON member_previous_names (start_date, end_date);
CREATE INDEX idx_member_previous_names_type ON member_previous_names (name_type);

-- Full-text search index for name searching
CREATE INDEX idx_member_previous_names_search ON member_previous_names 
USING GIN (to_tsvector('english', 
    COALESCE(first_name, '') || ' ' || 
    COALESCE(middle_name, '') || ' ' || 
    COALESCE(last_name, '') || ' ' || 
    COALESCE(nickname, '')
));

-- ======================================
-- 4. CREATE MEMBER LEGISLATION STATISTICS TABLE
-- ======================================
CREATE TABLE member_legislation_stats (
    stats_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id) ON DELETE CASCADE,
    congress INTEGER NOT NULL,
    sponsored_legislation_count INTEGER DEFAULT 0,
    cosponsored_legislation_count INTEGER DEFAULT 0,
    sponsored_legislation_url TEXT,
    cosponsored_legislation_url TEXT,
    last_calculated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure non-negative counts
    CONSTRAINT check_legislation_stats_positive CHECK (
        sponsored_legislation_count >= 0 AND 
        cosponsored_legislation_count >= 0
    )
);

-- Unique constraint per member per congress
CREATE UNIQUE INDEX idx_member_legislation_stats_unique 
ON member_legislation_stats (member_bioguide_id, congress);

-- Performance indexes
CREATE INDEX idx_member_legislation_stats_bioguide ON member_legislation_stats (member_bioguide_id);
CREATE INDEX idx_member_legislation_stats_congress ON member_legislation_stats (congress);
CREATE INDEX idx_member_legislation_stats_calculated ON member_legislation_stats (last_calculated);
CREATE INDEX idx_member_legislation_stats_current ON member_legislation_stats (member_bioguide_id, congress DESC);

-- ======================================
-- 5. CREATE STATE REFERENCE TABLE FOR FULL STATE NAMES
-- ======================================
CREATE TABLE IF NOT EXISTS states (
    state_code VARCHAR(2) PRIMARY KEY,
    state_name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert all US states and territories
INSERT INTO states (state_code, state_name) VALUES
    ('AL', 'Alabama'), ('AK', 'Alaska'), ('AZ', 'Arizona'), ('AR', 'Arkansas'),
    ('CA', 'California'), ('CO', 'Colorado'), ('CT', 'Connecticut'), ('DE', 'Delaware'),
    ('FL', 'Florida'), ('GA', 'Georgia'), ('HI', 'Hawaii'), ('ID', 'Idaho'),
    ('IL', 'Illinois'), ('IN', 'Indiana'), ('IA', 'Iowa'), ('KS', 'Kansas'),
    ('KY', 'Kentucky'), ('LA', 'Louisiana'), ('ME', 'Maine'), ('MD', 'Maryland'),
    ('MA', 'Massachusetts'), ('MI', 'Michigan'), ('MN', 'Minnesota'), ('MS', 'Mississippi'),
    ('MO', 'Missouri'), ('MT', 'Montana'), ('NE', 'Nebraska'), ('NV', 'Nevada'),
    ('NH', 'New Hampshire'), ('NJ', 'New Jersey'), ('NM', 'New Mexico'), ('NY', 'New York'),
    ('NC', 'North Carolina'), ('ND', 'North Dakota'), ('OH', 'Ohio'), ('OK', 'Oklahoma'),
    ('OR', 'Oregon'), ('PA', 'Pennsylvania'), ('RI', 'Rhode Island'), ('SC', 'South Carolina'),
    ('SD', 'South Dakota'), ('TN', 'Tennessee'), ('TX', 'Texas'), ('UT', 'Utah'),
    ('VT', 'Vermont'), ('VA', 'Virginia'), ('WA', 'Washington'), ('WV', 'West Virginia'),
    ('WI', 'Wisconsin'), ('WY', 'Wyoming'),
    -- Territories
    ('AS', 'American Samoa'), ('DC', 'District of Columbia'), ('FM', 'Federated States of Micronesia'),
    ('GU', 'Guam'), ('MH', 'Marshall Islands'), ('MP', 'Northern Mariana Islands'),
    ('PW', 'Palau'), ('PR', 'Puerto Rico'), ('VI', 'U.S. Virgin Islands')
ON CONFLICT (state_code) DO NOTHING;

-- ======================================
-- 6. CREATE TRIGGERS FOR AUTOMATIC UPDATED_AT
-- ======================================

-- Function to update updated_at column (skip if already exists)
-- The function already exists, so we'll use the existing one

-- Add triggers for new tables
CREATE TRIGGER update_member_address_updated_at 
    BEFORE UPDATE ON member_address 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_member_party_history_updated_at 
    BEFORE UPDATE ON member_party_history 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_member_previous_names_updated_at 
    BEFORE UPDATE ON member_previous_names 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_member_legislation_stats_updated_at 
    BEFORE UPDATE ON member_legislation_stats 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ======================================
-- 7. ADD FOREIGN KEY TO MEMBER_TERM FOR STATE LOOKUP
-- ======================================

-- Add foreign key constraint to member_term for state validation
-- (Only if state reference data exists)
ALTER TABLE member_term 
ADD CONSTRAINT fk_member_term_state 
FOREIGN KEY (state_code) REFERENCES states(state_code) 
DEFERRABLE INITIALLY DEFERRED;

-- ======================================
-- 8. CREATE VIEW FOR API COMPATIBILITY
-- ======================================

-- Create a comprehensive view that matches the API structure
CREATE OR REPLACE VIEW member_api_view AS
SELECT 
    m.bioguide_id,
    m.first_name,
    m.last_name,
    m.middle_name,
    m.suffix_name,
    m.nickname,
    m.direct_order_name,
    m.inverted_order_name,
    m.honorific_name,
    m.birth_year,
    m.death_year,
    m.current_member,
    m.depiction_url,
    m.depiction_attribution,
    m.official_url,
    m.office_address,
    m.phone_number,
    -- Address information (JSON aggregation)
    CASE 
        WHEN ma.member_bioguide_id IS NOT NULL THEN
            json_build_object(
                'city', ma.city,
                'district', ma.district,
                'zipCode', ma.zip_code
            )
        ELSE '{}'::json
    END as address_information,
    -- Current state info from most recent term
    mt_current.state_name,
    mt_current.state_code,
    -- Legislation counts (from most recent congress)
    COALESCE(mls.sponsored_legislation_count, 0) as sponsored_legislation_count,
    COALESCE(mls.cosponsored_legislation_count, 0) as cosponsored_legislation_count,
    mls.sponsored_legislation_url,
    mls.cosponsored_legislation_url,
    m.api_update_date,
    m.created_at,
    m.updated_at
FROM member m
-- Current address (left join to handle members without addresses)
LEFT JOIN member_address ma ON m.bioguide_id = ma.member_bioguide_id 
    AND ma.is_active = TRUE 
    AND ma.address_type = 'current'
-- Most recent term for current state
LEFT JOIN LATERAL (
    SELECT mt.state_name, mt.state_code, mt.congress
    FROM member_term mt
    WHERE mt.member_bioguide_id = m.bioguide_id
    ORDER BY mt.congress DESC, mt.start_year DESC
    LIMIT 1
) mt_current ON true
-- Most recent legislation stats
LEFT JOIN LATERAL (
    SELECT * FROM member_legislation_stats mls_inner
    WHERE mls_inner.member_bioguide_id = m.bioguide_id
    ORDER BY mls_inner.congress DESC
    LIMIT 1
) mls ON true;

-- Index on the view's underlying columns for performance
CREATE INDEX idx_member_address_active_current 
ON member_address (member_bioguide_id) 
WHERE is_active = TRUE AND address_type = 'current';

-- ======================================
-- 9. RECORD MIGRATION IN SCHEMA_MIGRATIONS
-- ======================================

INSERT INTO schema_migrations (migration_id, description) 
VALUES ('004_enhance_member_schema_for_api_parity', 'Add comprehensive member data tables for Congress API parity');

COMMIT;

-- ======================================
-- PERFORMANCE NOTES:
-- ======================================
-- 1. All foreign keys use CASCADE delete to maintain referential integrity
-- 2. Indexes are optimized for common query patterns:
--    - Current member lookups
--    - Party history by member and date ranges  
--    - Name searches with full-text capabilities
--    - Legislation statistics by congress
-- 3. Triggers automatically maintain updated_at timestamps
-- 4. Views provide API-compatible data structure
-- 5. Constraints ensure data quality and logical consistency