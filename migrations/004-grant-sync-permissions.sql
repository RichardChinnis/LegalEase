-- Step 4: Grant Sync Service Permissions
-- Grants read/write permissions to congress_sync_writer for data operations
-- Run as congress_admin (table owner) or postgres superuser

\echo 'Granting permissions to congress_sync_writer...'

-- Grant read/write access to all current tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO congress_sync_writer;

-- Grant sequence usage (needed for serial/auto-increment columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO congress_sync_writer;

-- Grant permissions on future tables/sequences (for new migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO congress_sync_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT USAGE, SELECT ON SEQUENCES TO congress_sync_writer;

-- Verify permissions by showing what sync user can access
\echo ''
\echo 'Verifying congress_sync_writer permissions:'
SELECT 
    table_name,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) as privileges
FROM information_schema.role_table_grants 
WHERE grantee = 'congress_sync_writer' 
  AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

\echo ''
\echo 'Sync user permissions granted successfully'