-- Step 5: Restrict Backend API User to Read-Only
-- Removes write permissions from congress_api_backend to enforce read-only access
-- Run as congress_admin (table owner) or postgres superuser

\echo 'Restricting congress_api_backend to read-only access...'

-- First, revoke any existing write permissions
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM congress_api_backend;

-- Revoke sequence permissions (prevents auto-increment usage)
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM congress_api_backend;

-- Grant only SELECT permission on all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO congress_api_backend;

-- Ensure future tables are also read-only for backend user
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT SELECT ON TABLES TO congress_api_backend;

-- Remove any default write privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    REVOKE INSERT, UPDATE, DELETE ON TABLES FROM congress_api_backend;

-- Verify backend user now has only read permissions
\echo ''
\echo 'Verifying congress_api_backend permissions (should only show SELECT):'
SELECT 
    table_name,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) as privileges
FROM information_schema.role_table_grants 
WHERE grantee = 'congress_api_backend' 
  AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

-- Show if there are any remaining write permissions (should be empty)
\echo ''
\echo 'Checking for any remaining write permissions (should be empty):'
SELECT 
    table_name,
    privilege_type
FROM information_schema.role_table_grants 
WHERE grantee = 'congress_api_backend' 
  AND table_schema = 'public'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
ORDER BY table_name, privilege_type;

\echo ''
\echo 'Backend user successfully restricted to read-only access'