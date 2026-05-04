-- Migration: Add Full-Text Search Vectors to Congressional Tables
-- Description: Adds tsvector columns, GIN indexes, and trigger functions for comprehensive full-text search
-- Created: 2025-08-25
-- Safe to run: Adds search capabilities without affecting existing data

-- Start transaction for atomic migration
BEGIN;

-- Check if this migration has already been applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = '002_add_search_vectors') THEN
        RAISE EXCEPTION 'Migration 002_add_search_vectors has already been applied';
    END IF;
END
$$;

-- ---
-- Add search_vector columns to all searchable tables
-- ---

-- Add search_vector to bill table
ALTER TABLE bill ADD COLUMN IF NOT EXISTS search_vector tsvector;
COMMENT ON COLUMN bill.search_vector IS 'Full-text search vector combining title (A), policy_area (A), latest_action_text (B), and constitutional_authority_statement_text (D)';

-- Add search_vector to hearing table  
ALTER TABLE hearing ADD COLUMN IF NOT EXISTS search_vector tsvector;
COMMENT ON COLUMN hearing.search_vector IS 'Full-text search vector combining title (A) and citation (C)';

-- Add search_vector to committee_report table
ALTER TABLE committee_report ADD COLUMN IF NOT EXISTS search_vector tsvector;
COMMENT ON COLUMN committee_report.search_vector IS 'Full-text search vector for citation (A)';

-- Add search_vector to action table
ALTER TABLE action ADD COLUMN IF NOT EXISTS search_vector tsvector;
COMMENT ON COLUMN action.search_vector IS 'Full-text search vector for text (B)';

-- ---
-- Create GIN indexes for fast full-text search
-- ---

-- GIN indexes for search_vector columns (without CONCURRENTLY due to transaction)
CREATE INDEX IF NOT EXISTS idx_bill_search_vector_gin 
    ON bill USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_hearing_search_vector_gin 
    ON hearing USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_committee_report_search_vector_gin 
    ON committee_report USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_action_search_vector_gin 
    ON action USING GIN(search_vector);

-- ---
-- Create trigger functions to automatically update search vectors
-- ---

-- Trigger function for bill table
CREATE OR REPLACE FUNCTION update_bill_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    -- Combine title (weight A), policy_area (weight A), latest_action_text (weight B), 
    -- constitutional_authority_statement_text (weight D)
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.policy_area, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.latest_action_text, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.constitutional_authority_statement_text, '')), 'D');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for hearing table
CREATE OR REPLACE FUNCTION update_hearing_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    -- Combine title (weight A) and citation (weight C)
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.citation, '')), 'C');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for committee_report table
CREATE OR REPLACE FUNCTION update_committee_report_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    -- Use citation (weight A)
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.citation, '')), 'A');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for action table
CREATE OR REPLACE FUNCTION update_action_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    -- Use text (weight B)
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.text, '')), 'B');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---
-- Create triggers to auto-update search vectors on INSERT/UPDATE
-- ---

-- Drop existing triggers if they exist to avoid conflicts
DROP TRIGGER IF EXISTS bill_search_vector_trigger ON bill;
DROP TRIGGER IF EXISTS hearing_search_vector_trigger ON hearing;
DROP TRIGGER IF EXISTS committee_report_search_vector_trigger ON committee_report;
DROP TRIGGER IF EXISTS action_search_vector_trigger ON action;

-- Create triggers for auto-updating search vectors
CREATE TRIGGER bill_search_vector_trigger
    BEFORE INSERT OR UPDATE ON bill
    FOR EACH ROW EXECUTE FUNCTION update_bill_search_vector();

CREATE TRIGGER hearing_search_vector_trigger
    BEFORE INSERT OR UPDATE ON hearing
    FOR EACH ROW EXECUTE FUNCTION update_hearing_search_vector();

CREATE TRIGGER committee_report_search_vector_trigger
    BEFORE INSERT OR UPDATE ON committee_report
    FOR EACH ROW EXECUTE FUNCTION update_committee_report_search_vector();

CREATE TRIGGER action_search_vector_trigger
    BEFORE INSERT OR UPDATE ON action
    FOR EACH ROW EXECUTE FUNCTION update_action_search_vector();

-- ---
-- Populate existing data with search vectors
-- ---

-- Update bill search vectors for existing data
UPDATE bill SET search_vector = 
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(policy_area, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(latest_action_text, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(constitutional_authority_statement_text, '')), 'D')
WHERE search_vector IS NULL;

-- Update hearing search vectors for existing data
UPDATE hearing SET search_vector = 
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(citation, '')), 'C')
WHERE search_vector IS NULL;

-- Update committee_report search vectors for existing data
UPDATE committee_report SET search_vector = 
    setweight(to_tsvector('english', COALESCE(citation, '')), 'A')
WHERE search_vector IS NULL;

-- Update action search vectors for existing data
UPDATE action SET search_vector = 
    setweight(to_tsvector('english', COALESCE(text, '')), 'B')
WHERE search_vector IS NULL;

-- ---
-- Create helper functions for search functionality
-- ---

-- Function to search across all Congressional entities with ranking
CREATE OR REPLACE FUNCTION search_congressional_content(search_query TEXT, result_limit INT DEFAULT 50)
RETURNS TABLE(
    entity_type TEXT,
    entity_id TEXT,
    title TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    date_field DATE
) AS $$
BEGIN
    RETURN QUERY
    WITH search_results AS (
        -- Search bills
        SELECT 
            'bill'::TEXT as entity_type,
            b.bill_id::TEXT as entity_id,
            COALESCE(b.title, '')::TEXT as title,
            ts_rank_cd(b.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english', 
                COALESCE(b.title, '') || ' ' || 
                COALESCE(b.policy_area, '') || ' ' || 
                COALESCE(b.latest_action_text, ''), 
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            b.congress_id::INT,
            b.introduced_date::DATE as date_field
        FROM bill b
        WHERE b.search_vector @@ plainto_tsquery('english', search_query)
        
        UNION ALL
        
        -- Search hearings
        SELECT 
            'hearing'::TEXT as entity_type,
            h.jacket_number::TEXT as entity_id,
            COALESCE(h.title, '')::TEXT as title,
            ts_rank_cd(h.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english', 
                COALESCE(h.title, '') || ' ' || 
                COALESCE(h.citation, ''), 
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            h.congress_id::INT,
            NULL::DATE as date_field  -- hearings don't have a single date
        FROM hearing h
        WHERE h.search_vector @@ plainto_tsquery('english', search_query)
        
        UNION ALL
        
        -- Search committee reports  
        SELECT 
            'committee_report'::TEXT as entity_type,
            cr.report_id::TEXT as entity_id,
            COALESCE(cr.citation, '')::TEXT as title,
            ts_rank_cd(cr.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english', 
                COALESCE(cr.citation, ''), 
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            cr.congress_id::INT,
            cr.issue_date::DATE as date_field
        FROM committee_report cr
        WHERE cr.search_vector @@ plainto_tsquery('english', search_query)
        
        UNION ALL
        
        -- Search actions
        SELECT 
            'action'::TEXT as entity_type,
            a.action_id::TEXT as entity_id,
            COALESCE(LEFT(a.text, 100), 'Legislative Action')::TEXT as title,
            ts_rank_cd(a.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english', 
                COALESCE(a.text, ''), 
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            -- Get congress_id from related bill if available
            COALESCE(
                (SELECT b.congress_id FROM bill b WHERE b.bill_id = a.bill_id),
                118  -- default to current congress
            )::INT as congress_id,
            a.action_date::DATE as date_field
        FROM action a
        WHERE a.search_vector @@ plainto_tsquery('english', search_query)
    )
    SELECT 
        sr.entity_type,
        sr.entity_id,
        sr.title,
        sr.rank,
        sr.snippet,
        sr.congress_id,
        sr.date_field
    FROM search_results sr
    ORDER BY sr.rank DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_congressional_content IS 'Searches across all Congressional entities with relevance ranking and snippets';

-- Function for entity-specific search with better performance
CREATE OR REPLACE FUNCTION search_bills_only(search_query TEXT, result_limit INT DEFAULT 25)
RETURNS TABLE(
    bill_id TEXT,
    title TEXT,
    policy_area TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    introduced_date DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.bill_id::TEXT,
        COALESCE(b.title, '')::TEXT,
        COALESCE(b.policy_area, '')::TEXT,
        ts_rank_cd(b.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
        ts_headline('english', 
            COALESCE(b.title, '') || ' ' || 
            COALESCE(b.policy_area, '') || ' ' || 
            COALESCE(b.latest_action_text, ''), 
            plainto_tsquery('english', search_query),
            'MaxFragments=2,MaxWords=50,MinWords=15'
        )::TEXT as snippet,
        b.congress_id::INT,
        b.introduced_date::DATE
    FROM bill b
    WHERE b.search_vector @@ plainto_tsquery('english', search_query)
    ORDER BY ts_rank_cd(b.search_vector, plainto_tsquery('english', search_query)) DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_bills_only IS 'Fast search specifically for bills with detailed results';

-- ---
-- Additional indexes for search performance optimization
-- ---

-- Composite indexes for common search patterns (without CONCURRENTLY due to transaction)
CREATE INDEX IF NOT EXISTS idx_bill_congress_policy_area 
    ON bill(congress_id, policy_area);

CREATE INDEX IF NOT EXISTS idx_bill_congress_date 
    ON bill(congress_id, introduced_date DESC);

CREATE INDEX IF NOT EXISTS idx_hearing_congress_chamber 
    ON hearing(congress_id, chamber);

CREATE INDEX IF NOT EXISTS idx_action_bill_date 
    ON action(bill_id, action_date DESC);

-- Index for search result ordering
CREATE INDEX IF NOT EXISTS idx_committee_report_congress_date 
    ON committee_report(congress_id, issue_date DESC);

-- ---
-- Create search configuration documentation
-- ---

-- Create a view for search statistics and monitoring
CREATE OR REPLACE VIEW search_index_stats AS
SELECT 
    'bill' as table_name,
    COUNT(*) as total_rows,
    COUNT(*) FILTER (WHERE search_vector IS NOT NULL) as indexed_rows,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE search_vector IS NOT NULL) / NULLIF(COUNT(*), 0), 
        2
    ) as index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('bill')) as table_size
FROM bill
UNION ALL
SELECT 
    'hearing' as table_name,
    COUNT(*) as total_rows,
    COUNT(*) FILTER (WHERE search_vector IS NOT NULL) as indexed_rows,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE search_vector IS NOT NULL) / NULLIF(COUNT(*), 0), 
        2
    ) as index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('hearing')) as table_size
FROM hearing
UNION ALL
SELECT 
    'committee_report' as table_name,
    COUNT(*) as total_rows,
    COUNT(*) FILTER (WHERE search_vector IS NOT NULL) as indexed_rows,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE search_vector IS NOT NULL) / NULLIF(COUNT(*), 0), 
        2
    ) as index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('committee_report')) as table_size
FROM committee_report
UNION ALL
SELECT 
    'action' as table_name,
    COUNT(*) as total_rows,
    COUNT(*) FILTER (WHERE search_vector IS NOT NULL) as indexed_rows,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE search_vector IS NOT NULL) / NULLIF(COUNT(*), 0), 
        2
    ) as index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('action')) as table_size
FROM action;

COMMENT ON VIEW search_index_stats IS 'Provides monitoring data for search index coverage and performance';

-- Record that this migration has been applied
INSERT INTO schema_migrations (migration_id, description) 
VALUES ('002_add_search_vectors', 'Add full-text search vectors, indexes, and functions to Congressional tables');

COMMIT;

-- Migration completed successfully
-- Search vectors are now available for bills, hearings, committee reports, and actions
-- Use search_congressional_content('search term') for cross-entity search
-- Use search_bills_only('search term') for bill-specific search
-- Monitor with: SELECT * FROM search_index_stats;