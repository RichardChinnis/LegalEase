-- Database Foundation Monitoring Migration
-- Phase 1: Performance Baseline Establishment & Critical Infrastructure

-- ========================================
-- PERFORMANCE MONITORING FUNCTIONS
-- ========================================

-- Function to get database performance baseline metrics
CREATE OR REPLACE FUNCTION get_performance_baseline()
RETURNS TABLE(
    metric_name VARCHAR(100),
    metric_value NUMERIC,
    metric_unit VARCHAR(20),
    timestamp_recorded TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'total_connections'::VARCHAR(100) as metric_name,
        count(*)::NUMERIC as metric_value,
        'connections'::VARCHAR(20) as metric_unit,
        CURRENT_TIMESTAMP as timestamp_recorded
    FROM pg_stat_activity
    WHERE state IS NOT NULL
    
    UNION ALL
    
    SELECT 
        'active_connections'::VARCHAR(100),
        count(*)::NUMERIC,
        'connections'::VARCHAR(20),
        CURRENT_TIMESTAMP
    FROM pg_stat_activity
    WHERE state = 'active'
    
    UNION ALL
    
    SELECT 
        'idle_connections'::VARCHAR(100),
        count(*)::NUMERIC,
        'connections'::VARCHAR(20),
        CURRENT_TIMESTAMP
    FROM pg_stat_activity
    WHERE state = 'idle'
    
    UNION ALL
    
    SELECT 
        'database_size'::VARCHAR(100),
        pg_database_size('congress_api')::NUMERIC,
        'bytes'::VARCHAR(20),
        CURRENT_TIMESTAMP
    
    UNION ALL
    
    SELECT 
        'total_tables'::VARCHAR(100),
        count(*)::NUMERIC,
        'tables'::VARCHAR(20),
        CURRENT_TIMESTAMP
    FROM information_schema.tables
    WHERE table_schema = 'public'
    
    UNION ALL
    
    SELECT 
        'total_indexes'::VARCHAR(100),
        count(*)::NUMERIC,
        'indexes'::VARCHAR(20),
        CURRENT_TIMESTAMP
    FROM pg_indexes
    WHERE schemaname = 'public';
END;
$$ LANGUAGE plpgsql;

-- Function to get query performance statistics (alternative to pg_stat_statements)
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
    last_vacuum TIMESTAMP,
    last_analyze TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname || '.' || tablename as table_name,
        pg_total_relation_size(schemaname||'.'||tablename) as total_size,
        pg_relation_size(schemaname||'.'||tablename) as table_size,
        pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename) as index_size,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        last_vacuum,
        last_analyze
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to monitor slow queries through pg_stat_activity
CREATE OR REPLACE FUNCTION get_current_activity()
RETURNS TABLE(
    pid INTEGER,
    username TEXT,
    database_name TEXT,
    query_start TIMESTAMP,
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

-- ========================================
-- INDEX MONITORING FUNCTIONS
-- ========================================

-- Function to analyze index usage and efficiency
CREATE OR REPLACE FUNCTION get_index_usage_stats()
RETURNS TABLE(
    schema_name TEXT,
    table_name TEXT,
    index_name TEXT,
    index_size BIGINT,
    index_scans BIGINT,
    tuples_read BIGINT,
    tuples_fetched BIGINT,
    usage_ratio NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.schemaname::TEXT,
        s.tablename::TEXT,
        s.indexrelname::TEXT,
        pg_relation_size(s.indexrelid) as index_size,
        s.idx_scan as index_scans,
        s.idx_tup_read as tuples_read,
        s.idx_tup_fetch as tuples_fetched,
        CASE 
            WHEN s.idx_scan = 0 THEN 0
            ELSE ROUND((s.idx_tup_fetch::NUMERIC / NULLIF(s.idx_tup_read, 0)) * 100, 2)
        END as usage_ratio
    FROM pg_stat_user_indexes s
    JOIN pg_stat_user_tables t ON s.relid = t.relid
    WHERE s.schemaname = 'public'
    ORDER BY s.idx_scan DESC, pg_relation_size(s.indexrelid) DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to identify missing indexes
CREATE OR REPLACE FUNCTION identify_missing_indexes()
RETURNS TABLE(
    table_name TEXT,
    seq_scan BIGINT,
    seq_tup_read BIGINT,
    idx_scan BIGINT,
    seq_scan_ratio NUMERIC,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname || '.' || tablename as table_name,
        seq_scan,
        seq_tup_read,
        COALESCE(idx_scan, 0) as idx_scan,
        CASE 
            WHEN (seq_scan + COALESCE(idx_scan, 0)) = 0 THEN 0
            ELSE ROUND((seq_scan::NUMERIC / (seq_scan + COALESCE(idx_scan, 0))) * 100, 2)
        END as seq_scan_ratio,
        CASE 
            WHEN seq_scan > 1000 AND seq_tup_read > 100000 THEN 'Consider adding indexes - high sequential scan activity'
            WHEN seq_scan > 100 AND seq_tup_read / NULLIF(seq_scan, 0) > 10000 THEN 'Large table with frequent sequential scans'
            ELSE 'Index usage appears optimal'
        END as recommendation
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY seq_scan DESC, seq_tup_read DESC;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- DATA FRESHNESS MONITORING
-- ========================================

-- Enhanced sync health monitoring (extends existing function)
CREATE OR REPLACE FUNCTION get_detailed_sync_health()
RETURNS TABLE(
    entity_type VARCHAR(50),
    last_sync_time TIMESTAMP,
    last_successful_sync TIMESTAMP,
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

-- ========================================
-- CONNECTION MONITORING
-- ========================================

-- Function to monitor connection pool health
CREATE OR REPLACE FUNCTION get_connection_pool_stats()
RETURNS TABLE(
    metric_name TEXT,
    current_value BIGINT,
    threshold_warning BIGINT,
    threshold_critical BIGINT,
    status TEXT,
    recommendation TEXT
) AS $$
DECLARE
    max_connections_setting INTEGER;
BEGIN
    -- Get max_connections setting
    SELECT setting::INTEGER INTO max_connections_setting 
    FROM pg_settings WHERE name = 'max_connections';
    
    RETURN QUERY
    WITH connection_stats AS (
        SELECT 
            COUNT(*) as total_connections,
            COUNT(*) FILTER (WHERE state = 'active') as active_connections,
            COUNT(*) FILTER (WHERE state = 'idle') as idle_connections,
            COUNT(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
            COUNT(*) FILTER (WHERE backend_type = 'client backend') as client_connections
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
    )
    SELECT 
        'total_connections'::TEXT,
        cs.total_connections,
        (max_connections_setting * 0.7)::BIGINT as warning_threshold,
        (max_connections_setting * 0.9)::BIGINT as critical_threshold,
        CASE 
            WHEN cs.total_connections > (max_connections_setting * 0.9) THEN 'CRITICAL'
            WHEN cs.total_connections > (max_connections_setting * 0.7) THEN 'WARNING'
            ELSE 'HEALTHY'
        END::TEXT,
        CASE 
            WHEN cs.total_connections > (max_connections_setting * 0.9) THEN 'Immediate action: reduce connections or increase max_connections'
            WHEN cs.total_connections > (max_connections_setting * 0.7) THEN 'Monitor closely: consider connection pooling'
            ELSE 'Connection usage within normal limits'
        END::TEXT
    FROM connection_stats cs
    
    UNION ALL
    
    SELECT 
        'active_connections'::TEXT,
        cs.active_connections,
        20::BIGINT,
        50::BIGINT,
        CASE 
            WHEN cs.active_connections > 50 THEN 'CRITICAL'
            WHEN cs.active_connections > 20 THEN 'WARNING'
            ELSE 'HEALTHY'
        END::TEXT,
        CASE 
            WHEN cs.active_connections > 50 THEN 'High active connection count - investigate slow queries'
            WHEN cs.active_connections > 20 THEN 'Monitor query performance and connection patterns'
            ELSE 'Active connection count normal'
        END::TEXT
    FROM connection_stats cs
    
    UNION ALL
    
    SELECT 
        'idle_in_transaction'::TEXT,
        cs.idle_in_transaction,
        5::BIGINT,
        15::BIGINT,
        CASE 
            WHEN cs.idle_in_transaction > 15 THEN 'CRITICAL'
            WHEN cs.idle_in_transaction > 5 THEN 'WARNING'
            ELSE 'HEALTHY'
        END::TEXT,
        CASE 
            WHEN cs.idle_in_transaction > 15 THEN 'Critical: Many idle transactions - check application transaction management'
            WHEN cs.idle_in_transaction > 5 THEN 'Warning: Some idle transactions detected'
            ELSE 'Idle transaction count normal'
        END::TEXT
    FROM connection_stats cs;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- PERFORMANCE BASELINE TABLE
-- ========================================

-- Table to store performance baselines for comparison
CREATE TABLE IF NOT EXISTS performance_baselines (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    metric_unit VARCHAR(20),
    baseline_type VARCHAR(50) DEFAULT 'daily', -- daily, weekly, monthly
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_performance_baselines_metric_time 
ON performance_baselines(metric_name, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_performance_baselines_type_time 
ON performance_baselines(baseline_type, recorded_at DESC);

-- Function to record performance baseline
CREATE OR REPLACE FUNCTION record_performance_baseline(baseline_type VARCHAR(50) DEFAULT 'manual')
RETURNS INTEGER AS $$
DECLARE
    records_inserted INTEGER := 0;
    baseline_record RECORD;
BEGIN
    -- Insert current performance metrics as baseline
    FOR baseline_record IN 
        SELECT * FROM get_performance_baseline()
    LOOP
        INSERT INTO performance_baselines (metric_name, metric_value, metric_unit, baseline_type, notes)
        VALUES (
            baseline_record.metric_name,
            baseline_record.metric_value,
            baseline_record.metric_unit,
            baseline_type,
            'Automated baseline recording'
        );
        records_inserted := records_inserted + 1;
    END LOOP;
    
    RETURN records_inserted;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- COMPREHENSIVE HEALTH CHECK FUNCTION
-- ========================================

CREATE OR REPLACE FUNCTION get_database_health_summary()
RETURNS TABLE(
    check_category TEXT,
    check_name TEXT,
    status TEXT,
    current_value TEXT,
    threshold TEXT,
    recommendation TEXT,
    priority INTEGER
) AS $$
BEGIN
    RETURN QUERY
    -- Connection Health
    SELECT 
        'CONNECTIONS'::TEXT as check_category,
        cps.metric_name::TEXT as check_name,
        cps.status,
        cps.current_value::TEXT,
        'W:' || cps.threshold_warning || ' C:' || cps.threshold_critical as threshold,
        cps.recommendation,
        CASE cps.status
            WHEN 'CRITICAL' THEN 1
            WHEN 'WARNING' THEN 2
            ELSE 3
        END as priority
    FROM get_connection_pool_stats() cps
    
    UNION ALL
    
    -- Sync Health
    SELECT 
        'DATA_SYNC'::TEXT,
        dsh.entity_type::TEXT,
        dsh.health_status,
        ROUND(dsh.hours_since_sync, 1)::TEXT || ' hours ago',
        'Expected every ' || dsh.sync_frequency_hours::TEXT || ' hours',
        dsh.recommendation,
        CASE dsh.health_status
            WHEN 'CRITICAL' THEN 1
            WHEN 'WARNING' THEN 2
            WHEN 'NEVER_SYNCED' THEN 1
            ELSE 3
        END as priority
    FROM get_detailed_sync_health() dsh
    
    ORDER BY priority, check_category, check_name;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- PERFORMANCE OPTIMIZATION INDEXES
-- ========================================

-- Additional performance-critical indexes based on Congress API query patterns

-- Optimize bill searches by congress and date ranges
CREATE INDEX IF NOT EXISTS idx_bill_congress_introduced_desc 
ON bill(congress_id, introduced_date DESC);

-- Optimize sponsor-based searches
CREATE INDEX IF NOT EXISTS idx_bill_sponsor_name_gin 
ON bill USING gin(to_tsvector('english', sponsor_name)) 
WHERE sponsor_name IS NOT NULL;

-- Optimize action searches by bill and action type
CREATE INDEX IF NOT EXISTS idx_action_bill_type_date 
ON action(bill_id, action_type, action_date DESC) 
WHERE action_type IS NOT NULL;

-- Optimize committee activity searches
CREATE INDEX IF NOT EXISTS idx_bill_committee_activity_date_desc 
ON bill_committee_activity(activity_date DESC) 
WHERE activity_date IS NOT NULL;

-- Optimize cosponsor searches by member
CREATE INDEX IF NOT EXISTS idx_bill_cosponsor_member_party_state 
ON bill_cosponsor(bioguide_id, party, state) 
WHERE party IS NOT NULL AND state IS NOT NULL;

-- Optimize title searches
CREATE INDEX IF NOT EXISTS idx_bill_title_type_search 
ON bill_title(title_type_code, title) 
WHERE title_type_code IS NOT NULL;

-- Optimize summary searches by date
CREATE INDEX IF NOT EXISTS idx_bill_summary_action_date 
ON bill_summary(action_date DESC) 
WHERE action_date IS NOT NULL;

-- Optimize related bill searches
CREATE INDEX IF NOT EXISTS idx_bill_related_relationship_type 
ON bill_related(relationship_type, related_bill_congress) 
WHERE relationship_type IS NOT NULL;

-- Optimize hearing searches by date and chamber
CREATE INDEX IF NOT EXISTS idx_hearing_congress_chamber_date 
ON hearing(congress_id, chamber, updated_at DESC);

-- Optimize member term searches for current congress
CREATE INDEX IF NOT EXISTS idx_member_term_current_congress 
ON member_term(congress, chamber, party_code) 
WHERE congress >= 117; -- Current and recent congress

-- Add comment for tracking
COMMENT ON FUNCTION get_performance_baseline IS 'Database Foundation Phase 1: Performance baseline monitoring function';
COMMENT ON FUNCTION get_table_stats IS 'Database Foundation Phase 1: Table statistics monitoring';
COMMENT ON FUNCTION get_detailed_sync_health IS 'Database Foundation Phase 1: Enhanced sync health monitoring';
COMMENT ON FUNCTION get_connection_pool_stats IS 'Database Foundation Phase 1: Connection pool monitoring';
COMMENT ON FUNCTION get_database_health_summary IS 'Database Foundation Phase 1: Comprehensive health check';
COMMENT ON TABLE performance_baselines IS 'Database Foundation Phase 1: Performance baseline storage';