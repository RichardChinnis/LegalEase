-- Migration: Add sync_status table for tracking data synchronization
-- Description: Creates table to track when each entity type was last synced
-- Created: 2025-08-26
-- Safe to run: Creates new table without affecting existing data

BEGIN;

-- Check if this migration has already been applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = '003_add_sync_status') THEN
        RAISE EXCEPTION 'Migration 003_add_sync_status has already been applied';
    END IF;
END
$$;

-- Create sync_status table
CREATE TABLE IF NOT EXISTS sync_status (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    last_sync_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_successful_sync TIMESTAMP WITH TIME ZONE,
    records_synced INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    sync_duration_ms INTEGER,
    error_message TEXT,
    sync_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Index for quick lookups by entity type
    CONSTRAINT idx_sync_status_entity_type_unique UNIQUE (entity_type, last_sync_at)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sync_status_entity_type 
    ON sync_status(entity_type);

CREATE INDEX IF NOT EXISTS idx_sync_status_last_sync 
    ON sync_status(last_sync_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_status_successful_sync 
    ON sync_status(last_successful_sync DESC);

-- Add comments
COMMENT ON TABLE sync_status IS 'Tracks synchronization history for each entity type';
COMMENT ON COLUMN sync_status.entity_type IS 'Type of entity being synced (bills, amendments, actions, etc.)';
COMMENT ON COLUMN sync_status.last_sync_at IS 'Timestamp of the last sync attempt';
COMMENT ON COLUMN sync_status.last_successful_sync IS 'Timestamp of the last successful sync';
COMMENT ON COLUMN sync_status.records_synced IS 'Number of records successfully synced';
COMMENT ON COLUMN sync_status.records_failed IS 'Number of records that failed to sync';
COMMENT ON COLUMN sync_status.sync_duration_ms IS 'Duration of the sync operation in milliseconds';
COMMENT ON COLUMN sync_status.error_message IS 'Error message if sync failed';
COMMENT ON COLUMN sync_status.sync_metadata IS 'Additional metadata about the sync operation';

-- Create a view for the latest sync status of each entity
CREATE OR REPLACE VIEW latest_sync_status AS
SELECT DISTINCT ON (entity_type)
    entity_type,
    last_sync_at,
    last_successful_sync,
    records_synced,
    records_failed,
    sync_duration_ms,
    error_message,
    sync_metadata,
    CASE 
        WHEN last_successful_sync IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_successful_sync)) / 3600
        ELSE NULL
    END AS hours_since_sync,
    CASE
        WHEN error_message IS NULL THEN 'success'
        ELSE 'failed'
    END AS status
FROM sync_status
ORDER BY entity_type, last_sync_at DESC;

COMMENT ON VIEW latest_sync_status IS 'Shows the most recent sync status for each entity type';

-- Function to get sync health status
CREATE OR REPLACE FUNCTION get_sync_health()
RETURNS TABLE(
    entity_type VARCHAR(50),
    status TEXT,
    hours_since_sync NUMERIC,
    last_error TEXT,
    health_status TEXT
) AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_sync_health IS 'Returns health status of all sync operations';

-- Record that this migration has been applied
INSERT INTO schema_migrations (migration_id, description) 
VALUES ('003_add_sync_status', 'Add sync_status table for tracking data synchronization');

COMMIT;

-- Migration completed successfully