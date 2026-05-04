-- Simplified search function to get search working again

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
        AND (filter_congress IS NULL OR b.congress_id = filter_congress)
        -- Temporarily remove sponsor and status filtering to get it working
    ORDER BY ts_rank_cd(b.search_vector, plainto_tsquery('english', search_query)) DESC
    LIMIT result_limit;  -- NULL means no limit
END;
$$ LANGUAGE plpgsql;