-- Step 7: Verify Database Setup
-- Comprehensive verification that all changes were applied correctly
-- Run as any user - this is read-only verification

\echo '=========================================='
\echo 'CONGRESS API DATABASE SETUP VERIFICATION'
\echo '=========================================='
\echo ''

-- Check user existence and properties
\echo '1. CHECKING USER ACCOUNTS:'
\echo '---------------------------'
SELECT 
    rolname as username,
    rolcanlogin as can_login,
    rolsuper as is_superuser,
    rolcreatedb as can_create_db,
    rolcreaterole as can_create_roles,
    rolconnlimit as connection_limit
FROM pg_roles 
WHERE rolname IN ('congress_admin', 'congress_api_backend', 'congress_sync_writer')
ORDER BY rolname;

\echo ''

-- Check table ownership
\echo '2. CHECKING TABLE OWNERSHIP:'
\echo '----------------------------'
SELECT 
    tablename,
    tableowner,
    CASE 
        WHEN tableowner = 'congress_admin' THEN '✓ Correct'
        ELSE '⚠ Should be congress_admin'
    END as status
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

\echo ''

-- Check sync user permissions
\echo '3. CHECKING SYNC USER PERMISSIONS:'
\echo '-----------------------------------'
\echo 'congress_sync_writer should have SELECT, INSERT, UPDATE, DELETE on all tables:'
SELECT 
    table_name,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) as privileges,
    CASE 
        WHEN string_agg(privilege_type, ', ' ORDER BY privilege_type) LIKE '%SELECT%' 
             AND string_agg(privilege_type, ', ' ORDER BY privilege_type) LIKE '%INSERT%'
             AND string_agg(privilege_type, ', ' ORDER BY privilege_type) LIKE '%UPDATE%'
             AND string_agg(privilege_type, ', ' ORDER BY privilege_type) LIKE '%DELETE%'
        THEN '✓ Complete'
        ELSE '⚠ Missing permissions'
    END as status
FROM information_schema.role_table_grants 
WHERE grantee = 'congress_sync_writer' AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

\echo ''

-- Check backend user permissions (should be read-only)
\echo '4. CHECKING BACKEND USER PERMISSIONS:'
\echo '-------------------------------------'
\echo 'congress_api_backend should have only SELECT permissions:'
SELECT 
    table_name,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) as privileges,
    CASE 
        WHEN string_agg(privilege_type, ', ' ORDER BY privilege_type) = 'SELECT'
        THEN '✓ Read-only'
        ELSE '⚠ Has write permissions'
    END as status
FROM information_schema.role_table_grants 
WHERE grantee = 'congress_api_backend' AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

\echo ''

-- Check for any write permissions on backend user (should be empty)
\echo '5. CHECKING FOR UNAUTHORIZED WRITE PERMISSIONS:'
\echo '-----------------------------------------------'
\echo 'The following should be EMPTY (no write permissions for backend user):'
SELECT 
    table_name,
    privilege_type,
    '⚠ SECURITY ISSUE' as warning
FROM information_schema.role_table_grants 
WHERE grantee = 'congress_api_backend' 
  AND table_schema = 'public'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

\echo ''

-- Check critical columns exist
\echo '6. CHECKING CRITICAL COLUMNS:'
\echo '-----------------------------'
\echo 'bill_cosponsor.bioguide_id (sync service needs this):'
SELECT 
    CASE 
        WHEN column_name = 'bioguide_id' THEN '✓ Present'
        ELSE '⚠ Missing'
    END as bioguide_id_status
FROM information_schema.columns 
WHERE table_name = 'bill_cosponsor' AND column_name = 'bioguide_id';

\echo 'bill_summary.update_date (sync service needs this):'
SELECT 
    CASE 
        WHEN column_name = 'update_date' THEN '✓ Present'
        ELSE '⚠ Missing'
    END as update_date_status
FROM information_schema.columns 
WHERE table_name = 'bill_summary' AND column_name = 'update_date';

\echo 'bill_committee_activity.committee_name (sync service needs this):'
SELECT 
    CASE 
        WHEN column_name = 'committee_name' THEN '✓ Present'
        ELSE '⚠ Missing'
    END as committee_name_status
FROM information_schema.columns 
WHERE table_name = 'bill_committee_activity' AND column_name = 'committee_name';

\echo ''

-- Check indexes
\echo '7. CHECKING PERFORMANCE INDEXES:'
\echo '--------------------------------'
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND (indexname LIKE '%cosponsor%' OR indexname LIKE '%summary%' OR indexname LIKE '%sync%')
ORDER BY tablename, indexname;

\echo ''
\echo '=========================================='
\echo 'VERIFICATION COMPLETE'
\echo '=========================================='
\echo ''
\echo 'If you see ✓ symbols, those items are configured correctly.'
\echo 'If you see ⚠ symbols, those items need attention.'
\echo ''
\echo 'Next steps after verification:'
\echo '1. Update sync-service/.env with congress_sync_writer credentials'
\echo '2. Restart the sync service'
\echo '3. Monitor logs to confirm errors are resolved'