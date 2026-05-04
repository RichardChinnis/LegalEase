-- Step 1: Backup Current Permissions and Ownership
-- Run this FIRST to save current state for rollback if needed
-- Usage: psql -d congress_api -f 001-backup-current-permissions.sql > /tmp/permissions-backup.sql

\echo '-- Current Database Permissions Backup'
\echo '-- Generated on:' `date`
\echo '-- Run this to restore original permissions if needed'
\echo ''

\echo '-- Table Ownership Backup'
SELECT 
    'ALTER TABLE ' || schemaname || '.' || tablename || ' OWNER TO ' || tableowner || ';' as restore_ownership_cmd
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

\echo ''
\echo '-- User Privileges Backup'
SELECT 
    'GRANT ' || privilege_type || ' ON ' || table_schema || '.' || table_name || ' TO ' || grantee || ';' as restore_privilege_cmd
FROM information_schema.role_table_grants 
WHERE table_schema = 'public'
ORDER BY grantee, table_name, privilege_type;

\echo ''
\echo '-- Sequence Privileges Backup (using pg_catalog for compatibility)'
SELECT 
    'GRANT ' || 
    CASE WHEN has_sequence_privilege(grantee.rolname, seq.oid, 'USAGE') THEN 'USAGE, ' ELSE '' END ||
    CASE WHEN has_sequence_privilege(grantee.rolname, seq.oid, 'SELECT') THEN 'SELECT, ' ELSE '' END ||
    CASE WHEN has_sequence_privilege(grantee.rolname, seq.oid, 'UPDATE') THEN 'UPDATE' ELSE '' END ||
    ' ON SEQUENCE public.' || seq.relname || ' TO ' || grantee.rolname || ';' as restore_sequence_cmd
FROM pg_class seq
CROSS JOIN pg_roles grantee
WHERE seq.relkind = 'S' 
  AND seq.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND grantee.rolname IN ('congress_admin', 'congress_api_backend', 'congress_sync_writer')
  AND (has_sequence_privilege(grantee.rolname, seq.oid, 'USAGE') 
       OR has_sequence_privilege(grantee.rolname, seq.oid, 'SELECT')
       OR has_sequence_privilege(grantee.rolname, seq.oid, 'UPDATE'))
ORDER BY seq.relname, grantee.rolname;

\echo ''
\echo '-- Current table owners:'
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;