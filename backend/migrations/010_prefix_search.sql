-- Migration: Enable prefix search for better partial word matching
-- This allows "env" to match "environment", "environmental", etc.
-- Applied: Successfully

-- Helper function to convert plain text to prefix tsquery
-- e.g., "environment protection" → "environment:* & protection:*"
CREATE OR REPLACE FUNCTION to_prefix_tsquery(config regconfig, query_text TEXT)
RETURNS tsquery AS $$
DECLARE
    words TEXT[];
    word TEXT;
    result TEXT := '';
BEGIN
    -- Handle empty or null input
    IF query_text IS NULL OR TRIM(query_text) = '' THEN
        RETURN to_tsquery(config, '');
    END IF;

    -- Split query into words and filter out empty strings
    words := regexp_split_to_array(TRIM(query_text), '\s+');

    -- Build prefix query string
    FOREACH word IN ARRAY words
    LOOP
        IF word != '' AND LENGTH(word) >= 2 THEN
            -- Escape special characters and add prefix operator
            word := regexp_replace(word, '[^a-zA-Z0-9]', '', 'g');
            IF word != '' THEN
                IF result != '' THEN
                    result := result || ' & ';
                END IF;
                result := result || word || ':*';
            END IF;
        END IF;
    END LOOP;

    -- Return empty tsquery if no valid words
    IF result = '' THEN
        RETURN to_tsquery(config, '');
    END IF;

    RETURN to_tsquery(config, result);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Overload for default 'english' config
CREATE OR REPLACE FUNCTION to_prefix_tsquery(query_text TEXT)
RETURNS tsquery AS $$
BEGIN
    RETURN to_prefix_tsquery('english'::regconfig, query_text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- Update the search_bills_only_filtered function to use prefix search
CREATE OR REPLACE FUNCTION search_bills_only_filtered(
    search_query TEXT,
    result_limit INT DEFAULT NULL,
    filter_congress INT DEFAULT NULL,
    filter_sponsor TEXT DEFAULT NULL,
    filter_status TEXT DEFAULT NULL
)
RETURNS TABLE(
    bill_id TEXT,
    title TEXT,
    policy_area TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    introduced_date DATE
) AS $$
DECLARE
    prefix_query tsquery;
BEGIN
    -- Convert search query to prefix tsquery
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        b.bill_id::TEXT,
        COALESCE(b.title, '')::TEXT,
        COALESCE(b.policy_area, '')::TEXT,
        ts_rank_cd(b.search_vector, prefix_query)::REAL as rank,
        ts_headline('english',
            COALESCE(b.title, '') || ' ' ||
            COALESCE(b.policy_area, '') || ' ' ||
            COALESCE(b.latest_action_text, ''),
            prefix_query,
            'MaxFragments=2,MaxWords=50,MinWords=15'
        )::TEXT as snippet,
        b.congress_id::INT,
        b.introduced_date::DATE
    FROM bill b
    WHERE b.search_vector @@ prefix_query
        AND (filter_congress IS NULL OR b.congress_id = filter_congress)
        AND (filter_sponsor IS NULL OR
             EXISTS (
                SELECT 1 FROM bill_sponsor bs
                JOIN member m ON bs.member_bioguide_id = m.bioguide_id
                WHERE bs.bill_id = b.bill_id
                AND (LOWER(m.first_name) LIKE LOWER('%' || filter_sponsor || '%')
                     OR LOWER(m.last_name) LIKE LOWER('%' || filter_sponsor || '%'))
             ))
    ORDER BY ts_rank_cd(b.search_vector, prefix_query) DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;


-- Update the general search_congressional_content function
DROP FUNCTION IF EXISTS search_congressional_content(TEXT, INT);

CREATE OR REPLACE FUNCTION search_congressional_content(
    search_query TEXT,
    result_limit INT DEFAULT NULL
)
RETURNS TABLE(
    entity_type TEXT,
    entity_id TEXT,
    title TEXT,
    rank REAL,
    snippet TEXT,
    congress_id INT,
    date_field DATE
) AS $$
DECLARE
    prefix_query tsquery;
BEGIN
    -- Convert search query to prefix tsquery
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        'bill'::TEXT as entity_type,
        b.bill_id::TEXT as entity_id,
        COALESCE(b.title, '')::TEXT,
        ts_rank_cd(b.search_vector, prefix_query)::REAL as rank,
        ts_headline('english',
            COALESCE(b.title, '') || ' ' ||
            COALESCE(b.policy_area, '') || ' ' ||
            COALESCE(b.latest_action_text, ''),
            prefix_query,
            'MaxFragments=2,MaxWords=50,MinWords=15'
        )::TEXT as snippet,
        b.congress_id::INT,
        b.introduced_date::DATE as date_field
    FROM bill b
    WHERE b.search_vector @@ prefix_query
    ORDER BY ts_rank_cd(b.search_vector, prefix_query) DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;
