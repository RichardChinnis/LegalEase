-- Congressional Record Database Schema Migration
-- Created: 2024-09-09
-- Purpose: Store Congressional Record volumes, issues, sections, articles, and bill action references

BEGIN;

-- ===============================
-- 1. CREATE ENUMS FOR TYPE SAFETY
-- ===============================

CREATE TYPE cr_chamber_type AS ENUM ('H', 'S', 'E', 'D');
CREATE TYPE cr_section_type AS ENUM ('Senate', 'House', 'Extensions of Remarks', 'Daily Digest');

-- ===============================================
-- 2. CONGRESSIONAL RECORD VOLUME TABLE
-- ===============================================

CREATE TABLE congressional_record_volume (
    volume_id BIGSERIAL PRIMARY KEY,
    volume_number INTEGER NOT NULL,
    congress SMALLINT NOT NULL,
    session_number SMALLINT NOT NULL CHECK (session_number IN (1, 2)),
    year INTEGER NOT NULL CHECK (year >= 1873 AND year <= EXTRACT(YEAR FROM CURRENT_DATE) + 1),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Constraints
    CONSTRAINT unique_volume_congress_session UNIQUE (volume_number, congress, session_number),
    CONSTRAINT valid_congress_year CHECK (
        -- Rough validation: Congress sessions align with years
        year >= (1787 + (congress - 1) * 2) AND 
        year <= (1787 + congress * 2)
    )
);

-- ===============================================
-- 3. CONGRESSIONAL RECORD ISSUE TABLE
-- ===============================================

CREATE TABLE congressional_record_issue (
    issue_id BIGSERIAL PRIMARY KEY,
    volume_id BIGINT NOT NULL REFERENCES congressional_record_volume(volume_id) ON DELETE CASCADE,
    
    issue_number INTEGER NOT NULL,
    issue_date DATE NOT NULL,
    congress SMALLINT NOT NULL,
    session_number SMALLINT NOT NULL CHECK (session_number IN (1, 2)),
    
    -- URLs and resources
    full_issue_url TEXT,
    update_date DATE,
    
    -- Metadata for additional issue information
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Constraints
    CONSTRAINT unique_issue_volume_number UNIQUE (volume_id, issue_number),
    CONSTRAINT unique_issue_date_congress UNIQUE (issue_date, congress),
    CONSTRAINT valid_issue_date CHECK (issue_date >= DATE '1873-03-04')
    
    -- Note: Congress/session consistency enforced by application logic and triggers
);

-- ===============================================
-- 4. CONGRESSIONAL RECORD SECTION TABLE
-- ===============================================

CREATE TABLE congressional_record_section (
    section_id BIGSERIAL PRIMARY KEY,
    issue_id BIGINT NOT NULL REFERENCES congressional_record_issue(issue_id) ON DELETE CASCADE,
    
    name cr_section_type NOT NULL,
    start_page VARCHAR(20) NOT NULL, -- Handles formats like "H3218", "S1234", "E456"
    end_page VARCHAR(20),
    
    -- URLs and resources
    pdf_url TEXT,
    text_url TEXT,
    
    -- Content metadata
    page_count INTEGER GENERATED ALWAYS AS (
        CASE 
            WHEN end_page IS NULL THEN 1
            WHEN start_page ~ '^\d+$' AND end_page ~ '^\d+$' 
            THEN GREATEST(1, (end_page::INTEGER - start_page::INTEGER + 1))
            ELSE NULL
        END
    ) STORED,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Constraints
    CONSTRAINT unique_section_issue_name UNIQUE (issue_id, name),
    CONSTRAINT valid_page_numbers CHECK (
        start_page IS NOT NULL AND 
        (end_page IS NULL OR 
         (start_page ~ '^\w?\d+$' AND end_page ~ '^\w?\d+$'))
    )
);

-- ===============================================
-- 5. CONGRESSIONAL RECORD ARTICLE TABLE
-- ===============================================

CREATE TABLE congressional_record_article (
    article_id BIGSERIAL PRIMARY KEY,
    section_id BIGINT NOT NULL REFERENCES congressional_record_section(section_id) ON DELETE CASCADE,
    
    title TEXT NOT NULL,
    start_page VARCHAR(20) NOT NULL,
    end_page VARCHAR(20),
    
    -- URLs and resources
    pdf_url TEXT,
    text_url TEXT,
    
    -- Full-text content with search capabilities
    content_text TEXT,
    content_search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content_text, ''))
    ) STORED,
    
    -- Content metadata
    word_count INTEGER,
    character_count INTEGER,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Constraints
    CONSTRAINT valid_article_pages CHECK (
        start_page IS NOT NULL AND 
        (end_page IS NULL OR 
         (start_page ~ '^\w?\d+$' AND end_page ~ '^\w?\d+$'))
    ),
    CONSTRAINT non_empty_title CHECK (TRIM(title) != ''),
    CONSTRAINT reasonable_content_length CHECK (
        content_text IS NULL OR LENGTH(content_text) <= 10000000 -- 10MB limit
    )
);

-- ===============================================
-- 6. ACTION CONGRESSIONAL RECORD REFERENCE TABLE
-- ===============================================

CREATE TABLE action_congressional_record_reference (
    reference_id BIGSERIAL PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES action(action_id) ON DELETE CASCADE,
    
    -- Bill identification (redundant but useful for queries)
    bill_id VARCHAR(255) NOT NULL,
    
    -- Raw reference information
    reference_text VARCHAR(500) NOT NULL, -- e.g., "CR H3218-3219"
    chamber cr_chamber_type NOT NULL,
    start_page VARCHAR(20) NOT NULL,
    end_page VARCHAR(20),
    
    -- Resolved references to actual CR content
    issue_id BIGINT REFERENCES congressional_record_issue(issue_id) ON DELETE SET NULL,
    section_id BIGINT REFERENCES congressional_record_section(section_id) ON DELETE SET NULL,
    article_id BIGINT REFERENCES congressional_record_article(article_id) ON DELETE SET NULL,
    
    -- Resolution status
    is_resolved BOOLEAN DEFAULT FALSE NOT NULL,
    resolution_confidence DECIMAL(3,2) CHECK (resolution_confidence >= 0 AND resolution_confidence <= 1),
    resolution_notes TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Constraints
    CONSTRAINT unique_action_reference UNIQUE (action_id, reference_text),
    CONSTRAINT valid_page_format CHECK (
        start_page ~ '^\w?\d+$' AND 
        (end_page IS NULL OR end_page ~ '^\w?\d+$')
    ),
    CONSTRAINT logical_resolution CHECK (
        (is_resolved = FALSE) OR 
        (is_resolved = TRUE AND (issue_id IS NOT NULL OR section_id IS NOT NULL))
    )
    
    -- Note: Bill ID consistency enforced by application logic and triggers
);

-- ===============================================
-- 7. CREATE COMPREHENSIVE INDEXES
-- ===============================================

-- Volume indexes
CREATE INDEX idx_volume_congress_session ON congressional_record_volume (congress, session_number);
CREATE INDEX idx_volume_year ON congressional_record_volume (year);

-- Issue indexes
CREATE INDEX idx_issue_date ON congressional_record_issue (issue_date DESC);
CREATE INDEX idx_issue_congress_date ON congressional_record_issue (congress, issue_date DESC);
CREATE INDEX idx_issue_volume_number ON congressional_record_issue (volume_id, issue_number);

-- Section indexes
CREATE INDEX idx_section_issue_name ON congressional_record_section (issue_id, name);
CREATE INDEX idx_section_page_lookup ON congressional_record_section (start_page, end_page) WHERE end_page IS NOT NULL;

-- Article indexes
CREATE INDEX idx_article_section ON congressional_record_article (section_id);
CREATE INDEX idx_article_page_lookup ON congressional_record_article (start_page, end_page) WHERE end_page IS NOT NULL;
CREATE INDEX idx_article_title_search ON congressional_record_article USING GIN (to_tsvector('english', title));
CREATE INDEX idx_article_content_search ON congressional_record_article USING GIN (content_search_vector);

-- Reference indexes - Critical for performance
CREATE INDEX idx_reference_action ON action_congressional_record_reference (action_id);
CREATE INDEX idx_reference_bill ON action_congressional_record_reference (bill_id);
CREATE INDEX idx_reference_chamber_page ON action_congressional_record_reference (chamber, start_page);
CREATE INDEX idx_reference_resolution_status ON action_congressional_record_reference (is_resolved, issue_id) WHERE is_resolved = TRUE;
CREATE INDEX idx_reference_unresolved ON action_congressional_record_reference (chamber, start_page) WHERE is_resolved = FALSE;

-- Composite indexes for common query patterns
CREATE INDEX idx_bill_action_references ON action_congressional_record_reference (bill_id, chamber, start_page);
CREATE INDEX idx_issue_section_lookup ON congressional_record_section (issue_id, name, start_page);

-- ===============================================
-- 8. CREATE HELPER FUNCTIONS
-- ===============================================

-- Function to parse page numbers for range queries
CREATE OR REPLACE FUNCTION extract_page_number(page_text VARCHAR)
RETURNS INTEGER AS $$
BEGIN
    -- Extract numeric part from formats like "H3218", "S1234", "3218"
    RETURN CASE 
        WHEN page_text ~ '^\d+$' THEN page_text::INTEGER
        WHEN page_text ~ '^\w\d+$' THEN SUBSTRING(page_text FROM '\d+')::INTEGER
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to find articles by page number range
CREATE OR REPLACE FUNCTION find_articles_by_page_range(
    p_chamber cr_chamber_type,
    p_start_page VARCHAR,
    p_end_page VARCHAR DEFAULT NULL,
    p_issue_date DATE DEFAULT NULL
)
RETURNS TABLE (
    article_id BIGINT,
    title TEXT,
    section_name cr_section_type,
    issue_date DATE,
    article_start_page VARCHAR,
    article_end_page VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.article_id,
        a.title,
        s.name,
        i.issue_date,
        a.start_page,
        a.end_page
    FROM congressional_record_article a
    JOIN congressional_record_section s ON a.section_id = s.section_id
    JOIN congressional_record_issue i ON s.issue_id = i.issue_id
    WHERE 
        -- Chamber matching through section name
        (p_chamber = 'H' AND s.name = 'House') OR
        (p_chamber = 'S' AND s.name = 'Senate') OR
        (p_chamber = 'E' AND s.name = 'Extensions of Remarks') OR
        (p_chamber = 'D' AND s.name = 'Daily Digest')
        -- Page range overlap check
        AND (
            (extract_page_number(a.start_page) <= extract_page_number(p_start_page) AND 
             extract_page_number(COALESCE(a.end_page, a.start_page)) >= extract_page_number(p_start_page))
            OR
            (extract_page_number(a.start_page) <= extract_page_number(COALESCE(p_end_page, p_start_page)) AND 
             extract_page_number(COALESCE(a.end_page, a.start_page)) >= extract_page_number(COALESCE(p_end_page, p_start_page)))
        )
        -- Optional date filter
        AND (p_issue_date IS NULL OR i.issue_date = p_issue_date)
    ORDER BY i.issue_date DESC, extract_page_number(a.start_page);
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- 9. CREATE UPDATE TRIGGERS
-- ===============================================

-- Use existing update timestamps trigger function

-- Apply triggers to all tables
CREATE TRIGGER update_volume_updated_at BEFORE UPDATE ON congressional_record_volume
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_issue_updated_at BEFORE UPDATE ON congressional_record_issue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_section_updated_at BEFORE UPDATE ON congressional_record_section
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_article_updated_at BEFORE UPDATE ON congressional_record_article
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reference_updated_at BEFORE UPDATE ON action_congressional_record_reference
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Consistency enforcement triggers

-- Trigger to enforce congress/session consistency in issues
CREATE OR REPLACE FUNCTION enforce_issue_volume_consistency()
RETURNS TRIGGER AS $$
DECLARE
    volume_congress SMALLINT;
    volume_session SMALLINT;
BEGIN
    SELECT congress, session_number INTO volume_congress, volume_session
    FROM congressional_record_volume 
    WHERE volume_id = NEW.volume_id;
    
    IF volume_congress IS NULL THEN
        RAISE EXCEPTION 'Volume % does not exist', NEW.volume_id;
    END IF;
    
    IF NEW.congress != volume_congress THEN
        RAISE EXCEPTION 'Issue congress (%) must match volume congress (%)', NEW.congress, volume_congress;
    END IF;
    
    IF NEW.session_number != volume_session THEN
        RAISE EXCEPTION 'Issue session (%) must match volume session (%)', NEW.session_number, volume_session;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_issue_consistency 
    BEFORE INSERT OR UPDATE ON congressional_record_issue
    FOR EACH ROW EXECUTE FUNCTION enforce_issue_volume_consistency();

-- Trigger to enforce bill_id consistency in CR references
CREATE OR REPLACE FUNCTION enforce_reference_bill_consistency()
RETURNS TRIGGER AS $$
DECLARE
    action_bill_id VARCHAR(255);
BEGIN
    SELECT bill_id INTO action_bill_id
    FROM action 
    WHERE action_id = NEW.action_id;
    
    IF action_bill_id IS NULL THEN
        RAISE EXCEPTION 'Action % does not exist or has no bill_id', NEW.action_id;
    END IF;
    
    IF NEW.bill_id != action_bill_id THEN
        RAISE EXCEPTION 'Reference bill_id (%) must match action bill_id (%)', NEW.bill_id, action_bill_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_reference_consistency 
    BEFORE INSERT OR UPDATE ON action_congressional_record_reference
    FOR EACH ROW EXECUTE FUNCTION enforce_reference_bill_consistency();

-- ===============================================
-- 10. CREATE VIEWS FOR COMMON QUERIES
-- ===============================================

-- View for bill CR references with resolved content
CREATE VIEW bill_congressional_record_references AS
SELECT 
    r.reference_id,
    r.bill_id,
    a.action_date,
    a.text as action_text,
    r.reference_text,
    r.chamber,
    r.start_page,
    r.end_page,
    r.is_resolved,
    -- Issue information
    i.issue_date,
    i.congress,
    i.session_number,
    -- Section information
    s.name as section_name,
    -- Article information
    art.title as article_title,
    art.article_id,
    r.created_at
FROM action_congressional_record_reference r
JOIN action a ON r.action_id = a.action_id
LEFT JOIN congressional_record_issue i ON r.issue_id = i.issue_id
LEFT JOIN congressional_record_section s ON r.section_id = s.section_id
LEFT JOIN congressional_record_article art ON r.article_id = art.article_id;

-- View for CR content search
CREATE VIEW congressional_record_search AS
SELECT 
    'article' as content_type,
    art.article_id as content_id,
    art.title,
    art.content_text,
    s.name as section_name,
    i.issue_date,
    i.congress,
    v.volume_number,
    art.start_page,
    art.end_page,
    art.content_search_vector
FROM congressional_record_article art
JOIN congressional_record_section s ON art.section_id = s.section_id
JOIN congressional_record_issue i ON s.issue_id = i.issue_id
JOIN congressional_record_volume v ON i.volume_id = v.volume_id
WHERE art.content_text IS NOT NULL;

-- ===============================================
-- 11. GRANT PERMISSIONS
-- ===============================================

-- Grant permissions to application user
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO congress_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO congress_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO congress_admin;

-- ===============================================
-- 12. ADD COMMENTS FOR DOCUMENTATION
-- ===============================================

COMMENT ON TABLE congressional_record_volume IS 'Congressional Record volumes organized by Congress and session';
COMMENT ON TABLE congressional_record_issue IS 'Daily issues within each Congressional Record volume';
COMMENT ON TABLE congressional_record_section IS 'Sections within each issue (Senate, House, Extensions, Daily Digest)';
COMMENT ON TABLE congressional_record_article IS 'Individual articles within sections, with full-text search capability';
COMMENT ON TABLE action_congressional_record_reference IS 'References from bill actions to specific Congressional Record pages';

COMMENT ON COLUMN congressional_record_article.content_search_vector IS 'Automatically maintained full-text search index';
COMMENT ON COLUMN action_congressional_record_reference.is_resolved IS 'Whether the page reference has been matched to actual CR content';
COMMENT ON COLUMN action_congressional_record_reference.resolution_confidence IS 'Confidence score (0-1) for automated reference resolution';

COMMIT;