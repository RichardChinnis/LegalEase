-- Fix monitoring functions with correct timestamp types

-- Drop and recreate get_table_stats with correct types
DROP FUNCTION IF EXISTS get_table_stats();

CREATE OR REPLACE FUNCTION get_table_stats()
RETURNS TABLE(
    table_name VARCHAR(100),
    total_size BIGINT,
    table_size BIGINT,
    index_size BIGINT,
    seq_scan BIGINT,
    seq_tup_read BIGINT,
    idx_scan BIGINT,
    idx_tup_fetch BIGINT,
    n_tup_ins BIGINT,
    n_tup_upd BIGINT,
    n_tup_del BIGINT,
    last_vacuum TIMESTAMP WITH TIME ZONE,
    last_analyze TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (st.schemaname || '.' || st.relname)::VARCHAR(100) as table_name,
        pg_total_relation_size(st.schemaname||'.'||st.relname) as total_size,
        pg_relation_size(st.schemaname||'.'||st.relname) as table_size,
        pg_total_relation_size(st.schemaname||'.'||st.relname) - pg_relation_size(st.schemaname||'.'||st.relname) as index_size,
        st.seq_scan,
        st.seq_tup_read,
        st.idx_scan,
        st.idx_tup_fetch,
        st.n_tup_ins,
        st.n_tup_upd,
        st.n_tup_del,
        st.last_vacuum,
        st.last_analyze
    FROM pg_stat_user_tables st
    WHERE st.schemaname = 'public'
    ORDER BY pg_total_relation_size(st.schemaname||'.'||st.relname) DESC;
END;
$$ LANGUAGE plpgsql;

-- Fix get_current_activity function  
DROP FUNCTION IF EXISTS get_current_activity();

CREATE OR REPLACE FUNCTION get_current_activity()
RETURNS TABLE(
    pid INTEGER,
    username TEXT,
    database_name TEXT,
    query_start TIMESTAMP WITH TIME ZONE,
    query_duration INTERVAL,
    state TEXT,
    query_preview TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pg_stat_activity.pid,
        pg_stat_activity.usename::TEXT,
        pg_stat_activity.datname::TEXT,
        pg_stat_activity.query_start,
        CURRENT_TIMESTAMP - pg_stat_activity.query_start as query_duration,
        pg_stat_activity.state::TEXT,
        LEFT(pg_stat_activity.query, 200)::TEXT as query_preview
    FROM pg_stat_activity
    WHERE pg_stat_activity.state IS NOT NULL
      AND pg_stat_activity.pid <> pg_backend_pid()
      AND pg_stat_activity.datname = 'congress_api'
    ORDER BY query_duration DESC;
END;
$$ LANGUAGE plpgsql;

-- Fix get_detailed_sync_health function
DROP FUNCTION IF EXISTS get_detailed_sync_health();

CREATE OR REPLACE FUNCTION get_detailed_sync_health()
RETURNS TABLE(
    entity_type VARCHAR(50),
    last_sync_time TIMESTAMP WITH TIME ZONE,
    last_successful_sync TIMESTAMP WITH TIME ZONE,
    hours_since_sync NUMERIC,
    sync_frequency_hours NUMERIC,
    status TEXT,
    record_count BIGINT,
    health_status TEXT,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH entity_counts AS (
        SELECT 'bills' as entity, COUNT(*) as cnt FROM bill
        UNION ALL
        SELECT 'members' as entity, COUNT(*) as cnt FROM member
        UNION ALL
        SELECT 'committees' as entity, COUNT(*) as cnt FROM committee
        UNION ALL
        SELECT 'committee_reports' as entity, COUNT(*) as cnt FROM committee_report
        UNION ALL
        SELECT 'hearings' as entity, COUNT(*) as cnt FROM hearing
        UNION ALL
        SELECT 'actions' as entity, COUNT(*) as cnt FROM action
    ),
    sync_analysis AS (
        SELECT 
            ss.entity_type,
            ss.last_sync_at,
            ss.last_successful_sync,
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ss.last_sync_at)) / 3600 as hours_since_sync,
            CASE ss.entity_type
                WHEN 'bills' THEN 24.0
                WHEN 'members' THEN 168.0  -- Weekly
                WHEN 'committees' THEN 168.0  -- Weekly
                ELSE 24.0
            END as expected_frequency,
            ss.status,
            ec.cnt as record_count
        FROM sync_status ss
        LEFT JOIN entity_counts ec ON ss.entity_type = ec.entity
    )
    SELECT 
        sa.entity_type::VARCHAR(50),
        sa.last_sync_at,
        sa.last_successful_sync,
        sa.hours_since_sync,
        sa.expected_frequency,
        sa.status::TEXT,
        COALESCE(sa.record_count, 0) as record_count,
        CASE 
            WHEN sa.hours_since_sync IS NULL THEN 'NEVER_SYNCED'
            WHEN sa.hours_since_sync > (sa.expected_frequency * 2) THEN 'CRITICAL'
            WHEN sa.hours_since_sync > sa.expected_frequency THEN 'WARNING'
            ELSE 'HEALTHY'
        END::TEXT as health_status,
        CASE 
            WHEN sa.hours_since_sync IS NULL THEN 'Initialize sync for this entity type'
            WHEN sa.hours_since_sync > (sa.expected_frequency * 2) THEN 'Immediate sync required - data severely stale'
            WHEN sa.hours_since_sync > sa.expected_frequency THEN 'Schedule sync soon - data becoming stale'
            ELSE 'Sync status normal'
        END::TEXT as recommendation
    FROM sync_analysis sa
    ORDER BY 
        CASE 
            WHEN sa.hours_since_sync IS NULL THEN 3
            WHEN sa.hours_since_sync > (sa.expected_frequency * 2) THEN 2
            WHEN sa.hours_since_sync > sa.expected_frequency THEN 1
            ELSE 0
        END DESC,
        sa.hours_since_sync DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;