-- Migration: Recency-aware ordering for search functions
-- Adds congress_id (primary) and latest_action_date (tiebreaker) to the ORDER BY
-- so current-Congress bills surface above older-Congress bills.
-- Also corrects a pre-existing AND/OR precedence bug in the WHERE clause so that
-- the filter_congress and filter_sponsor parameters bind to the full match set,
-- not just the policy_area similarity branch.
--
-- DEPLOY NOTE: this migration contains DDL (DROP/CREATE FUNCTION). The standard
-- migrate.js runner connects as `congress_api_backend` (read-only) and will fail
-- with "must be owner of function". Apply manually with admin creds:
--
--   PGPASSWORD='<from backend/.env.admin>' psql -h localhost -U congress_admin \
--     -d congress_api -f backend/migrations/012_search_recency_ordering.sql
--
-- The DROP FUNCTION statements at the top allow safe re-application; the
-- INSERT INTO schema_migrations at the bottom uses ON CONFLICT DO NOTHING.

-- Drop first in case the live function has a different return type (e.g. extra columns
-- added outside migrations). CREATE OR REPLACE cannot change return types.
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
        (
            (b.search_vector @@ prefix_query)
            OR (word_similarity(search_query, b.title) > word_sim_threshold)
            OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
        )
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
        b.congress_id DESC NULLS LAST,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC,
        b.latest_action_date DESC NULLS LAST,
        b.bill_id DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;


-- Recreate the general-content search function with the same ORDER BY.
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
        (
            (b.search_vector @@ prefix_query)
            OR (word_similarity(search_query, b.title) > word_sim_threshold)
            OR (word_similarity(search_query, b.policy_area) > word_sim_threshold)
        )
    ORDER BY
        b.congress_id DESC NULLS LAST,
        (COALESCE(ts_rank_cd(b.search_vector, prefix_query), 0) * 2 +
         GREATEST(
             COALESCE(word_similarity(search_query, b.title), 0),
             COALESCE(word_similarity(search_query, b.policy_area), 0)
         )) DESC,
        b.latest_action_date DESC NULLS LAST,
        b.bill_id DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Record this migration so the runner doesn't re-apply it.
INSERT INTO schema_migrations (migration_id, description)
VALUES ('012_search_recency_ordering', 'Add congress_id and latest_action_date to search ORDER BY')
ON CONFLICT (migration_id) DO NOTHING;
