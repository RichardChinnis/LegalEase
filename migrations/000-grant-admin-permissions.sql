-- Grant necessary permissions to congress_admin for schema management
-- Run this as postgres superuser FIRST, then run the schema fix
-- Usage: sudo -u postgres psql -d congress_api -f 000-grant-admin-permissions.sql

\echo '=============================================='
\echo 'GRANTING SCHEMA MANAGEMENT PERMISSIONS'
\echo '=============================================='
\echo ''

-- Grant CREATE privileges on public schema (needed for sequences, constraints, etc.)
GRANT CREATE ON SCHEMA public TO congress_admin;
\echo '✓ Granted CREATE on SCHEMA public to congress_admin'

-- Grant CREATEROLE privilege (needed to alter role connection limits)
ALTER ROLE congress_admin CREATEROLE;  
\echo '✓ Granted CREATEROLE to congress_admin'

-- Grant USAGE on public schema (should already have but ensure it)
GRANT USAGE ON SCHEMA public TO congress_admin;
\echo '✓ Granted USAGE on SCHEMA public to congress_admin'

-- Grant privileges to create/manage sequences (part of CREATE but explicit)
GRANT CREATE ON DATABASE congress_api TO congress_admin;
\echo '✓ Granted CREATE on DATABASE congress_api to congress_admin'

-- Verify the permissions were granted
\echo ''
\echo 'VERIFYING PERMISSIONS:'

SELECT 
  'congress_admin schema permissions:' as info,
  has_schema_privilege('congress_admin', 'public', 'CREATE') as can_create,
  has_schema_privilege('congress_admin', 'public', 'USAGE') as can_use;

SELECT 
  'congress_admin role attributes:' as info,
  rolcreaterole as has_createrole,
  rolcreatedb as has_createdb,
  rolsuper as is_superuser
FROM pg_roles 
WHERE rolname = 'congress_admin';

\echo ''
\echo '=============================================='
\echo 'PERMISSION GRANTS COMPLETED!'
\echo '=============================================='
\echo ''
\echo 'congress_admin now has:'
\echo '• CREATE privileges on public schema'  
\echo '• CREATEROLE privileges (can alter role limits)'
\echo '• Full ability to manage database schema'
\echo ''
\echo 'Next step: Run the schema fix as congress_admin:'
\echo 'export PGPASSWORD=<your-congress_admin-password>  # from backend/.env'
\echo 'psql -h localhost -U congress_admin -d congress_api -f migrations/008-definitive-schema-fix-v2.sql'