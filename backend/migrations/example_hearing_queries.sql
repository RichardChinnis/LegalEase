-- Example Queries for Hearing Synchronization Tables
-- Created: 2025-09-07
-- Purpose: Demonstrate how to query the new hearing synchronization tables

-- =====================================================================
-- EXAMPLE DATA INSERTION PATTERNS
-- =====================================================================

-- Example: Insert a hearing committee association
INSERT INTO hearing_committee (
    hearing_jacket_number, 
    committee_name, 
    committee_system_code, 
    committee_api_url
) VALUES (
    'CHRG-117hhrg46999',
    'Senate Banking, Housing, and Urban Affairs Committee',
    'ssbk00',
    'https://api.congress.gov/v3/committee/senate/ssbk00'
);

-- Example: Insert hearing formats
INSERT INTO hearing_format (
    hearing_jacket_number,
    format_type,
    format_url,
    file_size_bytes
) VALUES 
('CHRG-117hhrg46999', 'PDF', 'https://congress.gov/116/chrg/CHRG-116shrg37721.pdf', 2456789),
('CHRG-117hhrg46999', 'Formatted Text', 'https://congress.gov/116/chrg/CHRG-116shrg37721.txt', 185432);

-- Example: Insert hearing meeting association
INSERT INTO hearing_meeting (
    hearing_jacket_number,
    meeting_event_id,
    meeting_api_url,
    relationship_type
) VALUES (
    'CHRG-117hhrg46999',
    'HMTG-117-hhrg46999-20220315',
    'https://api.congress.gov/v3/committee-meeting/house/HMTG-117-hhrg46999-20220315',
    'associated'
);

-- =====================================================================
-- QUERY PATTERNS
-- =====================================================================

-- 1. Get complete hearing information with all related data
SELECT 
    h.jacket_number,
    h.title,
    h.congress_id,
    h.chamber,
    h.citation,
    -- Committee information
    hc.committee_name,
    hc.committee_system_code,
    -- Format information  
    hf.format_type,
    hf.format_url,
    -- Meeting information
    hm.meeting_event_id,
    hm.meeting_api_url,
    -- Hearing dates
    hd.date as hearing_date
FROM hearing h
LEFT JOIN hearing_committee hc ON h.jacket_number = hc.hearing_jacket_number
LEFT JOIN hearing_format hf ON h.jacket_number = hf.hearing_jacket_number  
LEFT JOIN hearing_meeting hm ON h.jacket_number = hm.hearing_jacket_number
LEFT JOIN hearing_date hd ON h.jacket_number = hd.hearing_jacket_number
WHERE h.congress_id = 117
ORDER BY h.jacket_number, hc.committee_name, hf.format_type;

-- 2. Search hearings by committee
SELECT DISTINCT
    h.jacket_number,
    h.title,
    h.congress_id,
    hc.committee_name,
    hc.committee_system_code
FROM hearing h
JOIN hearing_committee hc ON h.jacket_number = hc.hearing_jacket_number
WHERE hc.committee_name ILIKE '%Banking%'
   OR hc.committee_system_code = 'ssbk00'
ORDER BY h.congress_id DESC, h.jacket_number;

-- 3. Find hearings with specific format types
SELECT 
    h.jacket_number,
    h.title,
    hf.format_type,
    hf.format_url,
    hf.file_size_bytes
FROM hearing h
JOIN hearing_format hf ON h.jacket_number = hf.hearing_jacket_number
WHERE hf.format_type IN ('PDF', 'Formatted Text')
ORDER BY h.congress_id DESC, hf.format_type;

-- 4. Full-text search across hearing titles and committee names
SELECT DISTINCT
    h.jacket_number,
    h.title,
    h.congress_id,
    hc.committee_name,
    ts_rank(h.search_vector, plainto_tsquery('english', 'banking financial')) as title_rank,
    ts_rank(to_tsvector('english', hc.committee_name), plainto_tsquery('english', 'banking financial')) as committee_rank
FROM hearing h
LEFT JOIN hearing_committee hc ON h.jacket_number = hc.hearing_jacket_number
WHERE h.search_vector @@ plainto_tsquery('english', 'banking financial')
   OR to_tsvector('english', hc.committee_name) @@ plainto_tsquery('english', 'banking financial')
ORDER BY GREATEST(
    COALESCE(ts_rank(h.search_vector, plainto_tsquery('english', 'banking financial')), 0),
    COALESCE(ts_rank(to_tsvector('english', hc.committee_name), plainto_tsquery('english', 'banking financial')), 0)
) DESC;

-- 5. Get hearings with multiple committees (joint hearings)
SELECT 
    h.jacket_number,
    h.title,
    COUNT(hc.committee_name) as committee_count,
    STRING_AGG(hc.committee_name, ' | ' ORDER BY hc.committee_name) as committees
FROM hearing h
JOIN hearing_committee hc ON h.jacket_number = hc.hearing_jacket_number
GROUP BY h.jacket_number, h.title
HAVING COUNT(hc.committee_name) > 1
ORDER BY committee_count DESC, h.congress_id DESC;

-- 6. Performance analysis: Get hearings by congress with format availability
SELECT 
    h.congress_id,
    COUNT(DISTINCT h.jacket_number) as total_hearings,
    COUNT(DISTINCT hf.hearing_jacket_number) as hearings_with_formats,
    COUNT(DISTINCT CASE WHEN hf.format_type = 'PDF' THEN hf.hearing_jacket_number END) as pdf_available,
    COUNT(DISTINCT CASE WHEN hf.format_type = 'Formatted Text' THEN hf.hearing_jacket_number END) as text_available,
    ROUND(
        COUNT(DISTINCT hf.hearing_jacket_number)::DECIMAL / 
        COUNT(DISTINCT h.jacket_number) * 100, 
        2
    ) as format_coverage_percent
FROM hearing h
LEFT JOIN hearing_format hf ON h.jacket_number = hf.hearing_jacket_number
GROUP BY h.congress_id
ORDER BY h.congress_id DESC;

-- 7. Get most recent hearings by committee
WITH recent_hearings AS (
    SELECT 
        hc.committee_system_code,
        hc.committee_name,
        h.jacket_number,
        h.title,
        h.congress_id,
        MAX(hd.date) as latest_hearing_date,
        ROW_NUMBER() OVER (
            PARTITION BY hc.committee_system_code 
            ORDER BY MAX(hd.date) DESC
        ) as rn
    FROM hearing h
    JOIN hearing_committee hc ON h.jacket_number = hc.hearing_jacket_number
    JOIN hearing_date hd ON h.jacket_number = hd.hearing_jacket_number
    WHERE hc.committee_system_code IS NOT NULL
    GROUP BY hc.committee_system_code, hc.committee_name, h.jacket_number, h.title, h.congress_id
)
SELECT 
    committee_system_code,
    committee_name,
    jacket_number,
    title,
    congress_id,
    latest_hearing_date
FROM recent_hearings
WHERE rn <= 3  -- Top 3 most recent hearings per committee
ORDER BY committee_system_code, latest_hearing_date DESC;

-- 8. Check data integrity: Find hearings without required associations
-- Hearings without committee associations
SELECT 
    h.jacket_number,
    h.title,
    h.congress_id,
    'No committee association' as issue
FROM hearing h
LEFT JOIN hearing_committee hc ON h.jacket_number = hc.hearing_jacket_number
WHERE hc.hearing_jacket_number IS NULL

UNION ALL

-- Hearings without format information
SELECT 
    h.jacket_number,
    h.title,
    h.congress_id,
    'No format information' as issue
FROM hearing h
LEFT JOIN hearing_format hf ON h.jacket_number = hf.hearing_jacket_number
WHERE hf.hearing_jacket_number IS NULL

ORDER BY congress_id DESC, jacket_number;

-- =====================================================================
-- PERFORMANCE INDEXES VERIFICATION
-- =====================================================================

-- Check that indexes are being used (run EXPLAIN ANALYZE on these)
EXPLAIN (ANALYZE, BUFFERS) 
SELECT h.jacket_number, h.title, hc.committee_name
FROM hearing h
JOIN hearing_committee hc ON h.jacket_number = hc.hearing_jacket_number
WHERE hc.committee_system_code = 'ssbk00';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM hearing_format 
WHERE hearing_jacket_number = 'CHRG-117hhrg46999';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM hearing 
WHERE search_vector @@ plainto_tsquery('english', 'banking reform');