-- Rollback: restore migration-011 ORDER BY (relevance only).
-- Note: this rollback restores migration-011 state, NOT any pre-012 live-DB state.
-- If the live DB had out-of-band columns added to the search functions
-- (e.g. an extra `latest_action_date` return column not tracked in any migration),
-- those columns are NOT preserved by this rollback.

DROP FUNCTION IF EXISTS search_bills_only_filtered(TEXT, INT, INT, TEXT, TEXT);

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
    word_sim_threshold REAL := 0.4;
BEGIN
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        b.bill_id::TEXT,
        COALESCE(b.title, '')::TEXT,
        COALESCE(b.policy_area, '')::TEXT,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         ))::REAL as rank,
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
    WHERE
        (b.search_vector @@ prefix_query)
        OR (word_similarity(search_query, b.title) > word_sim_threshold)
        OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
    AND (filter_congress IS NULL OR b.congress_id = filter_congress)
    AND (filter_sponsor IS NULL OR
         EXISTS (
            SELECT 1 FROM bill_sponsor bs
            JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            WHERE bs.bill_id = b.bill_id
            AND (LOWER(m.first_name) LIKE LOWER('%' || filter_sponsor || '%')
                 OR LOWER(m.last_name) LIKE LOWER('%' || filter_sponsor || '%'))
         ))
    ORDER BY
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;


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
    word_sim_threshold REAL := 0.4;
BEGIN
    prefix_query := to_prefix_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        'bill'::TEXT as entity_type,
        b.bill_id::TEXT as entity_id,
        COALESCE(b.title, '')::TEXT,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         ))::REAL as rank,
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
    WHERE
        (b.search_vector @@ prefix_query)
        OR (word_similarity(search_query, b.title) > word_sim_threshold)
        OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
    ORDER BY
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

DELETE FROM schema_migrations WHERE migration_id = '012_search_recency_ordering';
