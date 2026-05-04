-- =============================================================================
-- Canonical database schema for the Congress API project.
--
-- This file is generated from `pg_dump --schema-only` against a known-good
-- production database. To set up a fresh database:
--
--   createdb congress_api
--   psql -d congress_api -f schema.sql
--
-- This is the single source of truth for the database structure. The
-- `backend/migrations/` and `migrations/` directories contain historical
-- migration files; they are kept for reference but should NOT be re-run
-- against a database initialized from this file.
--
-- Role/permission setup (creating congress_admin, congress_sync_writer,
-- congress_api_backend) is separate; see the project README.
-- =============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: bill_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bill_type AS ENUM (
    'hr',
    's',
    'hres',
    'sres',
    'hjres',
    'sjres',
    'hconres',
    'sconres'
);


--
-- Name: chamber; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chamber AS ENUM (
    'House',
    'Senate',
    'Joint',
    'NoChamber'
);


--
-- Name: communication_type_house; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.communication_type_house AS ENUM (
    'EC',
    'PM',
    'PT',
    'ML'
);


--
-- Name: communication_type_senate; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.communication_type_senate AS ENUM (
    'EC',
    'POM',
    'PM'
);


--
-- Name: cr_chamber_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cr_chamber_type AS ENUM (
    'H',
    'S',
    'E',
    'D'
);


--
-- Name: cr_section_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cr_section_type AS ENUM (
    'Senate',
    'House',
    'Extensions of Remarks',
    'Daily Digest'
);


--
-- Name: related_item_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.related_item_type AS ENUM (
    'bill',
    'treaty',
    'nomination'
);


--
-- Name: session_termination_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_termination_reason AS ENUM (
    'USER_LOGOUT',
    'TOKEN_EXPIRED',
    'ADMIN_REVOKED',
    'TIMEOUT'
);


--
-- Name: vote_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vote_result AS ENUM (
    'Passed',
    'Failed',
    'Agreed to',
    'Disagreed to'
);


--
-- Name: bill_summaries_need_update(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bill_summaries_need_update(p_bill_id character varying) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_bill_version VARCHAR(20);
    v_summary_version VARCHAR(20);
BEGIN
    -- Get current bill text version
    SELECT bill_text_version_code INTO v_bill_version
    FROM bill
    WHERE bill_id = p_bill_id;

    -- Get stored summary version (use any summary type, they should all be same version)
    SELECT text_version_code INTO v_summary_version
    FROM bill_ai_summary
    WHERE bill_id = p_bill_id
    LIMIT 1;

    -- If no summaries exist, they need to be generated
    IF v_summary_version IS NULL THEN
        RETURN TRUE;
    END IF;

    -- If bill has no version code, don't regenerate
    IF v_bill_version IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Compare versions
    RETURN v_bill_version != v_summary_version;
END;
$$;


--
-- Name: enforce_issue_volume_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_issue_volume_consistency() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: enforce_reference_bill_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_reference_bill_consistency() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: extract_chamber_from_page(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extract_chamber_from_page(page_ref text) RETURNS character varying
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE 
    WHEN page_ref ~ '^[Ss]\d+' THEN 'Senate'
    WHEN page_ref ~ '^[Hh]\d+' THEN 'House' 
    WHEN page_ref ~ '^[Ee]\d+' THEN 'Extensions'
    WHEN page_ref ~ '^[Dd]\d+' THEN 'Daily Digest'
    ELSE 'Unknown'
  END;
$$;


--
-- Name: extract_cr_references_from_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extract_cr_references_from_text(action_text text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    RETURN ARRAY(
        SELECT (regexp_matches(action_text, E'\\(CR\\s+([A-Z]\\d+)\\)', 'g'))[1]
    );
END;
$$;


--
-- Name: extract_page_number(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extract_page_number(page_text character varying) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
BEGIN
    -- Extract numeric part from formats like "H3218", "S1234", "3218"
    RETURN CASE 
        WHEN page_text ~ '^\d+$' THEN page_text::INTEGER
        WHEN page_text ~ '^\w\d+$' THEN SUBSTRING(page_text FROM '\d+')::INTEGER
        ELSE NULL
    END;
END;
$_$;


--
-- Name: find_articles_by_page_range(public.cr_chamber_type, character varying, character varying, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_articles_by_page_range(p_chamber public.cr_chamber_type, p_start_page character varying, p_end_page character varying DEFAULT NULL::character varying, p_issue_date date DEFAULT NULL::date) RETURNS TABLE(article_id bigint, title text, section_name public.cr_section_type, issue_date date, article_start_page character varying, article_end_page character varying)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: find_cr_article_by_page(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_cr_article_by_page(page_ref text) RETURNS TABLE(article_id bigint, title text, start_page character varying, end_page character varying, pdf_url text, text_url text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    target_chamber TEXT;
    target_page_num INTEGER;
BEGIN
    -- Extract chamber prefix (S, H, E, D) and page number
    target_chamber := REGEXP_REPLACE(page_ref, '\d+', '', 'g');
    target_page_num := extract_page_number(page_ref);
    
    -- Return null if we can't parse the page
    IF target_page_num IS NULL THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT 
        a.article_id,
        a.title,
        a.start_page,
        a.end_page,
        a.pdf_url,
        a.text_url
    FROM congressional_record_article a
    WHERE 
        -- Match chamber prefix
        REGEXP_REPLACE(a.start_page, '\d+', '', 'g') = target_chamber
        -- Check if target page falls within article range
        AND target_page_num >= extract_page_number(a.start_page)
        AND target_page_num <= COALESCE(
            extract_page_number(a.end_page), 
            extract_page_number(a.start_page)
        );
END;
$$;


--
-- Name: find_cr_article_by_page_enhanced(text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_cr_article_by_page_enhanced(page_ref text, bill_title text DEFAULT NULL::text, action_context text DEFAULT NULL::text, target_congress integer DEFAULT NULL::integer) RETURNS TABLE(article_id bigint, title text, start_page character varying, end_page character varying, pdf_url text, text_url text, volume_number integer, issue_number integer, issue_date date, congress integer, chamber character varying, confidence_score numeric, content_text text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    target_chamber VARCHAR(20);
    target_page_num INTEGER;
BEGIN
    -- Extract chamber and page number
    target_chamber := extract_chamber_from_page(page_ref);
    target_page_num := extract_page_number(page_ref);

    -- Return null if we can't parse the page
    IF target_page_num IS NULL OR target_chamber = 'Unknown' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        a.article_id,
        a.title,
        a.start_page,
        a.end_page,
        a.pdf_url,
        a.text_url,
        a.volume_number,
        a.issue_number,
        a.issue_date,
        a.congress,
        a.chamber,
        (
            -- Base page score: prioritize articles that start on the target page
            CASE WHEN a.start_page_number = target_page_num THEN 10 ELSE 5 END +

            -- CRITICAL: Congress matching score - highest priority
            CASE WHEN target_congress IS NOT NULL AND a.congress = target_congress THEN 100
                 WHEN target_congress IS NOT NULL AND a.congress IS NULL THEN 0
                 ELSE 0 
            END +

            -- Bill title keyword matching score
            CASE WHEN bill_title IS NOT NULL THEN
                (SELECT COALESCE(COUNT(*), 0) * 3
                 FROM unnest(
                     string_to_array(
                         regexp_replace(
                             lower(bill_title),
                             '\y(for|the|of|and|a|an|act|year|fiscal)\y',
                             '', 'g'
                         ),
                         ' '
                     )
                 ) as keyword
                 WHERE lower(a.title) LIKE '%' || trim(keyword) || '%'
                 AND length(trim(keyword)) > 2)
            ELSE 0 END +

            -- Action context matching score
            CASE WHEN action_context IS NOT NULL AND
                      lower(a.title) ILIKE '%' || lower(action_context) || '%'
                 THEN 5
                 ELSE 0
            END +

            -- Exact title match bonus
            CASE WHEN bill_title IS NOT NULL AND
                      lower(a.title) ILIKE '%' || lower(bill_title) || '%'
                 THEN 15
                 ELSE 0
            END
        )::NUMERIC as confidence_score,
        a.content_text
    FROM congressional_record_article a
    WHERE
        -- Use convenience fields for faster lookup
        a.chamber = target_chamber
        AND target_page_num >= a.start_page_number
        AND target_page_num <= COALESCE(a.end_page_number, a.start_page_number)
    ORDER BY
        confidence_score DESC,
        a.issue_date DESC,  -- Prefer newer articles when scores are equal
        a.start_page_number ASC;
END;
$$;


--
-- Name: get_bill_summaries(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_bill_summaries(p_bill_id character varying) RETURNS TABLE(summary_type character varying, content text, text_version_code character varying, model_used character varying, generated_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.summary_type,
        s.content,
        s.text_version_code,
        s.model_used,
        s.generated_at
    FROM bill_ai_summary s
    WHERE s.bill_id = p_bill_id
    ORDER BY
        CASE s.summary_type
            WHEN 'short' THEN 1
            WHEN 'realistic' THEN 2
            WHEN 'optimistic' THEN 3
            WHEN 'cynical' THEN 4
        END;
END;
$$;


--
-- Name: get_connection_pool_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_connection_pool_stats() RETURNS TABLE(metric_name text, current_value bigint, threshold_warning bigint, threshold_critical bigint, status text, recommendation text)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION get_connection_pool_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_connection_pool_stats() IS 'Database Foundation Phase 1: Connection pool monitoring';


--
-- Name: get_current_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_activity() RETURNS TABLE(pid integer, username text, database_name text, query_start timestamp with time zone, query_duration interval, state text, query_preview text)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: get_database_health_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_database_health_summary() RETURNS TABLE(check_category text, check_name text, status text, current_value text, threshold text, recommendation text, priority integer)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION get_database_health_summary(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_database_health_summary() IS 'Database Foundation Phase 1: Comprehensive health check';


--
-- Name: get_detailed_sync_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_detailed_sync_health() RETURNS TABLE(entity_type character varying, last_sync_time timestamp with time zone, last_successful_sync timestamp with time zone, hours_since_sync numeric, sync_frequency_hours numeric, error_status text, record_count bigint, health_status text, recommendation text)
    LANGUAGE plpgsql
    AS $$
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
            CASE 
                WHEN ss.error_message IS NOT NULL THEN 'ERROR: ' || LEFT(ss.error_message, 100)
                ELSE 'SUCCESS'
            END as error_status,
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
        sa.error_status::TEXT,
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
$$;


--
-- Name: get_index_usage_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_index_usage_stats() RETURNS TABLE(schema_name text, table_name text, index_name text, index_size bigint, index_scans bigint, tuples_read bigint, tuples_fetched bigint, usage_ratio numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.schemaname::TEXT,
        t.relname::TEXT as table_name,
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
$$;


--
-- Name: get_performance_baseline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_performance_baseline() RETURNS TABLE(metric_name character varying, metric_value numeric, metric_unit character varying, timestamp_recorded timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: get_sync_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sync_health() RETURNS TABLE(entity_type character varying, status text, hours_since_sync numeric, last_error text, health_status text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.entity_type,
        CASE
            WHEN s.error_message IS NULL THEN 'success'
            ELSE 'failed'
        END::TEXT AS status,
        CASE 
            WHEN s.last_successful_sync IS NOT NULL THEN 
                ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - s.last_successful_sync)) / 3600, 1)
            ELSE NULL
        END AS hours_since_sync,
        s.error_message AS last_error,
        CASE
            WHEN s.last_successful_sync IS NULL THEN 'never_synced'
            WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - s.last_successful_sync)) > 86400 THEN 'stale'
            WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - s.last_successful_sync)) > 43200 THEN 'warning'
            ELSE 'healthy'
        END::TEXT AS health_status
    FROM latest_sync_status s;
END;
$$;


--
-- Name: FUNCTION get_sync_health(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_sync_health() IS 'Returns health status of all sync operations';


--
-- Name: get_table_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_table_stats() RETURNS TABLE(table_name character varying, total_size bigint, table_size bigint, index_size bigint, seq_scan bigint, seq_tup_read bigint, idx_scan bigint, idx_tup_fetch bigint, n_tup_ins bigint, n_tup_upd bigint, n_tup_del bigint, last_vacuum timestamp with time zone, last_analyze timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: get_user_followed_bills(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_followed_bills(p_user_id character varying) RETURNS TABLE(bill_id character varying, title text, bill_type character varying, bill_number character varying, latest_action_date date, latest_action_text text, followed_at timestamp with time zone, notify boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.bill_id,
        b.title,
        b.bill_type::VARCHAR,
        b.bill_number,
        b.latest_action_date,
        b.latest_action_text,
        uf.created_at,
        uf.notify
    FROM user_follow uf
    JOIN bill b ON uf.follow_target_id = b.bill_id
    WHERE uf.user_id = p_user_id
      AND uf.follow_type = 'bill'
    ORDER BY uf.created_at DESC;
END;
$$;


--
-- Name: FUNCTION get_user_followed_bills(p_user_id character varying); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_followed_bills(p_user_id character varying) IS 'Returns all bills followed by a specific user with bill details';


--
-- Name: identify_missing_indexes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.identify_missing_indexes() RETURNS TABLE(table_name text, seq_scan bigint, seq_tup_read bigint, idx_scan bigint, seq_scan_ratio numeric, recommendation text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (st.schemaname || '.' || st.relname)::TEXT as table_name,
        st.seq_scan,
        st.seq_tup_read,
        COALESCE(st.idx_scan, 0) as idx_scan,
        CASE 
            WHEN (st.seq_scan + COALESCE(st.idx_scan, 0)) = 0 THEN 0
            ELSE ROUND((st.seq_scan::NUMERIC / (st.seq_scan + COALESCE(st.idx_scan, 0))) * 100, 2)
        END as seq_scan_ratio,
        CASE 
            WHEN st.seq_scan > 1000 AND st.seq_tup_read > 100000 THEN 'Consider adding indexes - high sequential scan activity'
            WHEN st.seq_scan > 100 AND st.seq_tup_read / NULLIF(st.seq_scan, 0) > 10000 THEN 'Large table with frequent sequential scans'
            ELSE 'Index usage appears optimal'
        END as recommendation
    FROM pg_stat_user_tables st
    WHERE st.schemaname = 'public'
    ORDER BY st.seq_scan DESC, st.seq_tup_read DESC;
END;
$$;


--
-- Name: populate_article_convenience_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.populate_article_convenience_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  vol_num INTEGER;
  iss_num INTEGER;
  iss_date DATE;
  congress_num INTEGER;
BEGIN
  -- Get volume, issue, date, and congress from related tables
  SELECT 
    v.volume_number,
    i.issue_number, 
    i.issue_date,
    i.congress
  INTO vol_num, iss_num, iss_date, congress_num
  FROM congressional_record_section s
  JOIN congressional_record_issue i ON s.issue_id = i.issue_id
  JOIN congressional_record_volume v ON i.volume_id = v.volume_id
  WHERE s.section_id = NEW.section_id;
  
  -- Populate convenience fields
  NEW.volume_number := vol_num;
  NEW.issue_number := iss_num;
  NEW.issue_date := iss_date;
  NEW.congress := congress_num;
  NEW.chamber := extract_chamber_from_page(NEW.start_page);
  NEW.start_page_number := extract_page_number(NEW.start_page);
  NEW.end_page_number := CASE 
    WHEN NEW.end_page IS NOT NULL THEN extract_page_number(NEW.end_page)
    ELSE extract_page_number(NEW.start_page)
  END;
  
  RETURN NEW;
END;
$$;


--
-- Name: record_performance_baseline(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_performance_baseline(baseline_type character varying DEFAULT 'manual'::character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: search_bills_only(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_bills_only(search_query text, result_limit integer DEFAULT NULL::integer) RETURNS TABLE(bill_id text, title text, policy_area text, rank real, snippet text, congress_id integer, introduced_date date)
    LANGUAGE plpgsql
    AS $$
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
    LIMIT result_limit;  -- NULL means no limit
END;
$$;


--
-- Name: search_bills_only_filtered(text, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_bills_only_filtered(search_query text, result_limit integer DEFAULT NULL::integer, filter_congress integer DEFAULT NULL::integer, filter_sponsor text DEFAULT NULL::text, filter_status text DEFAULT NULL::text) RETURNS TABLE(bill_id text, title text, policy_area text, rank real, snippet text, congress_id integer, introduced_date date)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: search_congressional_content(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_congressional_content(search_query text, result_limit integer DEFAULT NULL::integer) RETURNS TABLE(entity_type text, entity_id text, title text, rank real, snippet text, congress_id integer, date_field date)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: search_congressional_content_filtered(text, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_congressional_content_filtered(search_query text, result_limit integer DEFAULT 50, filter_congress integer DEFAULT NULL::integer, filter_sponsor text DEFAULT NULL::text, filter_status text DEFAULT NULL::text) RETURNS TABLE(entity_type text, entity_id text, type text, number text, chamber text, jacketnumber text, congress_id integer, title text, rank real, snippet text, date_field date, sponsor text, latest_action text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH search_results AS (
        -- Search bills
        SELECT
            'bill'::TEXT as entity_type,
            b.bill_id::TEXT as entity_id,
            b.bill_type::TEXT as type,
            b.bill_number::TEXT as number,
            NULL::TEXT as chamber,
            NULL::TEXT as jacketNumber,
            b.congress_id::INT,
            COALESCE(b.title, '')::TEXT as title,
            ts_rank_cd(b.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english',
                COALESCE(b.title, '') || ' ' ||
                COALESCE(b.policy_area, '') || ' ' ||
                COALESCE(b.latest_action_text, ''),
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            b.introduced_date::DATE as date_field,
            COALESCE(m.first_name || ' ' || m.last_name, '')::TEXT as sponsor,
            COALESCE(b.latest_action_text, '')::TEXT as latest_action
        FROM bill b
        LEFT JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
        LEFT JOIN member m ON bs.member_bioguide_id = m.bioguide_id
        WHERE b.search_vector @@ plainto_tsquery('english', search_query)
            AND (filter_congress IS NULL OR b.congress_id = filter_congress)
            AND (filter_sponsor IS NULL OR (m.first_name || ' ' || m.last_name) ILIKE '%' || filter_sponsor || '%')
            AND (filter_status IS NULL OR b.latest_action_text ILIKE '%' || filter_status || '%')

        UNION ALL

        -- Search hearings
        SELECT
            'hearing'::TEXT as entity_type,
            h.jacket_number::TEXT as entity_id,
            NULL::TEXT as type,
            NULL::TEXT as number,
            h.chamber::TEXT as chamber,
            h.jacket_number::TEXT as jacketNumber,
            h.congress_id::INT,
            COALESCE(h.title, '')::TEXT as title,
            ts_rank_cd(h.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english',
                COALESCE(h.title, '') || ' ' ||
                COALESCE(h.citation, ''),
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            NULL::DATE as date_field,  -- hearings don't have a single date
            ''::TEXT as sponsor,       -- hearings don't have sponsors
            ''::TEXT as latest_action  -- hearings don't have actions
        FROM hearing h
        WHERE h.search_vector @@ plainto_tsquery('english', search_query)
            AND (filter_congress IS NULL OR h.congress_id = filter_congress)
            -- Note: sponsor and status filters don't apply to hearings

        UNION ALL

        -- Search committee reports
        SELECT
            'committee_report'::TEXT as entity_type,
            cr.report_id::TEXT as entity_id,
            NULL::TEXT as type,
            NULL::TEXT as number,
            NULL::TEXT as chamber,
            NULL::TEXT as jacketNumber,
            cr.congress_id::INT,
            COALESCE(cr.citation, '')::TEXT as title,
            ts_rank_cd(cr.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english',
                COALESCE(cr.citation, ''),
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            cr.issue_date::DATE as date_field,
            ''::TEXT as sponsor,       -- committee reports don't have sponsors
            ''::TEXT as latest_action  -- committee reports don't have actions
        FROM committee_report cr
        WHERE cr.search_vector @@ plainto_tsquery('english', search_query)
            AND (filter_congress IS NULL OR cr.congress_id = filter_congress)
            -- Note: sponsor and status filters don't apply to committee reports

        UNION ALL

        -- Search actions
        SELECT
            'action'::TEXT as entity_type,
            a.action_id::TEXT as entity_id,
            NULL::TEXT as type,
            NULL::TEXT as number,
            NULL::TEXT as chamber,
            NULL::TEXT as jacketNumber,
            -- Get congress_id from related bill if available
            COALESCE(
                (SELECT b.congress_id FROM bill b WHERE b.bill_id = a.bill_id),
                118  -- default to current congress
            )::INT as congress_id,
            COALESCE(LEFT(a.text, 100), 'Legislative Action')::TEXT as title,
            ts_rank_cd(a.search_vector, plainto_tsquery('english', search_query))::REAL as rank,
            ts_headline('english',
                COALESCE(a.text, ''),
                plainto_tsquery('english', search_query),
                'MaxFragments=1,MaxWords=30,MinWords=10'
            )::TEXT as snippet,
            a.action_date::DATE as date_field,
            -- Get sponsor from related bill
            COALESCE(
                (SELECT m.first_name || ' ' || m.last_name 
                 FROM bill b 
                 JOIN bill_sponsor bs ON b.bill_id = bs.bill_id 
                 JOIN member m ON bs.member_bioguide_id = m.bioguide_id 
                 WHERE b.bill_id = a.bill_id), 
                ''
            )::TEXT as sponsor,
            COALESCE(a.text, '')::TEXT as latest_action
        FROM action a
        WHERE a.search_vector @@ plainto_tsquery('english', search_query)
            AND (filter_congress IS NULL OR 
                 COALESCE((SELECT b.congress_id FROM bill b WHERE b.bill_id = a.bill_id), 118) = filter_congress)
            AND (filter_sponsor IS NULL OR 
                 EXISTS (SELECT 1 FROM bill b 
                        JOIN bill_sponsor bs ON b.bill_id = bs.bill_id 
                        JOIN member m ON bs.member_bioguide_id = m.bioguide_id 
                        WHERE b.bill_id = a.bill_id 
                        AND (m.first_name || ' ' || m.last_name) ILIKE '%' || filter_sponsor || '%'))
            AND (filter_status IS NULL OR a.text ILIKE '%' || filter_status || '%')
    )
    SELECT
        sr.entity_type,
        sr.entity_id,
        sr.type,
        sr.number,
        sr.chamber,
        sr.jacketNumber,
        sr.congress_id,
        sr.title,
        sr.rank,
        sr.snippet,
        sr.date_field,
        sr.sponsor,
        sr.latest_action
    FROM search_results sr
    ORDER BY sr.rank DESC
    LIMIT result_limit;
END;
$$;


--
-- Name: to_prefix_tsquery(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.to_prefix_tsquery(query_text text) RETURNS tsquery
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    RETURN to_prefix_tsquery('english'::regconfig, query_text);
END;
$$;


--
-- Name: to_prefix_tsquery(regconfig, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.to_prefix_tsquery(config regconfig, query_text text) RETURNS tsquery
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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
$$;


--
-- Name: update_action_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_action_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Use text (weight B)
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.text, '')), 'B');
    
    RETURN NEW;
END;
$$;


--
-- Name: update_bill_ai_summary_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_bill_ai_summary_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_bill_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_bill_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: update_bill_search_vector_enhanced(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_bill_search_vector_enhanced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Enhanced search vector that includes:
    -- Weight A (highest): title, policy_area, bill_number
    -- Weight B (high): latest_action_text, sponsor names, cosponsor names
    -- Weight C (medium): sponsor state, cosponsor states
    -- Weight D (low): constitutional_authority_statement_text
    
    NEW.search_vector :=
        -- Weight A: Core bill information
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.policy_area, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.bill_number::text, '')), 'A') ||
        
        -- Weight B: Actions and sponsor/cosponsor names
        setweight(to_tsvector('english', COALESCE(NEW.latest_action_text, '')), 'B') ||
        -- Sponsor names
        setweight(to_tsvector('english', COALESCE(
            (SELECT string_agg(DISTINCT m.first_name || ' ' || m.last_name, ' ')
             FROM bill_sponsor bs 
             JOIN member m ON bs.member_bioguide_id = m.bioguide_id 
             WHERE bs.bill_id = NEW.bill_id), '')), 'B') ||
        -- Cosponsor names (NEW!)
        setweight(to_tsvector('english', COALESCE(
            (SELECT string_agg(DISTINCT bc.first_name || ' ' || bc.last_name, ' ')
             FROM bill_cosponsor bc 
             WHERE bc.bill_id = NEW.bill_id 
             AND bc.first_name IS NOT NULL 
             AND bc.last_name IS NOT NULL), '')), 'B') ||
        
        -- Weight C: Geographic information (sponsor and cosponsor states)
        -- Sponsor states
        setweight(to_tsvector('english', COALESCE(
            (SELECT string_agg(DISTINCT mt.state_name, ' ')
             FROM bill_sponsor bs 
             JOIN member m ON bs.member_bioguide_id = m.bioguide_id
             JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
             WHERE bs.bill_id = NEW.bill_id 
             AND mt.congress = NEW.congress_id), '')), 'C') ||
        -- Cosponsor states (NEW!)
        setweight(to_tsvector('english', COALESCE(
            (SELECT string_agg(DISTINCT s.state_name, ' ')
             FROM bill_cosponsor bc
             JOIN states s ON bc.state = s.state_code
             WHERE bc.bill_id = NEW.bill_id 
             AND bc.state IS NOT NULL), '')), 'C') ||
        
        -- Weight D: Constitutional authority text
        setweight(to_tsvector('english', COALESCE(NEW.constitutional_authority_statement_text, '')), 'D');

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION update_bill_search_vector_enhanced(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_bill_search_vector_enhanced() IS 'Enhanced search vector function that includes sponsor and cosponsor information (names and states) for comprehensive bill search functionality';


--
-- Name: update_chat_conversations_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_chat_conversations_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$;


--
-- Name: update_committee_meeting_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_committee_meeting_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.meeting_type, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.location_building, '')), 'C');
    RETURN NEW;
END;
$$;


--
-- Name: update_committee_report_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_committee_report_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Use citation (weight A)
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.citation, '')), 'A');
    
    RETURN NEW;
END;
$$;


--
-- Name: update_hearing_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_hearing_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Combine title (weight A) and citation (weight C)
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.citation, '')), 'C');
    
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: bill_ai_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_ai_summary (
    summary_id integer NOT NULL,
    bill_id character varying(50) NOT NULL,
    summary_type character varying(20) NOT NULL,
    content text NOT NULL,
    text_version_code character varying(50),
    model_used character varying(50) DEFAULT 'claude-3-5-haiku'::character varying,
    generated_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_summary_type CHECK (((summary_type)::text = ANY ((ARRAY['simple'::character varying, 'short'::character varying, 'optimistic'::character varying, 'cynical'::character varying, 'realistic'::character varying])::text[])))
);


--
-- Name: TABLE bill_ai_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill_ai_summary IS 'Stores AI-generated summaries for bills with multiple perspective types (short, optimistic, cynical, realistic). Summaries are regenerated when bill text version changes.';


--
-- Name: COLUMN bill_ai_summary.summary_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_ai_summary.summary_type IS 'Type of summary: short (one-sentence), optimistic (angel take), cynical (devil take), realistic (balanced)';


--
-- Name: COLUMN bill_ai_summary.text_version_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_ai_summary.text_version_code IS 'Bill text version code when summary was generated (IH=Introduced House, RH=Reported House, EAS=Engrossed Amendment Senate, ENR=Enrolled, etc.)';


--
-- Name: COLUMN bill_ai_summary.model_used; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_ai_summary.model_used IS 'AI model used to generate summary (e.g., claude-3-5-haiku)';


--
-- Name: upsert_bill_summary(character varying, character varying, text, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_bill_summary(p_bill_id character varying, p_summary_type character varying, p_content text, p_text_version_code character varying DEFAULT NULL::character varying, p_model_used character varying DEFAULT 'claude-3-5-haiku'::character varying) RETURNS public.bill_ai_summary
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_result bill_ai_summary;
BEGIN
    INSERT INTO bill_ai_summary (bill_id, summary_type, content, text_version_code, model_used)
    VALUES (p_bill_id, p_summary_type, p_content, p_text_version_code, p_model_used)
    ON CONFLICT (bill_id, summary_type)
    DO UPDATE SET
        content = EXCLUDED.content,
        text_version_code = EXCLUDED.text_version_code,
        model_used = EXCLUDED.model_used,
        updated_at = NOW()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


--
-- Name: action; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action (
    action_id integer NOT NULL,
    bill_id character varying(255),
    amendment_id character varying(255),
    nomination_id character varying(255),
    treaty_id character varying(255),
    action_date date,
    action_time time without time zone,
    action_code character varying(255),
    text text,
    type character varying(255),
    source_system_code integer,
    source_system_name character varying(255),
    calendar_number character varying(255),
    calendar_name character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    search_vector tsvector,
    action_type character varying(50),
    committees jsonb,
    recorded_votes jsonb
);


--
-- Name: TABLE action; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.action IS 'Stores legislative actions.';


--
-- Name: COLUMN action.search_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action.search_vector IS 'Full-text search vector for text (B)';


--
-- Name: action_action_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.action_action_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: action_action_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.action_action_id_seq OWNED BY public.action.action_id;


--
-- Name: action_backup_20251129; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_backup_20251129 (
    action_id integer,
    bill_id character varying(255),
    amendment_id character varying(255),
    nomination_id character varying(255),
    treaty_id character varying(255),
    action_date date,
    action_time time without time zone,
    action_code character varying(255),
    text text,
    type character varying(255),
    source_system_code integer,
    source_system_name character varying(255),
    calendar_number character varying(255),
    calendar_name character varying(255),
    created_at timestamp with time zone,
    search_vector tsvector,
    action_type character varying(50),
    committees jsonb,
    recorded_votes jsonb
);


--
-- Name: action_committee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_committee (
    action_id integer NOT NULL,
    committee_system_code character varying(255) NOT NULL
);


--
-- Name: TABLE action_committee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.action_committee IS 'Junction table for committees associated with a legislative action.';


--
-- Name: action_congressional_record_reference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_congressional_record_reference (
    reference_id bigint NOT NULL,
    action_id integer NOT NULL,
    bill_id character varying(255) NOT NULL,
    reference_text character varying(500) NOT NULL,
    chamber public.cr_chamber_type NOT NULL,
    start_page character varying(20) NOT NULL,
    end_page character varying(20),
    issue_id bigint,
    section_id bigint,
    article_id bigint,
    is_resolved boolean DEFAULT false NOT NULL,
    resolution_confidence numeric(3,2),
    resolution_notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT action_congressional_record_referen_resolution_confidence_check CHECK (((resolution_confidence >= (0)::numeric) AND (resolution_confidence <= (1)::numeric))),
    CONSTRAINT logical_resolution CHECK (((is_resolved = false) OR ((is_resolved = true) AND ((issue_id IS NOT NULL) OR (section_id IS NOT NULL))))),
    CONSTRAINT valid_page_format CHECK ((((start_page)::text ~ '^\w?\d+$'::text) AND ((end_page IS NULL) OR ((end_page)::text ~ '^\w?\d+$'::text))))
);


--
-- Name: TABLE action_congressional_record_reference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.action_congressional_record_reference IS 'References from bill actions to specific Congressional Record pages';


--
-- Name: COLUMN action_congressional_record_reference.is_resolved; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_congressional_record_reference.is_resolved IS 'Whether the page reference has been matched to actual CR content';


--
-- Name: COLUMN action_congressional_record_reference.resolution_confidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_congressional_record_reference.resolution_confidence IS 'Confidence score (0-1) for automated reference resolution';


--
-- Name: action_congressional_record_reference_reference_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.action_congressional_record_reference_reference_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: action_congressional_record_reference_reference_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.action_congressional_record_reference_reference_id_seq OWNED BY public.action_congressional_record_reference.reference_id;


--
-- Name: bill; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill (
    bill_id character varying(255) NOT NULL,
    congress_id integer NOT NULL,
    bill_type public.bill_type,
    bill_number character varying(255),
    origin_chamber public.chamber,
    title text,
    introduced_date date,
    latest_action_date date,
    latest_action_text text,
    policy_area character varying(255),
    constitutional_authority_statement_text text,
    api_update_date timestamp with time zone,
    api_update_date_including_text timestamp with time zone,
    notes jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    search_vector tsvector,
    origin_chamber_code character varying(1),
    law_type character varying(20),
    law_number character varying(20),
    congress_notes jsonb
);


--
-- Name: TABLE bill; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill IS 'Stores comprehensive information about bills and resolutions.';


--
-- Name: COLUMN bill.search_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill.search_vector IS 'Full-text search vector combining title (A), policy_area (A), latest_action_text (B), and constitutional_authority_statement_text (D)';


--
-- Name: bill_ai_summary_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_ai_summary_summary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_ai_summary_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_ai_summary_summary_id_seq OWNED BY public.bill_ai_summary.summary_id;


--
-- Name: bill_amendment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_amendment (
    amendment_id character varying(30) NOT NULL,
    bill_id character varying(20),
    amendment_number integer,
    congress integer,
    type character varying(10),
    description text,
    purpose text,
    latest_action_date date,
    latest_action_text text,
    latest_action_time time without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_cbo_estimate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_cbo_estimate (
    estimate_id integer NOT NULL,
    bill_id character varying(20),
    pub_date timestamp without time zone,
    title text,
    url text,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_cbo_estimate_estimate_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_cbo_estimate_estimate_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_cbo_estimate_estimate_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_cbo_estimate_estimate_id_seq OWNED BY public.bill_cbo_estimate.estimate_id;


--
-- Name: bill_committee_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_committee_activity (
    activity_id integer NOT NULL,
    bill_id character varying(255) NOT NULL,
    committee_system_code character varying(255) NOT NULL,
    activity_name text,
    activity_date timestamp with time zone,
    committee_name character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE bill_committee_activity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill_committee_activity IS 'Stores committee activities related to a bill.';


--
-- Name: bill_committee_activity_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_committee_activity_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_committee_activity_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_committee_activity_activity_id_seq OWNED BY public.bill_committee_activity.activity_id;


--
-- Name: bill_committee_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_committee_report (
    report_id integer NOT NULL,
    bill_id character varying(20),
    citation character varying(100),
    url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_committee_report_report_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_committee_report_report_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_committee_report_report_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_committee_report_report_id_seq OWNED BY public.bill_committee_report.report_id;


--
-- Name: congressional_record_article; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.congressional_record_article (
    article_id bigint NOT NULL,
    section_id bigint NOT NULL,
    title text NOT NULL,
    start_page character varying(20) NOT NULL,
    end_page character varying(20),
    pdf_url text,
    text_url text,
    content_text text,
    content_search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(content_text, ''::text)))) STORED,
    word_count integer,
    character_count integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    volume_number integer,
    issue_number integer,
    issue_date date,
    congress integer,
    chamber character varying(20),
    start_page_number integer,
    end_page_number integer,
    CONSTRAINT non_empty_title CHECK ((TRIM(BOTH FROM title) <> ''::text)),
    CONSTRAINT reasonable_content_length CHECK (((content_text IS NULL) OR (length(content_text) <= 10000000))),
    CONSTRAINT valid_article_pages CHECK (((start_page IS NOT NULL) AND ((end_page IS NULL) OR (((start_page)::text ~ '^\w?\d+$'::text) AND ((end_page)::text ~ '^\w?\d+$'::text)))))
);


--
-- Name: TABLE congressional_record_article; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.congressional_record_article IS 'Individual articles within sections, with full-text search capability';


--
-- Name: COLUMN congressional_record_article.content_search_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.content_search_vector IS 'Automatically maintained full-text search index';


--
-- Name: COLUMN congressional_record_article.volume_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.volume_number IS 'Congressional Record volume number (denormalized for performance)';


--
-- Name: COLUMN congressional_record_article.issue_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.issue_number IS 'Congressional Record issue number (denormalized for performance)';


--
-- Name: COLUMN congressional_record_article.issue_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.issue_date IS 'Date of the Congressional Record issue (denormalized for performance)';


--
-- Name: COLUMN congressional_record_article.congress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.congress IS 'Congress number (denormalized for performance)';


--
-- Name: COLUMN congressional_record_article.chamber; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.chamber IS 'Chamber type: Senate, House, Extensions, Daily Digest';


--
-- Name: COLUMN congressional_record_article.start_page_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.start_page_number IS 'Numeric part of start page for efficient sorting/filtering';


--
-- Name: COLUMN congressional_record_article.end_page_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.congressional_record_article.end_page_number IS 'Numeric part of end page for efficient sorting/filtering';


--
-- Name: congressional_record_issue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.congressional_record_issue (
    issue_id bigint NOT NULL,
    volume_id bigint NOT NULL,
    issue_number integer NOT NULL,
    issue_date date NOT NULL,
    congress smallint NOT NULL,
    session_number smallint NOT NULL,
    full_issue_url text,
    update_date date,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT congressional_record_issue_session_number_check CHECK ((session_number = ANY (ARRAY[1, 2]))),
    CONSTRAINT valid_issue_date CHECK ((issue_date >= '1873-03-04'::date))
);


--
-- Name: TABLE congressional_record_issue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.congressional_record_issue IS 'Daily issues within each Congressional Record volume';


--
-- Name: congressional_record_section; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.congressional_record_section (
    section_id bigint NOT NULL,
    issue_id bigint NOT NULL,
    name public.cr_section_type NOT NULL,
    start_page character varying(20) NOT NULL,
    end_page character varying(20),
    pdf_url text,
    text_url text,
    page_count integer GENERATED ALWAYS AS (
CASE
    WHEN (end_page IS NULL) THEN 1
    WHEN (((start_page)::text ~ '^\d+$'::text) AND ((end_page)::text ~ '^\d+$'::text)) THEN GREATEST(1, (((end_page)::integer - (start_page)::integer) + 1))
    ELSE NULL::integer
END) STORED,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_page_numbers CHECK (((start_page IS NOT NULL) AND ((end_page IS NULL) OR (((start_page)::text ~ '^\w?\d+$'::text) AND ((end_page)::text ~ '^\w?\d+$'::text)))))
);


--
-- Name: TABLE congressional_record_section; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.congressional_record_section IS 'Sections within each issue (Senate, House, Extensions, Daily Digest)';


--
-- Name: bill_congressional_record_references; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bill_congressional_record_references AS
 SELECT r.reference_id,
    r.bill_id,
    a.action_date,
    a.text AS action_text,
    r.reference_text,
    r.chamber,
    r.start_page,
    r.end_page,
    r.is_resolved,
    i.issue_date,
    i.congress,
    i.session_number,
    s.name AS section_name,
    art.title AS article_title,
    art.article_id,
    r.created_at
   FROM ((((public.action_congressional_record_reference r
     JOIN public.action a ON ((r.action_id = a.action_id)))
     LEFT JOIN public.congressional_record_issue i ON ((r.issue_id = i.issue_id)))
     LEFT JOIN public.congressional_record_section s ON ((r.section_id = s.section_id)))
     LEFT JOIN public.congressional_record_article art ON ((r.article_id = art.article_id)));


--
-- Name: bill_cosponsor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_cosponsor (
    bill_id character varying(255) NOT NULL,
    is_original_cosponsor boolean,
    bioguide_id character varying(10),
    full_name character varying(255),
    first_name character varying(100),
    middle_name character varying(100),
    last_name character varying(100),
    party character varying(10),
    state character varying(2),
    district integer,
    sponsorship_date date,
    sponsorship_withdrawn_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    cosponsor_id integer NOT NULL
);


--
-- Name: bill_cosponsor_cosponsor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_cosponsor_cosponsor_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_cosponsor_cosponsor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_cosponsor_cosponsor_id_seq OWNED BY public.bill_cosponsor.cosponsor_id;


--
-- Name: bill_law; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_law (
    law_id integer NOT NULL,
    bill_id character varying(20) NOT NULL,
    law_type character varying(50),
    law_number character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_law_law_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_law_law_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_law_law_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_law_law_id_seq OWNED BY public.bill_law.law_id;


--
-- Name: bill_news_mention; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_news_mention (
    mention_id integer NOT NULL,
    bill_id character varying(255),
    news_item_id integer,
    context text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bill_news_mention; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill_news_mention IS 'Links bills to news items that mention them';


--
-- Name: bill_news_mention_mention_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_news_mention_mention_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_news_mention_mention_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_news_mention_mention_id_seq OWNED BY public.bill_news_mention.mention_id;


--
-- Name: bill_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_note (
    note_id integer NOT NULL,
    bill_id character varying(20) NOT NULL,
    note_text text,
    links jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_note_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_note_note_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_note_note_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_note_note_id_seq OWNED BY public.bill_note.note_id;


--
-- Name: bill_related; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_related (
    related_id integer NOT NULL,
    bill_id character varying(20),
    related_bill_id character varying(20),
    related_bill_congress integer,
    related_bill_type character varying(10),
    related_bill_number integer,
    related_bill_title text,
    relationship_type character varying(100),
    identified_by character varying(10),
    latest_action_date date,
    latest_action_text text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_related_related_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_related_related_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_related_related_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_related_related_id_seq OWNED BY public.bill_related.related_id;


--
-- Name: bill_sponsor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_sponsor (
    bill_id character varying(255) NOT NULL,
    member_bioguide_id character varying(255) NOT NULL,
    sponsorship_date date,
    is_by_request boolean
);


--
-- Name: bill_search_performance_monitor; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bill_search_performance_monitor AS
 SELECT 'Enhanced Search Vector Function'::text AS component,
    count(*) AS total_bills,
    count(
        CASE
            WHEN (b.search_vector IS NOT NULL) THEN 1
            ELSE NULL::integer
        END) AS bills_with_search_vector,
    avg(length((b.search_vector)::text)) AS avg_search_vector_size,
    count(DISTINCT bs.member_bioguide_id) AS total_sponsors,
    count(DISTINCT bc.bioguide_id) AS total_cosponsors
   FROM ((public.bill b
     LEFT JOIN public.bill_sponsor bs ON (((b.bill_id)::text = (bs.bill_id)::text)))
     LEFT JOIN public.bill_cosponsor bc ON (((b.bill_id)::text = (bc.bill_id)::text)));


--
-- Name: VIEW bill_search_performance_monitor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.bill_search_performance_monitor IS 'Monitoring view for tracking the performance and coverage of the enhanced search vector function';


--
-- Name: bill_subject; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_subject (
    id integer NOT NULL,
    bill_id character varying(255) NOT NULL,
    subject_name text NOT NULL,
    is_policy_area boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE bill_subject; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill_subject IS 'Stores legislative subjects and policy areas for bills';


--
-- Name: COLUMN bill_subject.is_policy_area; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_subject.is_policy_area IS 'TRUE if this is the primary policy area, FALSE for regular subjects';


--
-- Name: bill_subject_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_subject_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_subject_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_subject_id_seq OWNED BY public.bill_subject.id;


--
-- Name: bill_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_summary (
    summary_id integer NOT NULL,
    bill_id character varying(255) NOT NULL,
    version_code character varying(10),
    action_date date,
    action_desc text,
    text text,
    api_update_date timestamp with time zone,
    update_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE bill_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill_summary IS 'Stores bill summaries.';


--
-- Name: bill_summary_enhanced; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_summary_enhanced (
    summary_id integer NOT NULL,
    bill_id character varying(255) NOT NULL,
    summary_type character varying(50) NOT NULL,
    content text NOT NULL,
    the_debate_supporters text,
    the_debate_critics text,
    affects_tags text[] DEFAULT '{}'::text[],
    generated_by character varying(50) DEFAULT 'manual'::character varying NOT NULL,
    confidence_score numeric(3,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_confidence_score CHECK (((confidence_score IS NULL) OR ((confidence_score >= 0.0) AND (confidence_score <= 1.0)))),
    CONSTRAINT chk_debate_fields CHECK (((((summary_type)::text = 'the_debate'::text) AND (the_debate_supporters IS NOT NULL) AND (the_debate_critics IS NOT NULL)) OR (((summary_type)::text <> 'the_debate'::text) AND (the_debate_supporters IS NULL) AND (the_debate_critics IS NULL)))),
    CONSTRAINT chk_generated_by CHECK (((generated_by)::text = ANY ((ARRAY['manual'::character varying, 'claude'::character varying, 'gpt4'::character varying, 'gemini'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT chk_summary_type CHECK (((summary_type)::text = ANY ((ARRAY['one_liner'::character varying, 'cocktail_party'::character varying, 'eli5'::character varying, 'the_debate'::character varying])::text[])))
);


--
-- Name: TABLE bill_summary_enhanced; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill_summary_enhanced IS 'AI-generated summaries and analysis for bills in various formats';


--
-- Name: COLUMN bill_summary_enhanced.summary_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_summary_enhanced.summary_type IS 'Type of summary: one_liner, cocktail_party, eli5, the_debate';


--
-- Name: COLUMN bill_summary_enhanced.the_debate_supporters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_summary_enhanced.the_debate_supporters IS 'What supporters say about the bill (only for the_debate type)';


--
-- Name: COLUMN bill_summary_enhanced.the_debate_critics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_summary_enhanced.the_debate_critics IS 'What critics say about the bill (only for the_debate type)';


--
-- Name: COLUMN bill_summary_enhanced.affects_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_summary_enhanced.affects_tags IS 'Array of topics/areas affected by the bill (e.g., healthcare, taxes, veterans)';


--
-- Name: COLUMN bill_summary_enhanced.generated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_summary_enhanced.generated_by IS 'AI model or method used to generate the summary';


--
-- Name: COLUMN bill_summary_enhanced.confidence_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bill_summary_enhanced.confidence_score IS 'Optional confidence score between 0.0 and 1.0';


--
-- Name: bill_summary_enhanced_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_summary_enhanced_summary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_summary_enhanced_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_summary_enhanced_summary_id_seq OWNED BY public.bill_summary_enhanced.summary_id;


--
-- Name: bill_summary_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_summary_summary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_summary_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_summary_summary_id_seq OWNED BY public.bill_summary.summary_id;


--
-- Name: bill_text_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_text_version (
    text_version_id integer NOT NULL,
    bill_id character varying(20),
    version_type character varying(100),
    version_date timestamp without time zone,
    formats jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_text_version_text_version_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_text_version_text_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_text_version_text_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_text_version_text_version_id_seq OWNED BY public.bill_text_version.text_version_id;


--
-- Name: bill_title; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_title (
    title_id integer NOT NULL,
    bill_id character varying(255) NOT NULL,
    title_type text,
    title text,
    chamber_code character varying(1),
    chamber_name character varying(255),
    bill_text_version_name text,
    bill_text_version_code character varying(10),
    title_type_code character varying(10),
    update_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE bill_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bill_title IS 'Stores the various titles associated with a bill.';


--
-- Name: bill_title_title_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_title_title_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_title_title_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_title_title_id_seq OWNED BY public.bill_title.title_id;


--
-- Name: chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bill_type character varying(10),
    bill_number character varying(20),
    bill_congress character varying(10),
    bill_title text,
    jacket_number character varying(50),
    provider character varying(50) NOT NULL,
    model character varying(100) NOT NULL,
    context_config jsonb NOT NULL,
    context_data jsonb NOT NULL,
    token_count integer DEFAULT 0,
    is_hearing boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    token_count integer DEFAULT 0,
    token_usage jsonb,
    streaming boolean DEFAULT false,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chat_messages_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: chat_conversation_summaries; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.chat_conversation_summaries AS
 SELECT c.id,
    c.bill_type,
    c.bill_number,
    c.bill_congress,
    c.bill_title,
    c.jacket_number,
    c.provider,
    c.model,
    c.is_hearing,
    c.created_at,
    c.updated_at,
    count(m.id) AS message_count,
    COALESCE(sum(m.token_count), (0)::bigint) AS total_message_tokens,
    c.token_count AS context_tokens,
    (COALESCE(sum(m.token_count), (0)::bigint) + c.token_count) AS total_tokens
   FROM (public.chat_conversations c
     LEFT JOIN public.chat_messages m ON ((c.id = m.conversation_id)))
  GROUP BY c.id, c.bill_type, c.bill_number, c.bill_congress, c.bill_title, c.jacket_number, c.provider, c.model, c.is_hearing, c.created_at, c.updated_at, c.token_count;


--
-- Name: committee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee (
    system_code character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    chamber public.chamber,
    committee_type_code character varying(255),
    is_current boolean,
    parent_committee_code character varying(255),
    api_update_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    website_url text,
    official_name character varying(500),
    library_of_congress_name character varying(255),
    start_date timestamp with time zone,
    establishing_authority character varying(500),
    loc_linked_data_id character varying(50),
    nara_id character varying(50),
    superintendent_document_number character varying(100)
);


--
-- Name: TABLE committee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee IS 'Stores detailed information about congressional committees.';


--
-- Name: committee_activity_quality_check; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.committee_activity_quality_check AS
 SELECT count(*) FILTER (WHERE (activity_date IS NULL)) AS activities_without_dates,
    count(*) FILTER (WHERE (activity_date IS NOT NULL)) AS activities_with_dates,
    count(*) AS total_activities,
    round((((count(*) FILTER (WHERE (activity_date IS NULL)))::numeric / (count(*))::numeric) * (100)::numeric), 2) AS null_date_percentage
   FROM public.bill_committee_activity;


--
-- Name: committee_meeting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_meeting (
    meeting_id integer NOT NULL,
    event_id character varying(50) NOT NULL,
    congress_id integer NOT NULL,
    chamber public.chamber NOT NULL,
    title text,
    meeting_date timestamp with time zone,
    meeting_type character varying(50),
    meeting_status character varying(50),
    location_building character varying(255),
    location_room character varying(100),
    api_update_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    search_vector tsvector
);


--
-- Name: TABLE committee_meeting; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_meeting IS 'Stores committee meetings from Congress.gov API with real-time scheduling and bill relationships.';


--
-- Name: COLUMN committee_meeting.event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.committee_meeting.event_id IS 'Unique event ID from Congress.gov (e.g., "336701")';


--
-- Name: COLUMN committee_meeting.meeting_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.committee_meeting.meeting_type IS 'Type of meeting: Meeting, Hearing, Markup, etc.';


--
-- Name: COLUMN committee_meeting.meeting_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.committee_meeting.meeting_status IS 'Status: Scheduled, Held, Cancelled, Postponed';


--
-- Name: committee_meeting_bill; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_meeting_bill (
    committee_meeting_bill_id integer NOT NULL,
    meeting_id integer NOT NULL,
    congress integer NOT NULL,
    bill_type character varying(20) NOT NULL,
    bill_number character varying(20) NOT NULL,
    bill_id character varying(50) GENERATED ALWAYS AS ((((((congress)::text || '-'::text) || upper((bill_type)::text)) || '-'::text) || (bill_number)::text)) STORED,
    bill_api_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE committee_meeting_bill; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_meeting_bill IS 'Links committee meetings to related legislation. Critical for enriching bill Legislative History.';


--
-- Name: COLUMN committee_meeting_bill.bill_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.committee_meeting_bill.bill_id IS 'Computed bill ID matching bill table format (e.g., "119-S-607") for easy JOINs';


--
-- Name: committee_meeting_bill_committee_meeting_bill_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.committee_meeting_bill_committee_meeting_bill_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: committee_meeting_bill_committee_meeting_bill_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.committee_meeting_bill_committee_meeting_bill_id_seq OWNED BY public.committee_meeting_bill.committee_meeting_bill_id;


--
-- Name: committee_meeting_committee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_meeting_committee (
    committee_meeting_committee_id integer NOT NULL,
    meeting_id integer NOT NULL,
    committee_name text NOT NULL,
    committee_system_code character varying(50),
    committee_api_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE committee_meeting_committee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_meeting_committee IS 'Links committee meetings to committees. Supports joint committee meetings.';


--
-- Name: committee_meeting_committee_committee_meeting_committee_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.committee_meeting_committee_committee_meeting_committee_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: committee_meeting_committee_committee_meeting_committee_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.committee_meeting_committee_committee_meeting_committee_id_seq OWNED BY public.committee_meeting_committee.committee_meeting_committee_id;


--
-- Name: committee_meeting_document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_meeting_document (
    committee_meeting_document_id integer NOT NULL,
    meeting_id integer NOT NULL,
    document_type character varying(100) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE committee_meeting_document; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_meeting_document IS 'Stores documents associated with committee meetings.';


--
-- Name: committee_meeting_document_committee_meeting_document_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.committee_meeting_document_committee_meeting_document_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: committee_meeting_document_committee_meeting_document_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.committee_meeting_document_committee_meeting_document_id_seq OWNED BY public.committee_meeting_document.committee_meeting_document_id;


--
-- Name: committee_meeting_meeting_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.committee_meeting_meeting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: committee_meeting_meeting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.committee_meeting_meeting_id_seq OWNED BY public.committee_meeting.meeting_id;


--
-- Name: committee_meeting_video; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_meeting_video (
    committee_meeting_video_id integer NOT NULL,
    meeting_id integer NOT NULL,
    video_name text,
    video_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE committee_meeting_video; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_meeting_video IS 'Stores video/webcast links for committee meetings.';


--
-- Name: committee_meeting_video_committee_meeting_video_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.committee_meeting_video_committee_meeting_video_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: committee_meeting_video_committee_meeting_video_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.committee_meeting_video_committee_meeting_video_id_seq OWNED BY public.committee_meeting_video.committee_meeting_video_id;


--
-- Name: committee_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_report (
    report_id character varying(255) NOT NULL,
    congress_id integer NOT NULL,
    report_type character varying(255),
    report_number character varying(255),
    citation text,
    part integer,
    is_conference_report boolean,
    issue_date date,
    api_update_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    search_vector tsvector,
    chamber character varying(10),
    title text,
    session_number integer,
    text_url text,
    text_count integer,
    committees jsonb,
    report_type_display character varying(50)
);


--
-- Name: TABLE committee_report; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_report IS 'Stores information about committee reports.';


--
-- Name: COLUMN committee_report.search_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.committee_report.search_vector IS 'Full-text search vector for citation (A)';


--
-- Name: COLUMN committee_report.report_type_display; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.committee_report.report_type_display IS 'Formatted display name for report type from Congress API reportType field (e.g., H.Rept., S.Rept.)';


--
-- Name: committee_report_bill; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_report_bill (
    report_id character varying(255) NOT NULL,
    bill_id character varying(255) NOT NULL
);


--
-- Name: TABLE committee_report_bill; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_report_bill IS 'Junction table to link committee reports to bills.';


--
-- Name: congress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.congress (
    congress_id integer NOT NULL,
    name character varying(255) NOT NULL,
    start_year integer,
    end_year integer,
    api_update_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE congress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.congress IS 'Stores information about each session of Congress.';


--
-- Name: congress_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.congress_session (
    session_id integer NOT NULL,
    congress_id integer NOT NULL,
    chamber public.chamber,
    type character varying(1),
    number integer,
    start_date date,
    end_date date
);


--
-- Name: TABLE congress_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.congress_session IS 'Stores session-specific data for each Congress.';


--
-- Name: congress_session_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.congress_session_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: congress_session_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.congress_session_session_id_seq OWNED BY public.congress_session.session_id;


--
-- Name: congressional_record_article_article_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.congressional_record_article_article_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: congressional_record_article_article_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.congressional_record_article_article_id_seq OWNED BY public.congressional_record_article.article_id;


--
-- Name: congressional_record_issue_issue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.congressional_record_issue_issue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: congressional_record_issue_issue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.congressional_record_issue_issue_id_seq OWNED BY public.congressional_record_issue.issue_id;


--
-- Name: congressional_record_volume; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.congressional_record_volume (
    volume_id bigint NOT NULL,
    volume_number integer NOT NULL,
    congress smallint NOT NULL,
    session_number smallint NOT NULL,
    year integer NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT congressional_record_volume_session_number_check CHECK ((session_number = ANY (ARRAY[1, 2]))),
    CONSTRAINT congressional_record_volume_year_check CHECK (((year >= 1873) AND ((year)::numeric <= (EXTRACT(year FROM CURRENT_DATE) + (1)::numeric)))),
    CONSTRAINT valid_congress_year CHECK (((year >= (1789 + ((congress - 1) * 2))) AND (year <= ((1789 + ((congress - 1) * 2)) + 1))))
);


--
-- Name: TABLE congressional_record_volume; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.congressional_record_volume IS 'Congressional Record volumes organized by Congress and session';


--
-- Name: congressional_record_search; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.congressional_record_search AS
 SELECT 'article'::text AS content_type,
    art.article_id AS content_id,
    art.title,
    art.content_text,
    s.name AS section_name,
    i.issue_date,
    i.congress,
    v.volume_number,
    art.start_page,
    art.end_page,
    art.content_search_vector
   FROM (((public.congressional_record_article art
     JOIN public.congressional_record_section s ON ((art.section_id = s.section_id)))
     JOIN public.congressional_record_issue i ON ((s.issue_id = i.issue_id)))
     JOIN public.congressional_record_volume v ON ((i.volume_id = v.volume_id)))
  WHERE (art.content_text IS NOT NULL);


--
-- Name: congressional_record_section_section_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.congressional_record_section_section_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: congressional_record_section_section_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.congressional_record_section_section_id_seq OWNED BY public.congressional_record_section.section_id;


--
-- Name: congressional_record_volume_volume_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.congressional_record_volume_volume_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: congressional_record_volume_volume_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.congressional_record_volume_volume_id_seq OWNED BY public.congressional_record_volume.volume_id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(255) NOT NULL,
    bill_congress integer NOT NULL,
    bill_type character varying(10) NOT NULL,
    bill_number character varying(20) NOT NULL,
    context_config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: hearing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hearing (
    jacket_number character varying(255) NOT NULL,
    congress_id integer NOT NULL,
    chamber public.chamber,
    number character varying(255),
    part character varying(255),
    title text,
    citation character varying(255),
    library_of_congress_identifier character varying(255),
    api_update_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    search_vector tsvector,
    hearing_id integer NOT NULL
);


--
-- Name: TABLE hearing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hearing IS 'Stores information about committee hearings.';


--
-- Name: COLUMN hearing.search_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing.search_vector IS 'Full-text search vector combining title (A) and citation (C)';


--
-- Name: hearing_committee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hearing_committee (
    hearing_committee_id integer NOT NULL,
    committee_name text NOT NULL,
    committee_system_code character varying(255),
    committee_api_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    hearing_id integer NOT NULL,
    CONSTRAINT chk_hearing_committee_api_url CHECK (((committee_api_url IS NULL) OR (committee_api_url ~ '^https?://.*'::text)))
);


--
-- Name: TABLE hearing_committee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hearing_committee IS 'Associates hearings with congressional committees. Supports both joint hearings and hearings by single committees.';


--
-- Name: COLUMN hearing_committee.committee_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_committee.committee_name IS 'Full committee name from Congress API (e.g., "Senate Banking, Housing, and Urban Affairs Committee")';


--
-- Name: COLUMN hearing_committee.committee_system_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_committee.committee_system_code IS 'Committee system code (e.g., "ssbk00"). May be NULL if not available from API.';


--
-- Name: COLUMN hearing_committee.committee_api_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_committee.committee_api_url IS 'Congress.gov API URL for the committee information';


--
-- Name: hearing_committee_hearing_committee_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hearing_committee_hearing_committee_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hearing_committee_hearing_committee_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hearing_committee_hearing_committee_id_seq OWNED BY public.hearing_committee.hearing_committee_id;


--
-- Name: hearing_date; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hearing_date (
    hearing_date_id integer NOT NULL,
    date date,
    hearing_id integer NOT NULL
);


--
-- Name: TABLE hearing_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hearing_date IS 'Stores the multiple dates a hearing may have occurred.';


--
-- Name: hearing_date_hearing_date_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hearing_date_hearing_date_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hearing_date_hearing_date_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hearing_date_hearing_date_id_seq OWNED BY public.hearing_date.hearing_date_id;


--
-- Name: hearing_format; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hearing_format (
    hearing_format_id integer NOT NULL,
    format_type character varying(100) NOT NULL,
    format_url text NOT NULL,
    file_size_bytes bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    hearing_id integer NOT NULL,
    CONSTRAINT chk_hearing_format_type CHECK (((format_type)::text = ANY ((ARRAY['PDF'::character varying, 'Formatted Text'::character varying, 'HTML'::character varying, 'XML'::character varying, 'TXT'::character varying, 'Other'::character varying])::text[]))),
    CONSTRAINT chk_hearing_format_url CHECK ((format_url ~ '^https?://.*'::text))
);


--
-- Name: TABLE hearing_format; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hearing_format IS 'Stores different format versions of hearing transcripts and documents.';


--
-- Name: COLUMN hearing_format.format_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_format.format_type IS 'Type of format (e.g., "PDF", "Formatted Text", "HTML")';


--
-- Name: COLUMN hearing_format.format_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_format.format_url IS 'Direct URL to download or access the format';


--
-- Name: COLUMN hearing_format.file_size_bytes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_format.file_size_bytes IS 'File size in bytes, if available from API response';


--
-- Name: hearing_format_hearing_format_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hearing_format_hearing_format_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hearing_format_hearing_format_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hearing_format_hearing_format_id_seq OWNED BY public.hearing_format.hearing_format_id;


--
-- Name: hearing_hearing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hearing_hearing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hearing_hearing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hearing_hearing_id_seq OWNED BY public.hearing.hearing_id;


--
-- Name: hearing_meeting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hearing_meeting (
    hearing_meeting_id integer NOT NULL,
    meeting_event_id character varying(255) NOT NULL,
    meeting_api_url text,
    relationship_type character varying(50) DEFAULT 'associated'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    hearing_id integer NOT NULL,
    CONSTRAINT chk_hearing_meeting_api_url CHECK (((meeting_api_url IS NULL) OR (meeting_api_url ~ '^https?://.*'::text)))
);


--
-- Name: TABLE hearing_meeting; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hearing_meeting IS 'Links hearings to their associated committee meetings for cross-referencing.';


--
-- Name: COLUMN hearing_meeting.meeting_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_meeting.meeting_event_id IS 'Meeting event ID from Congress.gov API (will reference committee_meeting.event_id when that table exists)';


--
-- Name: COLUMN hearing_meeting.meeting_api_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_meeting.meeting_api_url IS 'Congress.gov API URL for the associated meeting';


--
-- Name: COLUMN hearing_meeting.relationship_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hearing_meeting.relationship_type IS 'Type of relationship (e.g., "associated", "derived_from")';


--
-- Name: hearing_meeting_hearing_meeting_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hearing_meeting_hearing_meeting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hearing_meeting_hearing_meeting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hearing_meeting_hearing_meeting_id_seq OWNED BY public.hearing_meeting.hearing_meeting_id;


--
-- Name: sync_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_status (
    id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    last_sync_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_successful_sync timestamp with time zone,
    records_synced integer DEFAULT 0,
    records_failed integer DEFAULT 0,
    sync_duration_ms integer,
    error_message text,
    sync_metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE sync_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sync_status IS 'Tracks synchronization history for each entity type';


--
-- Name: COLUMN sync_status.entity_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.entity_type IS 'Type of entity being synced (bills, amendments, actions, etc.)';


--
-- Name: COLUMN sync_status.last_sync_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_sync_at IS 'Timestamp of the last sync attempt';


--
-- Name: COLUMN sync_status.last_successful_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_successful_sync IS 'Timestamp of the last successful sync';


--
-- Name: COLUMN sync_status.records_synced; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.records_synced IS 'Number of records successfully synced';


--
-- Name: COLUMN sync_status.records_failed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.records_failed IS 'Number of records that failed to sync';


--
-- Name: COLUMN sync_status.sync_duration_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.sync_duration_ms IS 'Duration of the sync operation in milliseconds';


--
-- Name: COLUMN sync_status.error_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.error_message IS 'Error message if sync failed';


--
-- Name: COLUMN sync_status.sync_metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.sync_metadata IS 'Additional metadata about the sync operation';


--
-- Name: latest_sync_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.latest_sync_status AS
 SELECT DISTINCT ON (entity_type) entity_type,
    last_sync_at,
    last_successful_sync,
    records_synced,
    records_failed,
    sync_duration_ms,
    error_message,
    sync_metadata,
        CASE
            WHEN (last_successful_sync IS NOT NULL) THEN (EXTRACT(epoch FROM (CURRENT_TIMESTAMP - last_successful_sync)) / (3600)::numeric)
            ELSE NULL::numeric
        END AS hours_since_sync,
        CASE
            WHEN (error_message IS NULL) THEN 'success'::text
            ELSE 'failed'::text
        END AS status
   FROM public.sync_status
  ORDER BY entity_type, last_sync_at DESC;


--
-- Name: VIEW latest_sync_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.latest_sync_status IS 'Shows the most recent sync status for each entity type';


--
-- Name: member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member (
    bioguide_id character varying(255) NOT NULL,
    first_name character varying(255),
    last_name character varying(255),
    middle_name character varying(255),
    suffix_name character varying(255),
    nickname character varying(255),
    direct_order_name character varying(255),
    inverted_order_name character varying(255),
    honorific_name character varying(255),
    birth_year integer,
    death_year integer,
    current_member boolean,
    depiction_url text,
    depiction_attribution text,
    official_url text,
    office_address text,
    phone_number character varying(255),
    api_update_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE member; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.member IS 'Stores detailed information about members of Congress.';


--
-- Name: member_address; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_address (
    address_id integer NOT NULL,
    member_bioguide_id character varying(255) NOT NULL,
    city character varying(255),
    district character varying(10),
    zip_code integer,
    address_type character varying(50) DEFAULT 'current'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_address_address_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_address_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_address_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_address_address_id_seq OWNED BY public.member_address.address_id;


--
-- Name: member_legislation_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_legislation_stats (
    stats_id integer NOT NULL,
    member_bioguide_id character varying(255) NOT NULL,
    congress integer NOT NULL,
    sponsored_legislation_count integer DEFAULT 0,
    cosponsored_legislation_count integer DEFAULT 0,
    sponsored_legislation_url text,
    cosponsored_legislation_url text,
    last_calculated timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT check_legislation_stats_positive CHECK (((sponsored_legislation_count >= 0) AND (cosponsored_legislation_count >= 0)))
);


--
-- Name: member_term; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_term (
    term_id integer NOT NULL,
    member_bioguide_id character varying(255) NOT NULL,
    congress integer,
    chamber public.chamber,
    member_type character varying(255),
    start_year integer,
    end_year integer,
    state_code character varying(2),
    state_name character varying(255),
    party_code character varying(10),
    party_name character varying(255),
    district integer
);


--
-- Name: TABLE member_term; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.member_term IS 'Normalized table for member terms of service.';


--
-- Name: member_api_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.member_api_view AS
 SELECT m.bioguide_id,
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
        CASE
            WHEN (ma.member_bioguide_id IS NOT NULL) THEN json_build_object('city', ma.city, 'district', ma.district, 'zipCode', ma.zip_code)
            ELSE '{}'::json
        END AS address_information,
    mt_current.state_name,
    mt_current.state_code,
    COALESCE(mls.sponsored_legislation_count, 0) AS sponsored_legislation_count,
    COALESCE(mls.cosponsored_legislation_count, 0) AS cosponsored_legislation_count,
    mls.sponsored_legislation_url,
    mls.cosponsored_legislation_url,
    m.api_update_date,
    m.created_at,
    m.updated_at
   FROM (((public.member m
     LEFT JOIN public.member_address ma ON ((((m.bioguide_id)::text = (ma.member_bioguide_id)::text) AND (ma.is_active = true) AND ((ma.address_type)::text = 'current'::text))))
     LEFT JOIN LATERAL ( SELECT mt.state_name,
            mt.state_code,
            mt.congress
           FROM public.member_term mt
          WHERE ((mt.member_bioguide_id)::text = (m.bioguide_id)::text)
          ORDER BY mt.congress DESC, mt.start_year DESC
         LIMIT 1) mt_current ON (true))
     LEFT JOIN LATERAL ( SELECT mls_inner.stats_id,
            mls_inner.member_bioguide_id,
            mls_inner.congress,
            mls_inner.sponsored_legislation_count,
            mls_inner.cosponsored_legislation_count,
            mls_inner.sponsored_legislation_url,
            mls_inner.cosponsored_legislation_url,
            mls_inner.last_calculated,
            mls_inner.created_at,
            mls_inner.updated_at
           FROM public.member_legislation_stats mls_inner
          WHERE ((mls_inner.member_bioguide_id)::text = (m.bioguide_id)::text)
          ORDER BY mls_inner.congress DESC
         LIMIT 1) mls ON (true));


--
-- Name: member_committee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_committee (
    member_bioguide_id character varying(255) NOT NULL,
    committee_system_code character varying(255) NOT NULL,
    congress_id integer NOT NULL,
    rank integer,
    title character varying(255)
);


--
-- Name: member_legislation_stats_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_legislation_stats_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_legislation_stats_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_legislation_stats_stats_id_seq OWNED BY public.member_legislation_stats.stats_id;


--
-- Name: member_party_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_party_history (
    party_history_id integer NOT NULL,
    member_bioguide_id character varying(255) NOT NULL,
    party_abbreviation character varying(10) NOT NULL,
    party_name character varying(255) NOT NULL,
    start_year integer NOT NULL,
    end_year integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT check_party_history_years CHECK (((end_year IS NULL) OR (end_year >= start_year)))
);


--
-- Name: member_party_history_party_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_party_history_party_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_party_history_party_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_party_history_party_history_id_seq OWNED BY public.member_party_history.party_history_id;


--
-- Name: member_previous_names; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_previous_names (
    previous_name_id integer NOT NULL,
    member_bioguide_id character varying(255) NOT NULL,
    first_name character varying(255),
    last_name character varying(255),
    middle_name character varying(255),
    suffix_name character varying(255),
    nickname character varying(255),
    direct_order_name character varying(255),
    inverted_order_name character varying(255),
    start_date date,
    end_date date,
    name_type character varying(50) DEFAULT 'legal'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT check_previous_names_dates CHECK (((end_date IS NULL) OR (end_date >= start_date)))
);


--
-- Name: member_previous_names_previous_name_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_previous_names_previous_name_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_previous_names_previous_name_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_previous_names_previous_name_id_seq OWNED BY public.member_previous_names.previous_name_id;


--
-- Name: member_term_term_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_term_term_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_term_term_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_term_term_id_seq OWNED BY public.member_term.term_id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    role character varying(10) NOT NULL,
    content text NOT NULL,
    prompt_tokens integer,
    completion_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    filename character varying(255) NOT NULL,
    executed_at timestamp with time zone DEFAULT now()
);


--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: news_analysis_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_analysis_log (
    analysis_id integer NOT NULL,
    analyzed_at timestamp with time zone DEFAULT now() NOT NULL,
    items_analyzed integer DEFAULT 0 NOT NULL,
    feed_errors jsonb DEFAULT '[]'::jsonb,
    trending_topics jsonb DEFAULT '{}'::jsonb,
    top_keywords jsonb DEFAULT '[]'::jsonb,
    direct_mentions_count integer DEFAULT 0,
    topical_matches_count integer DEFAULT 0,
    suggestions_generated jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE news_analysis_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.news_analysis_log IS 'Tracks each run of the news ingestion service';


--
-- Name: news_analysis_log_analysis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_analysis_log_analysis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_analysis_log_analysis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_analysis_log_analysis_id_seq OWNED BY public.news_analysis_log.analysis_id;


--
-- Name: news_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_item (
    item_id integer NOT NULL,
    guid character varying(500) NOT NULL,
    title text NOT NULL,
    link text,
    description text,
    source_name character varying(100) NOT NULL,
    pub_date timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    bill_mentions jsonb DEFAULT '[]'::jsonb,
    keywords jsonb DEFAULT '[]'::jsonb
);


--
-- Name: TABLE news_item; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.news_item IS 'Individual news items fetched from RSS feeds';


--
-- Name: news_item_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_item_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_item_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_item_item_id_seq OWNED BY public.news_item.item_id;


--
-- Name: performance_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.performance_baselines (
    id integer NOT NULL,
    metric_name character varying(100) NOT NULL,
    metric_value numeric NOT NULL,
    metric_unit character varying(20),
    baseline_type character varying(50) DEFAULT 'daily'::character varying,
    recorded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    notes text
);


--
-- Name: TABLE performance_baselines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.performance_baselines IS 'Database Foundation Phase 1: Performance baseline storage';


--
-- Name: performance_baselines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.performance_baselines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: performance_baselines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.performance_baselines_id_seq OWNED BY public.performance_baselines.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    migration_id character varying(255) NOT NULL,
    description text,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: search_index_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.search_index_stats AS
 SELECT 'bill'::text AS table_name,
    count(*) AS total_rows,
    count(*) FILTER (WHERE (bill.search_vector IS NOT NULL)) AS indexed_rows,
    round(((100.0 * (count(*) FILTER (WHERE (bill.search_vector IS NOT NULL)))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('public.bill'::regclass)) AS table_size
   FROM public.bill
UNION ALL
 SELECT 'hearing'::text AS table_name,
    count(*) AS total_rows,
    count(*) FILTER (WHERE (hearing.search_vector IS NOT NULL)) AS indexed_rows,
    round(((100.0 * (count(*) FILTER (WHERE (hearing.search_vector IS NOT NULL)))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('public.hearing'::regclass)) AS table_size
   FROM public.hearing
UNION ALL
 SELECT 'committee_report'::text AS table_name,
    count(*) AS total_rows,
    count(*) FILTER (WHERE (committee_report.search_vector IS NOT NULL)) AS indexed_rows,
    round(((100.0 * (count(*) FILTER (WHERE (committee_report.search_vector IS NOT NULL)))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('public.committee_report'::regclass)) AS table_size
   FROM public.committee_report
UNION ALL
 SELECT 'action'::text AS table_name,
    count(*) AS total_rows,
    count(*) FILTER (WHERE (action.search_vector IS NOT NULL)) AS indexed_rows,
    round(((100.0 * (count(*) FILTER (WHERE (action.search_vector IS NOT NULL)))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS index_coverage_percent,
    pg_size_pretty(pg_total_relation_size('public.action'::regclass)) AS table_size
   FROM public.action;


--
-- Name: VIEW search_index_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.search_index_stats IS 'Provides monitoring data for search index coverage and performance';


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    jti character varying(255) NOT NULL,
    start_time timestamp with time zone DEFAULT now() NOT NULL,
    end_time timestamp with time zone,
    termination_reason public.session_termination_reason,
    ip_address character varying(45) NOT NULL,
    user_agent character varying(512),
    geoip_country character varying(100),
    geoip_city character varying(100),
    activity_summary jsonb,
    last_activity_time timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;


--
-- Name: spotlight_bill; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spotlight_bill (
    spotlight_id integer NOT NULL,
    bill_id character varying(255) NOT NULL,
    headline character varying(500) NOT NULL,
    news_context text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    category character varying(50) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    created_by character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_category CHECK (((category)::text = ANY ((ARRAY['breaking'::character varying, 'trending'::character varying, 'upcoming_vote'::character varying, 'just_passed'::character varying])::text[]))),
    CONSTRAINT chk_dates CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT chk_priority CHECK ((priority >= 0))
);


--
-- Name: TABLE spotlight_bill; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.spotlight_bill IS 'Editorially curated bills that should be prominently displayed on the dashboard';


--
-- Name: COLUMN spotlight_bill.news_context; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.spotlight_bill.news_context IS 'Explanation of why this bill is currently newsworthy';


--
-- Name: COLUMN spotlight_bill.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.spotlight_bill.priority IS 'Higher values appear more prominently (0 = lowest priority)';


--
-- Name: COLUMN spotlight_bill.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.spotlight_bill.category IS 'Type of news relevance: breaking, trending, upcoming_vote, just_passed';


--
-- Name: spotlight_bill_spotlight_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spotlight_bill_spotlight_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spotlight_bill_spotlight_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spotlight_bill_spotlight_id_seq OWNED BY public.spotlight_bill.spotlight_id;


--
-- Name: states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.states (
    state_code character varying(2) NOT NULL,
    state_name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sync_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_status_id_seq OWNED BY public.sync_status.id;


--
-- Name: trending_topic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trending_topic (
    topic_id integer NOT NULL,
    topic_name character varying(100) NOT NULL,
    category character varying(50),
    score numeric(10,2) DEFAULT 0 NOT NULL,
    source_count integer DEFAULT 0,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: TABLE trending_topic; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trending_topic IS 'Tracks trending topics extracted from news feeds';


--
-- Name: trending_topic_topic_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trending_topic_topic_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trending_topic_topic_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trending_topic_topic_id_seq OWNED BY public.trending_topic.topic_id;


--
-- Name: user_follow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_follow (
    follow_id integer NOT NULL,
    user_id character varying(255) NOT NULL,
    follow_type character varying(50) NOT NULL,
    follow_target_id character varying(255) NOT NULL,
    notify boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_follow_type CHECK (((follow_type)::text = ANY ((ARRAY['bill'::character varying, 'topic'::character varying, 'member'::character varying])::text[])))
);


--
-- Name: TABLE user_follow; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_follow IS 'User follows for bills, topics, and members';


--
-- Name: COLUMN user_follow.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_follow.user_id IS 'User identifier (can be anonymous session ID or authenticated user ID)';


--
-- Name: COLUMN user_follow.follow_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_follow.follow_type IS 'Type of entity being followed: bill, topic, or member';


--
-- Name: COLUMN user_follow.follow_target_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_follow.follow_target_id IS 'The ID of the entity being followed (bill_id, topic name, or bioguide_id)';


--
-- Name: COLUMN user_follow.notify; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_follow.notify IS 'Whether user wants notifications for updates to this follow';


--
-- Name: user_follow_follow_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_follow_follow_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_follow_follow_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_follow_follow_id_seq OWNED BY public.user_follow.follow_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_active_spotlight_bills; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_active_spotlight_bills AS
 SELECT s.spotlight_id,
    s.bill_id,
    s.headline,
    s.news_context,
    s.priority,
    s.category,
    s.start_date,
    s.end_date,
    s.created_at,
    b.title,
    b.bill_type,
    b.bill_number,
    b.introduced_date,
    b.latest_action_date,
    b.latest_action_text,
    b.policy_area
   FROM (public.spotlight_bill s
     JOIN public.bill b ON (((s.bill_id)::text = (b.bill_id)::text)))
  WHERE ((s.is_active = true) AND ((s.start_date IS NULL) OR (s.start_date <= now())) AND ((s.end_date IS NULL) OR (s.end_date >= now())))
  ORDER BY s.priority DESC, s.created_at DESC;


--
-- Name: VIEW v_active_spotlight_bills; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_active_spotlight_bills IS 'Currently active spotlight bills with full bill details, ordered by priority';


--
-- Name: v_bill_summaries_complete; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_bill_summaries_complete AS
 SELECT bse.summary_id,
    bse.bill_id,
    bse.summary_type,
    bse.content,
    bse.the_debate_supporters,
    bse.the_debate_critics,
    bse.affects_tags,
    bse.generated_by,
    bse.confidence_score,
    bse.created_at,
    b.title,
    b.bill_type,
    b.bill_number,
    b.congress_id,
    b.introduced_date,
    b.policy_area
   FROM (public.bill_summary_enhanced bse
     JOIN public.bill b ON (((bse.bill_id)::text = (b.bill_id)::text)))
  ORDER BY bse.created_at DESC;


--
-- Name: VIEW v_bill_summaries_complete; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_bill_summaries_complete IS 'Enhanced bill summaries with complete bill details';


--
-- Name: action action_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action ALTER COLUMN action_id SET DEFAULT nextval('public.action_action_id_seq'::regclass);


--
-- Name: action_congressional_record_reference reference_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_congressional_record_reference ALTER COLUMN reference_id SET DEFAULT nextval('public.action_congressional_record_reference_reference_id_seq'::regclass);


--
-- Name: bill_ai_summary summary_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_ai_summary ALTER COLUMN summary_id SET DEFAULT nextval('public.bill_ai_summary_summary_id_seq'::regclass);


--
-- Name: bill_cbo_estimate estimate_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cbo_estimate ALTER COLUMN estimate_id SET DEFAULT nextval('public.bill_cbo_estimate_estimate_id_seq'::regclass);


--
-- Name: bill_committee_activity activity_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_activity ALTER COLUMN activity_id SET DEFAULT nextval('public.bill_committee_activity_activity_id_seq'::regclass);


--
-- Name: bill_committee_report report_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_report ALTER COLUMN report_id SET DEFAULT nextval('public.bill_committee_report_report_id_seq'::regclass);


--
-- Name: bill_cosponsor cosponsor_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cosponsor ALTER COLUMN cosponsor_id SET DEFAULT nextval('public.bill_cosponsor_cosponsor_id_seq'::regclass);


--
-- Name: bill_law law_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_law ALTER COLUMN law_id SET DEFAULT nextval('public.bill_law_law_id_seq'::regclass);


--
-- Name: bill_news_mention mention_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_news_mention ALTER COLUMN mention_id SET DEFAULT nextval('public.bill_news_mention_mention_id_seq'::regclass);


--
-- Name: bill_note note_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_note ALTER COLUMN note_id SET DEFAULT nextval('public.bill_note_note_id_seq'::regclass);


--
-- Name: bill_related related_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_related ALTER COLUMN related_id SET DEFAULT nextval('public.bill_related_related_id_seq'::regclass);


--
-- Name: bill_subject id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_subject ALTER COLUMN id SET DEFAULT nextval('public.bill_subject_id_seq'::regclass);


--
-- Name: bill_summary summary_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary ALTER COLUMN summary_id SET DEFAULT nextval('public.bill_summary_summary_id_seq'::regclass);


--
-- Name: bill_summary_enhanced summary_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary_enhanced ALTER COLUMN summary_id SET DEFAULT nextval('public.bill_summary_enhanced_summary_id_seq'::regclass);


--
-- Name: bill_text_version text_version_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_text_version ALTER COLUMN text_version_id SET DEFAULT nextval('public.bill_text_version_text_version_id_seq'::regclass);


--
-- Name: bill_title title_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_title ALTER COLUMN title_id SET DEFAULT nextval('public.bill_title_title_id_seq'::regclass);


--
-- Name: committee_meeting meeting_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting ALTER COLUMN meeting_id SET DEFAULT nextval('public.committee_meeting_meeting_id_seq'::regclass);


--
-- Name: committee_meeting_bill committee_meeting_bill_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_bill ALTER COLUMN committee_meeting_bill_id SET DEFAULT nextval('public.committee_meeting_bill_committee_meeting_bill_id_seq'::regclass);


--
-- Name: committee_meeting_committee committee_meeting_committee_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_committee ALTER COLUMN committee_meeting_committee_id SET DEFAULT nextval('public.committee_meeting_committee_committee_meeting_committee_id_seq'::regclass);


--
-- Name: committee_meeting_document committee_meeting_document_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_document ALTER COLUMN committee_meeting_document_id SET DEFAULT nextval('public.committee_meeting_document_committee_meeting_document_id_seq'::regclass);


--
-- Name: committee_meeting_video committee_meeting_video_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_video ALTER COLUMN committee_meeting_video_id SET DEFAULT nextval('public.committee_meeting_video_committee_meeting_video_id_seq'::regclass);


--
-- Name: congress_session session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congress_session ALTER COLUMN session_id SET DEFAULT nextval('public.congress_session_session_id_seq'::regclass);


--
-- Name: congressional_record_article article_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_article ALTER COLUMN article_id SET DEFAULT nextval('public.congressional_record_article_article_id_seq'::regclass);


--
-- Name: congressional_record_issue issue_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_issue ALTER COLUMN issue_id SET DEFAULT nextval('public.congressional_record_issue_issue_id_seq'::regclass);


--
-- Name: congressional_record_section section_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_section ALTER COLUMN section_id SET DEFAULT nextval('public.congressional_record_section_section_id_seq'::regclass);


--
-- Name: congressional_record_volume volume_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_volume ALTER COLUMN volume_id SET DEFAULT nextval('public.congressional_record_volume_volume_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: hearing hearing_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing ALTER COLUMN hearing_id SET DEFAULT nextval('public.hearing_hearing_id_seq'::regclass);


--
-- Name: hearing_committee hearing_committee_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_committee ALTER COLUMN hearing_committee_id SET DEFAULT nextval('public.hearing_committee_hearing_committee_id_seq'::regclass);


--
-- Name: hearing_date hearing_date_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_date ALTER COLUMN hearing_date_id SET DEFAULT nextval('public.hearing_date_hearing_date_id_seq'::regclass);


--
-- Name: hearing_format hearing_format_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_format ALTER COLUMN hearing_format_id SET DEFAULT nextval('public.hearing_format_hearing_format_id_seq'::regclass);


--
-- Name: hearing_meeting hearing_meeting_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_meeting ALTER COLUMN hearing_meeting_id SET DEFAULT nextval('public.hearing_meeting_hearing_meeting_id_seq'::regclass);


--
-- Name: member_address address_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_address ALTER COLUMN address_id SET DEFAULT nextval('public.member_address_address_id_seq'::regclass);


--
-- Name: member_legislation_stats stats_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_legislation_stats ALTER COLUMN stats_id SET DEFAULT nextval('public.member_legislation_stats_stats_id_seq'::regclass);


--
-- Name: member_party_history party_history_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_party_history ALTER COLUMN party_history_id SET DEFAULT nextval('public.member_party_history_party_history_id_seq'::regclass);


--
-- Name: member_previous_names previous_name_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_previous_names ALTER COLUMN previous_name_id SET DEFAULT nextval('public.member_previous_names_previous_name_id_seq'::regclass);


--
-- Name: member_term term_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_term ALTER COLUMN term_id SET DEFAULT nextval('public.member_term_term_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Name: news_analysis_log analysis_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_analysis_log ALTER COLUMN analysis_id SET DEFAULT nextval('public.news_analysis_log_analysis_id_seq'::regclass);


--
-- Name: news_item item_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_item ALTER COLUMN item_id SET DEFAULT nextval('public.news_item_item_id_seq'::regclass);


--
-- Name: performance_baselines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_baselines ALTER COLUMN id SET DEFAULT nextval('public.performance_baselines_id_seq'::regclass);


--
-- Name: sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);


--
-- Name: spotlight_bill spotlight_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spotlight_bill ALTER COLUMN spotlight_id SET DEFAULT nextval('public.spotlight_bill_spotlight_id_seq'::regclass);


--
-- Name: sync_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_status ALTER COLUMN id SET DEFAULT nextval('public.sync_status_id_seq'::regclass);


--
-- Name: trending_topic topic_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending_topic ALTER COLUMN topic_id SET DEFAULT nextval('public.trending_topic_topic_id_seq'::regclass);


--
-- Name: user_follow follow_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follow ALTER COLUMN follow_id SET DEFAULT nextval('public.user_follow_follow_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: action_committee action_committee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_committee
    ADD CONSTRAINT action_committee_pkey PRIMARY KEY (action_id, committee_system_code);


--
-- Name: action_congressional_record_reference action_congressional_record_reference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_congressional_record_reference
    ADD CONSTRAINT action_congressional_record_reference_pkey PRIMARY KEY (reference_id);


--
-- Name: action action_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action
    ADD CONSTRAINT action_pkey PRIMARY KEY (action_id);


--
-- Name: bill_ai_summary bill_ai_summary_bill_id_summary_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_ai_summary
    ADD CONSTRAINT bill_ai_summary_bill_id_summary_type_key UNIQUE (bill_id, summary_type);


--
-- Name: bill_ai_summary bill_ai_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_ai_summary
    ADD CONSTRAINT bill_ai_summary_pkey PRIMARY KEY (summary_id);


--
-- Name: bill_amendment bill_amendment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_amendment
    ADD CONSTRAINT bill_amendment_pkey PRIMARY KEY (amendment_id);


--
-- Name: bill_cbo_estimate bill_cbo_estimate_bill_id_pub_date_title_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cbo_estimate
    ADD CONSTRAINT bill_cbo_estimate_bill_id_pub_date_title_key UNIQUE (bill_id, pub_date, title);


--
-- Name: bill_cbo_estimate bill_cbo_estimate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cbo_estimate
    ADD CONSTRAINT bill_cbo_estimate_pkey PRIMARY KEY (estimate_id);


--
-- Name: bill_committee_activity bill_committee_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_activity
    ADD CONSTRAINT bill_committee_activity_pkey PRIMARY KEY (activity_id);


--
-- Name: bill_committee_activity bill_committee_activity_unique_sync; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_activity
    ADD CONSTRAINT bill_committee_activity_unique_sync UNIQUE (bill_id, committee_system_code, activity_name, activity_date);


--
-- Name: bill_committee_report bill_committee_report_bill_id_citation_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_report
    ADD CONSTRAINT bill_committee_report_bill_id_citation_key UNIQUE (bill_id, citation);


--
-- Name: bill_committee_report bill_committee_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_report
    ADD CONSTRAINT bill_committee_report_pkey PRIMARY KEY (report_id);


--
-- Name: bill_cosponsor bill_cosponsor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cosponsor
    ADD CONSTRAINT bill_cosponsor_pkey PRIMARY KEY (cosponsor_id);


--
-- Name: bill_cosponsor bill_cosponsor_unique_sync; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cosponsor
    ADD CONSTRAINT bill_cosponsor_unique_sync UNIQUE (bill_id, bioguide_id);


--
-- Name: bill_law bill_law_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_law
    ADD CONSTRAINT bill_law_pkey PRIMARY KEY (law_id);


--
-- Name: bill_law bill_law_unique_constraint; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_law
    ADD CONSTRAINT bill_law_unique_constraint UNIQUE (bill_id, law_type, law_number);


--
-- Name: bill_news_mention bill_news_mention_bill_id_news_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_news_mention
    ADD CONSTRAINT bill_news_mention_bill_id_news_item_id_key UNIQUE (bill_id, news_item_id);


--
-- Name: bill_news_mention bill_news_mention_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_news_mention
    ADD CONSTRAINT bill_news_mention_pkey PRIMARY KEY (mention_id);


--
-- Name: bill_note bill_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_note
    ADD CONSTRAINT bill_note_pkey PRIMARY KEY (note_id);


--
-- Name: bill bill_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill
    ADD CONSTRAINT bill_pkey PRIMARY KEY (bill_id);


--
-- Name: bill_related bill_related_bill_id_related_bill_id_relationship_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_related
    ADD CONSTRAINT bill_related_bill_id_related_bill_id_relationship_type_key UNIQUE (bill_id, related_bill_id, relationship_type);


--
-- Name: bill_related bill_related_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_related
    ADD CONSTRAINT bill_related_pkey PRIMARY KEY (related_id);


--
-- Name: bill_sponsor bill_sponsor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_sponsor
    ADD CONSTRAINT bill_sponsor_pkey PRIMARY KEY (bill_id);


--
-- Name: bill_subject bill_subject_bill_id_subject_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_subject
    ADD CONSTRAINT bill_subject_bill_id_subject_name_key UNIQUE (bill_id, subject_name);


--
-- Name: bill_subject bill_subject_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_subject
    ADD CONSTRAINT bill_subject_pkey PRIMARY KEY (id);


--
-- Name: bill_summary_enhanced bill_summary_enhanced_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary_enhanced
    ADD CONSTRAINT bill_summary_enhanced_pkey PRIMARY KEY (summary_id);


--
-- Name: bill_summary bill_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary
    ADD CONSTRAINT bill_summary_pkey PRIMARY KEY (summary_id);


--
-- Name: bill_summary bill_summary_unique_sync; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary
    ADD CONSTRAINT bill_summary_unique_sync UNIQUE (bill_id, version_code);


--
-- Name: bill_text_version bill_text_version_bill_id_version_type_version_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_text_version
    ADD CONSTRAINT bill_text_version_bill_id_version_type_version_date_key UNIQUE (bill_id, version_type, version_date);


--
-- Name: bill_text_version bill_text_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_text_version
    ADD CONSTRAINT bill_text_version_pkey PRIMARY KEY (text_version_id);


--
-- Name: bill_title bill_title_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_title
    ADD CONSTRAINT bill_title_pkey PRIMARY KEY (title_id);


--
-- Name: bill_title bill_title_unique_sync; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_title
    ADD CONSTRAINT bill_title_unique_sync UNIQUE (bill_id, title_type_code, title);


--
-- Name: chat_conversations chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: committee_meeting_bill committee_meeting_bill_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_bill
    ADD CONSTRAINT committee_meeting_bill_pkey PRIMARY KEY (committee_meeting_bill_id);


--
-- Name: committee_meeting_committee committee_meeting_committee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_committee
    ADD CONSTRAINT committee_meeting_committee_pkey PRIMARY KEY (committee_meeting_committee_id);


--
-- Name: committee_meeting_document committee_meeting_document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_document
    ADD CONSTRAINT committee_meeting_document_pkey PRIMARY KEY (committee_meeting_document_id);


--
-- Name: committee_meeting committee_meeting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting
    ADD CONSTRAINT committee_meeting_pkey PRIMARY KEY (meeting_id);


--
-- Name: committee_meeting_video committee_meeting_video_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_video
    ADD CONSTRAINT committee_meeting_video_pkey PRIMARY KEY (committee_meeting_video_id);


--
-- Name: committee committee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee
    ADD CONSTRAINT committee_pkey PRIMARY KEY (system_code);


--
-- Name: committee_report_bill committee_report_bill_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_report_bill
    ADD CONSTRAINT committee_report_bill_pkey PRIMARY KEY (report_id, bill_id);


--
-- Name: committee_report committee_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_report
    ADD CONSTRAINT committee_report_pkey PRIMARY KEY (report_id);


--
-- Name: congress congress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congress
    ADD CONSTRAINT congress_pkey PRIMARY KEY (congress_id);


--
-- Name: congress_session congress_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congress_session
    ADD CONSTRAINT congress_session_pkey PRIMARY KEY (session_id);


--
-- Name: congressional_record_article congressional_record_article_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_article
    ADD CONSTRAINT congressional_record_article_pkey PRIMARY KEY (article_id);


--
-- Name: congressional_record_issue congressional_record_issue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_issue
    ADD CONSTRAINT congressional_record_issue_pkey PRIMARY KEY (issue_id);


--
-- Name: congressional_record_section congressional_record_section_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_section
    ADD CONSTRAINT congressional_record_section_pkey PRIMARY KEY (section_id);


--
-- Name: congressional_record_volume congressional_record_volume_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_volume
    ADD CONSTRAINT congressional_record_volume_pkey PRIMARY KEY (volume_id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: hearing_committee hearing_committee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_committee
    ADD CONSTRAINT hearing_committee_pkey PRIMARY KEY (hearing_committee_id);


--
-- Name: hearing_date hearing_date_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_date
    ADD CONSTRAINT hearing_date_pkey PRIMARY KEY (hearing_date_id);


--
-- Name: hearing_format hearing_format_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_format
    ADD CONSTRAINT hearing_format_pkey PRIMARY KEY (hearing_format_id);


--
-- Name: hearing_meeting hearing_meeting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_meeting
    ADD CONSTRAINT hearing_meeting_pkey PRIMARY KEY (hearing_meeting_id);


--
-- Name: hearing hearing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing
    ADD CONSTRAINT hearing_pkey PRIMARY KEY (hearing_id);


--
-- Name: sync_status idx_sync_status_entity_type_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_status
    ADD CONSTRAINT idx_sync_status_entity_type_unique UNIQUE (entity_type, last_sync_at);


--
-- Name: member_address member_address_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_address
    ADD CONSTRAINT member_address_pkey PRIMARY KEY (address_id);


--
-- Name: member_committee member_committee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_committee
    ADD CONSTRAINT member_committee_pkey PRIMARY KEY (member_bioguide_id, committee_system_code, congress_id);


--
-- Name: member_legislation_stats member_legislation_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_legislation_stats
    ADD CONSTRAINT member_legislation_stats_pkey PRIMARY KEY (stats_id);


--
-- Name: member_party_history member_party_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_party_history
    ADD CONSTRAINT member_party_history_pkey PRIMARY KEY (party_history_id);


--
-- Name: member member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member
    ADD CONSTRAINT member_pkey PRIMARY KEY (bioguide_id);


--
-- Name: member_previous_names member_previous_names_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_previous_names
    ADD CONSTRAINT member_previous_names_pkey PRIMARY KEY (previous_name_id);


--
-- Name: member_term member_term_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_term
    ADD CONSTRAINT member_term_pkey PRIMARY KEY (term_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_filename_key UNIQUE (filename);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: news_analysis_log news_analysis_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_analysis_log
    ADD CONSTRAINT news_analysis_log_pkey PRIMARY KEY (analysis_id);


--
-- Name: news_item news_item_guid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_item
    ADD CONSTRAINT news_item_guid_key UNIQUE (guid);


--
-- Name: news_item news_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_item
    ADD CONSTRAINT news_item_pkey PRIMARY KEY (item_id);


--
-- Name: performance_baselines performance_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_baselines
    ADD CONSTRAINT performance_baselines_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (migration_id);


--
-- Name: sessions sessions_jti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_jti_key UNIQUE (jti);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: spotlight_bill spotlight_bill_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spotlight_bill
    ADD CONSTRAINT spotlight_bill_pkey PRIMARY KEY (spotlight_id);


--
-- Name: states states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_pkey PRIMARY KEY (state_code);


--
-- Name: states states_state_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_state_name_key UNIQUE (state_name);


--
-- Name: sync_status sync_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_status
    ADD CONSTRAINT sync_status_pkey PRIMARY KEY (id);


--
-- Name: trending_topic trending_topic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending_topic
    ADD CONSTRAINT trending_topic_pkey PRIMARY KEY (topic_id);


--
-- Name: trending_topic trending_topic_topic_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending_topic
    ADD CONSTRAINT trending_topic_topic_name_key UNIQUE (topic_name);


--
-- Name: action_congressional_record_reference unique_action_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_congressional_record_reference
    ADD CONSTRAINT unique_action_reference UNIQUE (action_id, reference_text);


--
-- Name: congressional_record_issue unique_issue_volume_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_issue
    ADD CONSTRAINT unique_issue_volume_number UNIQUE (volume_id, issue_number);


--
-- Name: member_term unique_member_term; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_term
    ADD CONSTRAINT unique_member_term UNIQUE (member_bioguide_id, congress, chamber);


--
-- Name: congressional_record_section unique_section_issue_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_section
    ADD CONSTRAINT unique_section_issue_name UNIQUE (issue_id, name);


--
-- Name: congressional_record_volume unique_volume_congress_session; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_volume
    ADD CONSTRAINT unique_volume_congress_session UNIQUE (volume_number, congress, session_number);


--
-- Name: bill_summary_enhanced uq_bill_summary_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary_enhanced
    ADD CONSTRAINT uq_bill_summary_type UNIQUE (bill_id, summary_type);


--
-- Name: committee_meeting_bill uq_committee_meeting_bill_association; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_bill
    ADD CONSTRAINT uq_committee_meeting_bill_association UNIQUE (meeting_id, congress, bill_type, bill_number);


--
-- Name: committee_meeting_committee uq_committee_meeting_committee_association; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_committee
    ADD CONSTRAINT uq_committee_meeting_committee_association UNIQUE (meeting_id, committee_system_code);


--
-- Name: committee_meeting_document uq_committee_meeting_document; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_document
    ADD CONSTRAINT uq_committee_meeting_document UNIQUE (meeting_id, document_type, description);


--
-- Name: committee_meeting uq_committee_meeting_event; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting
    ADD CONSTRAINT uq_committee_meeting_event UNIQUE (congress_id, chamber, event_id);


--
-- Name: committee_meeting_video uq_committee_meeting_video_url; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_video
    ADD CONSTRAINT uq_committee_meeting_video_url UNIQUE (meeting_id, video_url);


--
-- Name: hearing_committee uq_hearing_committee_association; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_committee
    ADD CONSTRAINT uq_hearing_committee_association UNIQUE (hearing_id, committee_system_code);


--
-- Name: hearing_date uq_hearing_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_date
    ADD CONSTRAINT uq_hearing_date UNIQUE (hearing_id, date);


--
-- Name: hearing_format uq_hearing_format_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_format
    ADD CONSTRAINT uq_hearing_format_type UNIQUE (hearing_id, format_type);


--
-- Name: hearing uq_hearing_jacket_chamber; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing
    ADD CONSTRAINT uq_hearing_jacket_chamber UNIQUE (jacket_number, chamber);


--
-- Name: hearing_meeting uq_hearing_meeting_association; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_meeting
    ADD CONSTRAINT uq_hearing_meeting_association UNIQUE (hearing_id, meeting_event_id);


--
-- Name: user_follow uq_user_follow; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follow
    ADD CONSTRAINT uq_user_follow UNIQUE (user_id, follow_type, follow_target_id);


--
-- Name: user_follow user_follow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follow
    ADD CONSTRAINT user_follow_pkey PRIMARY KEY (follow_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: bill_committee_activity_unique_with_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_committee_activity_unique_with_date ON public.bill_committee_activity USING btree (bill_id, committee_system_code, activity_name, activity_date) WHERE (activity_date IS NOT NULL);


--
-- Name: bill_committee_activity_unique_without_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_committee_activity_unique_without_date ON public.bill_committee_activity USING btree (bill_id, committee_system_code, activity_name) WHERE (activity_date IS NULL);


--
-- Name: idx_acr_ref_article_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acr_ref_article_id ON public.action_congressional_record_reference USING btree (article_id);


--
-- Name: idx_acr_ref_section_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acr_ref_section_id ON public.action_congressional_record_reference USING btree (section_id);


--
-- Name: idx_action_bill_committee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_bill_committee_date ON public.action_committee USING btree (action_id, committee_system_code);


--
-- Name: idx_action_bill_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_bill_date ON public.action USING btree (bill_id, action_date DESC);


--
-- Name: idx_action_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_bill_id ON public.action USING btree (bill_id);


--
-- Name: idx_action_bill_type_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_bill_type_date ON public.action USING btree (bill_id, action_type, action_date DESC) WHERE (action_type IS NOT NULL);


--
-- Name: idx_action_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_date ON public.action USING btree (action_date);


--
-- Name: idx_action_search_vector_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_search_vector_gin ON public.action USING gin (search_vector);


--
-- Name: idx_action_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_type ON public.action USING btree (type);


--
-- Name: idx_action_unique_bill_date_text; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_action_unique_bill_date_text ON public.action USING btree (bill_id, action_date, md5(text)) WHERE (bill_id IS NOT NULL);


--
-- Name: idx_active_user_sessions; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_user_sessions ON public.sessions USING btree (user_id, end_time) WHERE (end_time IS NULL);


--
-- Name: idx_article_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_article_chamber ON public.congressional_record_article USING btree (chamber);


--
-- Name: idx_article_congress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_article_congress ON public.congressional_record_article USING btree (congress);


--
-- Name: idx_article_issue_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_article_issue_date ON public.congressional_record_article USING btree (issue_date);


--
-- Name: idx_article_page_numbers; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_article_page_numbers ON public.congressional_record_article USING btree (chamber, start_page_number, end_page_number);


--
-- Name: idx_article_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_article_section ON public.congressional_record_article USING btree (section_id);


--
-- Name: idx_article_volume_issue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_article_volume_issue ON public.congressional_record_article USING btree (volume_number, issue_number);


--
-- Name: idx_bill_action_references; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_action_references ON public.action_congressional_record_reference USING btree (bill_id, chamber, start_page);


--
-- Name: idx_bill_ai_summary_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_ai_summary_bill_id ON public.bill_ai_summary USING btree (bill_id);


--
-- Name: idx_bill_ai_summary_generated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_ai_summary_generated ON public.bill_ai_summary USING btree (generated_at DESC);


--
-- Name: idx_bill_ai_summary_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_ai_summary_type ON public.bill_ai_summary USING btree (summary_type);


--
-- Name: idx_bill_ai_summary_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_ai_summary_version ON public.bill_ai_summary USING btree (text_version_code);


--
-- Name: idx_bill_amendment_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_amendment_bill_id ON public.bill_amendment USING btree (bill_id);


--
-- Name: idx_bill_cbo_estimate_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_cbo_estimate_bill_id ON public.bill_cbo_estimate USING btree (bill_id);


--
-- Name: idx_bill_committee_activity_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_committee_activity_bill_id ON public.bill_committee_activity USING btree (bill_id);


--
-- Name: idx_bill_committee_activity_committee_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_committee_activity_committee_code ON public.bill_committee_activity USING btree (committee_system_code);


--
-- Name: idx_bill_committee_report_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_committee_report_bill_id ON public.bill_committee_report USING btree (bill_id);


--
-- Name: idx_bill_congress_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_congress_id ON public.bill USING btree (congress_id);


--
-- Name: idx_bill_congress_introduced_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_congress_introduced_desc ON public.bill USING btree (congress_id, introduced_date DESC);


--
-- Name: idx_bill_congress_type_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_congress_type_number ON public.bill USING btree (congress_id, bill_type, bill_number);


--
-- Name: idx_bill_cosponsor_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_cosponsor_bill_id ON public.bill_cosponsor USING btree (bill_id);


--
-- Name: idx_bill_cosponsor_bioguide_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_cosponsor_bioguide_sync ON public.bill_cosponsor USING btree (bioguide_id);


--
-- Name: idx_bill_full_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_full_identifier ON public.bill USING btree (congress_id, bill_type, bill_number, bill_id) WHERE (congress_id >= 117);


--
-- Name: idx_bill_introduced_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_introduced_date ON public.bill USING btree (introduced_date);


--
-- Name: idx_bill_law_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_law_bill_id ON public.bill_law USING btree (bill_id);


--
-- Name: idx_bill_news_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_news_bill ON public.bill_news_mention USING btree (bill_id);


--
-- Name: idx_bill_news_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_news_created ON public.bill_news_mention USING btree (created_at DESC);


--
-- Name: idx_bill_note_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_note_bill_id ON public.bill_note USING btree (bill_id);


--
-- Name: idx_bill_policy_area_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_policy_area_trgm ON public.bill USING gin (policy_area public.gin_trgm_ops);


--
-- Name: idx_bill_related_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_related_bill_id ON public.bill_related USING btree (bill_id);


--
-- Name: idx_bill_related_relationship_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_related_relationship_type ON public.bill_related USING btree (relationship_type, related_bill_congress) WHERE (relationship_type IS NOT NULL);


--
-- Name: idx_bill_search_vector_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_search_vector_gin ON public.bill USING gin (search_vector);


--
-- Name: idx_bill_sponsor_bioguide_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_sponsor_bioguide_member ON public.bill_sponsor USING btree (member_bioguide_id);


--
-- Name: idx_bill_sponsor_member_congress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_sponsor_member_congress ON public.bill_sponsor USING btree (member_bioguide_id, sponsorship_date DESC) INCLUDE (bill_id, is_by_request);


--
-- Name: idx_bill_subject_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_subject_bill_id ON public.bill_subject USING btree (bill_id);


--
-- Name: idx_bill_subject_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_subject_name ON public.bill_subject USING btree (subject_name);


--
-- Name: idx_bill_summary_action_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_summary_action_date ON public.bill_summary USING btree (action_date DESC) WHERE (action_date IS NOT NULL);


--
-- Name: idx_bill_summary_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_summary_created_at ON public.bill_summary USING btree (created_at);


--
-- Name: idx_bill_summary_enhanced_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_summary_enhanced_bill_id ON public.bill_summary_enhanced USING btree (bill_id);


--
-- Name: idx_bill_summary_enhanced_generated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_summary_enhanced_generated_by ON public.bill_summary_enhanced USING btree (generated_by, created_at DESC);


--
-- Name: idx_bill_summary_enhanced_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_summary_enhanced_tags ON public.bill_summary_enhanced USING gin (affects_tags);


--
-- Name: idx_bill_summary_enhanced_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_summary_enhanced_type ON public.bill_summary_enhanced USING btree (summary_type);


--
-- Name: idx_bill_text_version_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_text_version_bill_id ON public.bill_text_version USING btree (bill_id);


--
-- Name: idx_bill_title_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_title_bill_id ON public.bill_title USING btree (bill_id);


--
-- Name: idx_bill_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_title_trgm ON public.bill USING gin (title public.gin_trgm_ops);


--
-- Name: idx_bill_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bill_type ON public.bill USING btree (bill_type);


--
-- Name: idx_chat_conversations_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_conversations_bill ON public.chat_conversations USING btree (bill_type, bill_number, bill_congress);


--
-- Name: idx_chat_conversations_hearing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_conversations_hearing ON public.chat_conversations USING btree (jacket_number) WHERE (is_hearing = true);


--
-- Name: idx_chat_conversations_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_conversations_updated_at ON public.chat_conversations USING btree (updated_at DESC);


--
-- Name: idx_chat_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_conversation_id ON public.chat_messages USING btree (conversation_id);


--
-- Name: idx_chat_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (conversation_id, created_at);


--
-- Name: idx_committee_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_chamber ON public.committee USING btree (chamber);


--
-- Name: idx_committee_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_current ON public.committee USING btree (is_current);


--
-- Name: idx_committee_meeting_api_update_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_api_update_date ON public.committee_meeting USING btree (api_update_date DESC);


--
-- Name: idx_committee_meeting_bill_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_bill_bill_id ON public.committee_meeting_bill USING btree (bill_id);


--
-- Name: idx_committee_meeting_bill_congress_type_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_bill_congress_type_number ON public.committee_meeting_bill USING btree (congress, bill_type, bill_number);


--
-- Name: idx_committee_meeting_bill_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_bill_meeting_id ON public.committee_meeting_bill USING btree (meeting_id);


--
-- Name: idx_committee_meeting_committee_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_committee_meeting_id ON public.committee_meeting_committee USING btree (meeting_id);


--
-- Name: idx_committee_meeting_committee_system_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_committee_system_code ON public.committee_meeting_committee USING btree (committee_system_code) WHERE (committee_system_code IS NOT NULL);


--
-- Name: idx_committee_meeting_congress_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_congress_chamber ON public.committee_meeting USING btree (congress_id, chamber);


--
-- Name: idx_committee_meeting_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_date ON public.committee_meeting USING btree (meeting_date DESC);


--
-- Name: idx_committee_meeting_document_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_document_meeting_id ON public.committee_meeting_document USING btree (meeting_id);


--
-- Name: idx_committee_meeting_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_event_id ON public.committee_meeting USING btree (event_id);


--
-- Name: idx_committee_meeting_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_search_vector ON public.committee_meeting USING gin (search_vector);


--
-- Name: idx_committee_meeting_video_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_meeting_video_meeting_id ON public.committee_meeting_video USING btree (meeting_id);


--
-- Name: idx_committee_name_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_name_gin ON public.committee USING gin (to_tsvector('english'::regconfig, (name)::text));


--
-- Name: idx_committee_parent_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_parent_code ON public.committee USING btree (parent_committee_code) WHERE (parent_committee_code IS NOT NULL);


--
-- Name: idx_committee_report_bill_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_bill_bill_id ON public.committee_report_bill USING btree (bill_id);


--
-- Name: idx_committee_report_bill_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_bill_report_id ON public.committee_report_bill USING btree (report_id);


--
-- Name: idx_committee_report_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_chamber ON public.committee_report USING btree (chamber);


--
-- Name: idx_committee_report_citation_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_citation_gin ON public.committee_report USING gin (to_tsvector('english'::regconfig, citation));


--
-- Name: idx_committee_report_committees_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_committees_gin ON public.committee_report USING gin (committees);


--
-- Name: idx_committee_report_conference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_conference ON public.committee_report USING btree (congress_id, issue_date DESC) WHERE (is_conference_report = true);


--
-- Name: idx_committee_report_congress_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_congress_chamber ON public.committee_report USING btree (congress_id, chamber);


--
-- Name: idx_committee_report_congress_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_congress_date ON public.committee_report USING btree (congress_id, issue_date DESC);


--
-- Name: idx_committee_report_congress_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_congress_id ON public.committee_report USING btree (congress_id);


--
-- Name: idx_committee_report_congress_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_congress_type ON public.committee_report USING btree (congress_id, report_type);


--
-- Name: idx_committee_report_congress_type_display; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_congress_type_display ON public.committee_report USING btree (congress_id, report_type_display);


--
-- Name: idx_committee_report_congress_type_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_congress_type_number ON public.committee_report USING btree (congress_id, report_type, report_number);


--
-- Name: idx_committee_report_issue_date_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_issue_date_desc ON public.committee_report USING btree (issue_date DESC);


--
-- Name: idx_committee_report_recent_congress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_recent_congress ON public.committee_report USING btree (congress_id, issue_date DESC) WHERE (congress_id >= 117);


--
-- Name: idx_committee_report_search_vector_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_search_vector_gin ON public.committee_report USING gin (search_vector);


--
-- Name: idx_committee_report_sort_pagination; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_sort_pagination ON public.committee_report USING btree (congress_id DESC, issue_date DESC, report_number DESC);


--
-- Name: idx_committee_report_text_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_text_count ON public.committee_report USING btree (text_count) WHERE (text_count IS NOT NULL);


--
-- Name: idx_committee_report_title_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_title_gin ON public.committee_report USING gin (to_tsvector('english'::regconfig, title));


--
-- Name: idx_committee_report_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_type ON public.committee_report USING btree (report_type);


--
-- Name: idx_committee_report_type_display; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_report_type_display ON public.committee_report USING btree (report_type_display);


--
-- Name: idx_congress_session_congress_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_congress_session_congress_id ON public.congress_session USING btree (congress_id);


--
-- Name: idx_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_user_id ON public.conversations USING btree (user_id);


--
-- Name: idx_hearing_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_chamber ON public.hearing USING btree (chamber);


--
-- Name: idx_hearing_citation_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_citation_gin ON public.hearing USING gin (to_tsvector('english'::regconfig, (citation)::text));


--
-- Name: idx_hearing_committee_hearing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_committee_hearing_id ON public.hearing_committee USING btree (hearing_id);


--
-- Name: idx_hearing_committee_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_committee_name ON public.hearing_committee USING gin (to_tsvector('english'::regconfig, committee_name));


--
-- Name: idx_hearing_committee_system_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_committee_system_code ON public.hearing_committee USING btree (committee_system_code) WHERE (committee_system_code IS NOT NULL);


--
-- Name: idx_hearing_congress_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_congress_chamber ON public.hearing USING btree (congress_id, chamber);


--
-- Name: idx_hearing_congress_chamber_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_congress_chamber_date ON public.hearing USING btree (congress_id, chamber, updated_at DESC);


--
-- Name: idx_hearing_congress_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_congress_id ON public.hearing USING btree (congress_id);


--
-- Name: idx_hearing_date_hearing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_date_hearing_id ON public.hearing_date USING btree (hearing_id);


--
-- Name: idx_hearing_format_hearing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_format_hearing_id ON public.hearing_format USING btree (hearing_id);


--
-- Name: idx_hearing_format_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_format_type ON public.hearing_format USING btree (format_type);


--
-- Name: idx_hearing_jacket_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_jacket_number ON public.hearing USING btree (jacket_number);


--
-- Name: idx_hearing_meeting_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_meeting_event_id ON public.hearing_meeting USING btree (meeting_event_id);


--
-- Name: idx_hearing_meeting_hearing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_meeting_hearing_id ON public.hearing_meeting USING btree (hearing_id);


--
-- Name: idx_hearing_search_vector_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_search_vector_gin ON public.hearing USING gin (search_vector);


--
-- Name: idx_hearing_title_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hearing_title_gin ON public.hearing USING gin (to_tsvector('english'::regconfig, title));


--
-- Name: idx_issue_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issue_date ON public.congressional_record_issue USING btree (issue_date DESC);


--
-- Name: idx_issue_section_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issue_section_lookup ON public.congressional_record_section USING btree (issue_id, name, start_page);


--
-- Name: idx_member_address_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_address_active ON public.member_address USING btree (is_active);


--
-- Name: idx_member_address_active_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_address_active_current ON public.member_address USING btree (member_bioguide_id) WHERE ((is_active = true) AND ((address_type)::text = 'current'::text));


--
-- Name: idx_member_address_bioguide; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_address_bioguide ON public.member_address USING btree (member_bioguide_id);


--
-- Name: idx_member_address_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_address_type ON public.member_address USING btree (address_type);


--
-- Name: idx_member_address_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_member_address_unique_active ON public.member_address USING btree (member_bioguide_id, address_type) WHERE (is_active = true);


--
-- Name: idx_member_committee_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_committee_current ON public.member_committee USING btree (congress_id DESC, committee_system_code) WHERE (congress_id >= 117);


--
-- Name: idx_member_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_current ON public.member USING btree (current_member);


--
-- Name: idx_member_legislation_stats_bioguide; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_legislation_stats_bioguide ON public.member_legislation_stats USING btree (member_bioguide_id);


--
-- Name: idx_member_legislation_stats_calculated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_legislation_stats_calculated ON public.member_legislation_stats USING btree (last_calculated);


--
-- Name: idx_member_legislation_stats_congress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_legislation_stats_congress ON public.member_legislation_stats USING btree (congress);


--
-- Name: idx_member_legislation_stats_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_legislation_stats_current ON public.member_legislation_stats USING btree (member_bioguide_id, congress DESC);


--
-- Name: idx_member_legislation_stats_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_member_legislation_stats_unique ON public.member_legislation_stats USING btree (member_bioguide_id, congress);


--
-- Name: idx_member_name_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_name_gin ON public.member USING gin (to_tsvector('english'::regconfig, (((first_name)::text || ' '::text) || (COALESCE(last_name, ''::character varying))::text)));


--
-- Name: idx_member_party_history_bioguide; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_party_history_bioguide ON public.member_party_history USING btree (member_bioguide_id);


--
-- Name: idx_member_party_history_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_party_history_current ON public.member_party_history USING btree (member_bioguide_id, start_year DESC) WHERE (end_year IS NULL);


--
-- Name: idx_member_party_history_party; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_party_history_party ON public.member_party_history USING btree (party_abbreviation);


--
-- Name: idx_member_party_history_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_member_party_history_unique ON public.member_party_history USING btree (member_bioguide_id, start_year, COALESCE(end_year, 9999));


--
-- Name: idx_member_party_history_years; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_party_history_years ON public.member_party_history USING btree (start_year, end_year);


--
-- Name: idx_member_previous_names_bioguide; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_previous_names_bioguide ON public.member_previous_names USING btree (member_bioguide_id);


--
-- Name: idx_member_previous_names_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_previous_names_dates ON public.member_previous_names USING btree (start_date, end_date);


--
-- Name: idx_member_previous_names_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_previous_names_search ON public.member_previous_names USING gin (to_tsvector('english'::regconfig, (((((((COALESCE(first_name, ''::character varying))::text || ' '::text) || (COALESCE(middle_name, ''::character varying))::text) || ' '::text) || (COALESCE(last_name, ''::character varying))::text) || ' '::text) || (COALESCE(nickname, ''::character varying))::text)));


--
-- Name: idx_member_previous_names_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_previous_names_type ON public.member_previous_names USING btree (name_type);


--
-- Name: idx_member_term_bioguide_congress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_bioguide_congress ON public.member_term USING btree (member_bioguide_id, congress);


--
-- Name: idx_member_term_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_chamber ON public.member_term USING btree (chamber);


--
-- Name: idx_member_term_congress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_congress ON public.member_term USING btree (congress);


--
-- Name: idx_member_term_congress_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_congress_state ON public.member_term USING btree (congress, state_code);


--
-- Name: idx_member_term_current_congress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_current_congress ON public.member_term USING btree (congress, chamber, party_code) WHERE (congress >= 117);


--
-- Name: idx_member_term_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_member_id ON public.member_term USING btree (member_bioguide_id);


--
-- Name: idx_member_term_party; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_party ON public.member_term USING btree (party_code);


--
-- Name: idx_member_term_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_term_state ON public.member_term USING btree (state_code);


--
-- Name: idx_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);


--
-- Name: idx_news_analysis_analyzed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_analysis_analyzed_at ON public.news_analysis_log USING btree (analyzed_at DESC);


--
-- Name: idx_news_item_fetched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_item_fetched ON public.news_item USING btree (fetched_at DESC);


--
-- Name: idx_news_item_pub_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_item_pub_date ON public.news_item USING btree (pub_date DESC);


--
-- Name: idx_news_item_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_item_source ON public.news_item USING btree (source_name);


--
-- Name: idx_performance_baselines_metric_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_performance_baselines_metric_time ON public.performance_baselines USING btree (metric_name, recorded_at DESC);


--
-- Name: idx_performance_baselines_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_performance_baselines_type_time ON public.performance_baselines USING btree (baseline_type, recorded_at DESC);


--
-- Name: idx_reference_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_action ON public.action_congressional_record_reference USING btree (action_id);


--
-- Name: idx_reference_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_bill ON public.action_congressional_record_reference USING btree (bill_id);


--
-- Name: idx_reference_chamber_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_chamber_page ON public.action_congressional_record_reference USING btree (chamber, start_page);


--
-- Name: idx_reference_resolution_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_resolution_status ON public.action_congressional_record_reference USING btree (is_resolved, issue_id) WHERE (is_resolved = true);


--
-- Name: idx_reference_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_unresolved ON public.action_congressional_record_reference USING btree (chamber, start_page) WHERE (is_resolved = false);


--
-- Name: idx_spotlight_active_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spotlight_active_priority ON public.spotlight_bill USING btree (is_active, priority DESC) WHERE (is_active = true);


--
-- Name: idx_spotlight_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spotlight_bill_id ON public.spotlight_bill USING btree (bill_id);


--
-- Name: idx_spotlight_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spotlight_category ON public.spotlight_bill USING btree (category, priority DESC) WHERE (is_active = true);


--
-- Name: idx_spotlight_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spotlight_dates ON public.spotlight_bill USING btree (start_date, end_date) WHERE (is_active = true);


--
-- Name: idx_sync_status_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_entity_type ON public.sync_status USING btree (entity_type);


--
-- Name: idx_sync_status_last_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_last_sync ON public.sync_status USING btree (last_sync_at DESC);


--
-- Name: idx_sync_status_successful_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_successful_sync ON public.sync_status USING btree (last_successful_sync DESC);


--
-- Name: idx_trending_topic_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trending_topic_last_seen ON public.trending_topic USING btree (last_seen DESC);


--
-- Name: idx_trending_topic_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trending_topic_score ON public.trending_topic USING btree (score DESC) WHERE (is_active = true);


--
-- Name: idx_user_follow_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_follow_created ON public.user_follow USING btree (user_id, created_at DESC);


--
-- Name: idx_user_follow_notify; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_follow_notify ON public.user_follow USING btree (user_id, notify) WHERE (notify = true);


--
-- Name: idx_user_follow_type_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_follow_type_target ON public.user_follow USING btree (follow_type, follow_target_id);


--
-- Name: idx_user_follow_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_follow_user_id ON public.user_follow USING btree (user_id);


--
-- Name: idx_volume_congress_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_volume_congress_session ON public.congressional_record_volume USING btree (congress, session_number);


--
-- Name: idx_volume_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_volume_year ON public.congressional_record_volume USING btree (year);


--
-- Name: action action_search_vector_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER action_search_vector_trigger BEFORE INSERT OR UPDATE ON public.action FOR EACH ROW EXECUTE FUNCTION public.update_action_search_vector();


--
-- Name: bill bill_search_vector_trigger_enhanced; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bill_search_vector_trigger_enhanced BEFORE INSERT OR UPDATE ON public.bill FOR EACH ROW EXECUTE FUNCTION public.update_bill_search_vector_enhanced();


--
-- Name: committee_report committee_report_search_vector_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER committee_report_search_vector_trigger BEFORE INSERT OR UPDATE ON public.committee_report FOR EACH ROW EXECUTE FUNCTION public.update_committee_report_search_vector();


--
-- Name: congressional_record_issue enforce_issue_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_issue_consistency BEFORE INSERT OR UPDATE ON public.congressional_record_issue FOR EACH ROW EXECUTE FUNCTION public.enforce_issue_volume_consistency();


--
-- Name: action_congressional_record_reference enforce_reference_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_reference_consistency BEFORE INSERT OR UPDATE ON public.action_congressional_record_reference FOR EACH ROW EXECUTE FUNCTION public.enforce_reference_bill_consistency();


--
-- Name: hearing hearing_search_vector_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hearing_search_vector_trigger BEFORE INSERT OR UPDATE ON public.hearing FOR EACH ROW EXECUTE FUNCTION public.update_hearing_search_vector();


--
-- Name: congressional_record_article populate_convenience_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER populate_convenience_fields BEFORE INSERT OR UPDATE ON public.congressional_record_article FOR EACH ROW EXECUTE FUNCTION public.populate_article_convenience_fields();


--
-- Name: bill_ai_summary trg_bill_ai_summary_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bill_ai_summary_updated_at BEFORE UPDATE ON public.bill_ai_summary FOR EACH ROW EXECUTE FUNCTION public.update_bill_ai_summary_updated_at();


--
-- Name: committee_meeting trigger_committee_meeting_search_vector_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_committee_meeting_search_vector_update BEFORE INSERT OR UPDATE ON public.committee_meeting FOR EACH ROW EXECUTE FUNCTION public.update_committee_meeting_search_vector();


--
-- Name: congressional_record_article update_article_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_article_updated_at BEFORE UPDATE ON public.congressional_record_article FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: bill_amendment update_bill_amendment_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_bill_amendment_updated_at BEFORE UPDATE ON public.bill_amendment FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: bill_cosponsor update_bill_cosponsor_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_bill_cosponsor_updated_at BEFORE UPDATE ON public.bill_cosponsor FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: bill update_bill_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_bill_updated_at BEFORE UPDATE ON public.bill FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: chat_conversations update_chat_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_chat_conversations_updated_at BEFORE UPDATE ON public.chat_conversations FOR EACH ROW EXECUTE FUNCTION public.update_chat_conversations_updated_at();


--
-- Name: committee_meeting_bill update_committee_meeting_bill_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_committee_meeting_bill_updated_at BEFORE UPDATE ON public.committee_meeting_bill FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: committee_meeting_committee update_committee_meeting_committee_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_committee_meeting_committee_updated_at BEFORE UPDATE ON public.committee_meeting_committee FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: committee_meeting_document update_committee_meeting_document_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_committee_meeting_document_updated_at BEFORE UPDATE ON public.committee_meeting_document FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: committee_meeting update_committee_meeting_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_committee_meeting_updated_at BEFORE UPDATE ON public.committee_meeting FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: committee_meeting_video update_committee_meeting_video_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_committee_meeting_video_updated_at BEFORE UPDATE ON public.committee_meeting_video FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: committee_report update_committee_report_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_committee_report_updated_at BEFORE UPDATE ON public.committee_report FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: committee update_committee_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_committee_updated_at BEFORE UPDATE ON public.committee FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: congress update_congress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_congress_updated_at BEFORE UPDATE ON public.congress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: hearing_committee update_hearing_committee_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_hearing_committee_updated_at BEFORE UPDATE ON public.hearing_committee FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: hearing_format update_hearing_format_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_hearing_format_updated_at BEFORE UPDATE ON public.hearing_format FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: hearing_meeting update_hearing_meeting_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_hearing_meeting_updated_at BEFORE UPDATE ON public.hearing_meeting FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: hearing update_hearing_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_hearing_updated_at BEFORE UPDATE ON public.hearing FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: congressional_record_issue update_issue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_issue_updated_at BEFORE UPDATE ON public.congressional_record_issue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: member_address update_member_address_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_member_address_updated_at BEFORE UPDATE ON public.member_address FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: member_legislation_stats update_member_legislation_stats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_member_legislation_stats_updated_at BEFORE UPDATE ON public.member_legislation_stats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: member_party_history update_member_party_history_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_member_party_history_updated_at BEFORE UPDATE ON public.member_party_history FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: member_previous_names update_member_previous_names_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_member_previous_names_updated_at BEFORE UPDATE ON public.member_previous_names FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: member update_member_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_member_updated_at BEFORE UPDATE ON public.member FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: action_congressional_record_reference update_reference_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reference_updated_at BEFORE UPDATE ON public.action_congressional_record_reference FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: congressional_record_section update_section_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_section_updated_at BEFORE UPDATE ON public.congressional_record_section FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: congressional_record_volume update_volume_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_volume_updated_at BEFORE UPDATE ON public.congressional_record_volume FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: action action_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action
    ADD CONSTRAINT action_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: action_committee action_committee_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_committee
    ADD CONSTRAINT action_committee_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.action(action_id);


--
-- Name: action_committee action_committee_committee_system_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_committee
    ADD CONSTRAINT action_committee_committee_system_code_fkey FOREIGN KEY (committee_system_code) REFERENCES public.committee(system_code);


--
-- Name: action_congressional_record_reference action_congressional_record_reference_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_congressional_record_reference
    ADD CONSTRAINT action_congressional_record_reference_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.action(action_id) ON DELETE CASCADE;


--
-- Name: action_congressional_record_reference action_congressional_record_reference_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_congressional_record_reference
    ADD CONSTRAINT action_congressional_record_reference_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.congressional_record_article(article_id) ON DELETE SET NULL;


--
-- Name: action_congressional_record_reference action_congressional_record_reference_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_congressional_record_reference
    ADD CONSTRAINT action_congressional_record_reference_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.congressional_record_issue(issue_id) ON DELETE SET NULL;


--
-- Name: action_congressional_record_reference action_congressional_record_reference_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_congressional_record_reference
    ADD CONSTRAINT action_congressional_record_reference_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.congressional_record_section(section_id) ON DELETE SET NULL;


--
-- Name: bill_amendment bill_amendment_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_amendment
    ADD CONSTRAINT bill_amendment_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_cbo_estimate bill_cbo_estimate_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cbo_estimate
    ADD CONSTRAINT bill_cbo_estimate_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_committee_activity bill_committee_activity_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_activity
    ADD CONSTRAINT bill_committee_activity_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: bill_committee_activity bill_committee_activity_committee_system_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_activity
    ADD CONSTRAINT bill_committee_activity_committee_system_code_fkey FOREIGN KEY (committee_system_code) REFERENCES public.committee(system_code);


--
-- Name: bill_committee_report bill_committee_report_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_committee_report
    ADD CONSTRAINT bill_committee_report_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill bill_congress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill
    ADD CONSTRAINT bill_congress_id_fkey FOREIGN KEY (congress_id) REFERENCES public.congress(congress_id);


--
-- Name: bill_cosponsor bill_cosponsor_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cosponsor
    ADD CONSTRAINT bill_cosponsor_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: bill_cosponsor bill_cosponsor_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cosponsor
    ADD CONSTRAINT bill_cosponsor_bioguide_id_fkey FOREIGN KEY (bioguide_id) REFERENCES public.member(bioguide_id);


--
-- Name: bill_law bill_law_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_law
    ADD CONSTRAINT bill_law_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_news_mention bill_news_mention_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_news_mention
    ADD CONSTRAINT bill_news_mention_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: bill_news_mention bill_news_mention_news_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_news_mention
    ADD CONSTRAINT bill_news_mention_news_item_id_fkey FOREIGN KEY (news_item_id) REFERENCES public.news_item(item_id) ON DELETE CASCADE;


--
-- Name: bill_note bill_note_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_note
    ADD CONSTRAINT bill_note_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_related bill_related_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_related
    ADD CONSTRAINT bill_related_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_sponsor bill_sponsor_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_sponsor
    ADD CONSTRAINT bill_sponsor_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: bill_sponsor bill_sponsor_member_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_sponsor
    ADD CONSTRAINT bill_sponsor_member_bioguide_id_fkey FOREIGN KEY (member_bioguide_id) REFERENCES public.member(bioguide_id);


--
-- Name: bill_subject bill_subject_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_subject
    ADD CONSTRAINT bill_subject_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_summary bill_summary_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary
    ADD CONSTRAINT bill_summary_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: bill_text_version bill_text_version_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_text_version
    ADD CONSTRAINT bill_text_version_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_title bill_title_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_title
    ADD CONSTRAINT bill_title_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: chat_messages chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;


--
-- Name: committee committee_parent_committee_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee
    ADD CONSTRAINT committee_parent_committee_code_fkey FOREIGN KEY (parent_committee_code) REFERENCES public.committee(system_code);


--
-- Name: committee_report_bill committee_report_bill_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_report_bill
    ADD CONSTRAINT committee_report_bill_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id);


--
-- Name: committee_report_bill committee_report_bill_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_report_bill
    ADD CONSTRAINT committee_report_bill_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.committee_report(report_id);


--
-- Name: committee_report committee_report_congress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_report
    ADD CONSTRAINT committee_report_congress_id_fkey FOREIGN KEY (congress_id) REFERENCES public.congress(congress_id);


--
-- Name: congress_session congress_session_congress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congress_session
    ADD CONSTRAINT congress_session_congress_id_fkey FOREIGN KEY (congress_id) REFERENCES public.congress(congress_id);


--
-- Name: congressional_record_article congressional_record_article_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_article
    ADD CONSTRAINT congressional_record_article_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.congressional_record_section(section_id) ON DELETE CASCADE;


--
-- Name: congressional_record_issue congressional_record_issue_volume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_issue
    ADD CONSTRAINT congressional_record_issue_volume_id_fkey FOREIGN KEY (volume_id) REFERENCES public.congressional_record_volume(volume_id) ON DELETE CASCADE;


--
-- Name: congressional_record_section congressional_record_section_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.congressional_record_section
    ADD CONSTRAINT congressional_record_section_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.congressional_record_issue(issue_id) ON DELETE CASCADE;


--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bill_ai_summary fk_bill_ai_summary_bill; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_ai_summary
    ADD CONSTRAINT fk_bill_ai_summary_bill FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: bill_summary_enhanced fk_bill_summary_enhanced; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_summary_enhanced
    ADD CONSTRAINT fk_bill_summary_enhanced FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: committee_meeting_bill fk_committee_meeting_bill_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_bill
    ADD CONSTRAINT fk_committee_meeting_bill_meeting FOREIGN KEY (meeting_id) REFERENCES public.committee_meeting(meeting_id) ON DELETE CASCADE;


--
-- Name: committee_meeting_committee fk_committee_meeting_committee_code; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_committee
    ADD CONSTRAINT fk_committee_meeting_committee_code FOREIGN KEY (committee_system_code) REFERENCES public.committee(system_code) ON DELETE SET NULL;


--
-- Name: committee_meeting_committee fk_committee_meeting_committee_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_committee
    ADD CONSTRAINT fk_committee_meeting_committee_meeting FOREIGN KEY (meeting_id) REFERENCES public.committee_meeting(meeting_id) ON DELETE CASCADE;


--
-- Name: committee_meeting_document fk_committee_meeting_document_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_document
    ADD CONSTRAINT fk_committee_meeting_document_meeting FOREIGN KEY (meeting_id) REFERENCES public.committee_meeting(meeting_id) ON DELETE CASCADE;


--
-- Name: committee_meeting_video fk_committee_meeting_video_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_meeting_video
    ADD CONSTRAINT fk_committee_meeting_video_meeting FOREIGN KEY (meeting_id) REFERENCES public.committee_meeting(meeting_id) ON DELETE CASCADE;


--
-- Name: hearing_committee fk_hearing_committee_hearing_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_committee
    ADD CONSTRAINT fk_hearing_committee_hearing_id FOREIGN KEY (hearing_id) REFERENCES public.hearing(hearing_id) ON DELETE CASCADE;


--
-- Name: hearing_committee fk_hearing_committee_system_code; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_committee
    ADD CONSTRAINT fk_hearing_committee_system_code FOREIGN KEY (committee_system_code) REFERENCES public.committee(system_code) ON DELETE SET NULL;


--
-- Name: hearing_date fk_hearing_date_hearing; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_date
    ADD CONSTRAINT fk_hearing_date_hearing FOREIGN KEY (hearing_id) REFERENCES public.hearing(hearing_id) ON DELETE CASCADE;


--
-- Name: hearing_format fk_hearing_format_hearing_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_format
    ADD CONSTRAINT fk_hearing_format_hearing_id FOREIGN KEY (hearing_id) REFERENCES public.hearing(hearing_id) ON DELETE CASCADE;


--
-- Name: hearing_meeting fk_hearing_meeting_hearing_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing_meeting
    ADD CONSTRAINT fk_hearing_meeting_hearing_id FOREIGN KEY (hearing_id) REFERENCES public.hearing(hearing_id) ON DELETE CASCADE;


--
-- Name: member_term fk_member_term_state; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_term
    ADD CONSTRAINT fk_member_term_state FOREIGN KEY (state_code) REFERENCES public.states(state_code) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: spotlight_bill fk_spotlight_bill; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spotlight_bill
    ADD CONSTRAINT fk_spotlight_bill FOREIGN KEY (bill_id) REFERENCES public.bill(bill_id) ON DELETE CASCADE;


--
-- Name: hearing hearing_congress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hearing
    ADD CONSTRAINT hearing_congress_id_fkey FOREIGN KEY (congress_id) REFERENCES public.congress(congress_id);


--
-- Name: member_address member_address_member_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_address
    ADD CONSTRAINT member_address_member_bioguide_id_fkey FOREIGN KEY (member_bioguide_id) REFERENCES public.member(bioguide_id) ON DELETE CASCADE;


--
-- Name: member_committee member_committee_committee_system_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_committee
    ADD CONSTRAINT member_committee_committee_system_code_fkey FOREIGN KEY (committee_system_code) REFERENCES public.committee(system_code);


--
-- Name: member_committee member_committee_congress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_committee
    ADD CONSTRAINT member_committee_congress_id_fkey FOREIGN KEY (congress_id) REFERENCES public.congress(congress_id);


--
-- Name: member_committee member_committee_member_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_committee
    ADD CONSTRAINT member_committee_member_bioguide_id_fkey FOREIGN KEY (member_bioguide_id) REFERENCES public.member(bioguide_id);


--
-- Name: member_legislation_stats member_legislation_stats_member_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_legislation_stats
    ADD CONSTRAINT member_legislation_stats_member_bioguide_id_fkey FOREIGN KEY (member_bioguide_id) REFERENCES public.member(bioguide_id) ON DELETE CASCADE;


--
-- Name: member_party_history member_party_history_member_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_party_history
    ADD CONSTRAINT member_party_history_member_bioguide_id_fkey FOREIGN KEY (member_bioguide_id) REFERENCES public.member(bioguide_id) ON DELETE CASCADE;


--
-- Name: member_previous_names member_previous_names_member_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_previous_names
    ADD CONSTRAINT member_previous_names_member_bioguide_id_fkey FOREIGN KEY (member_bioguide_id) REFERENCES public.member(bioguide_id) ON DELETE CASCADE;


--
-- Name: member_term member_term_member_bioguide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_term
    ADD CONSTRAINT member_term_member_bioguide_id_fkey FOREIGN KEY (member_bioguide_id) REFERENCES public.member(bioguide_id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


