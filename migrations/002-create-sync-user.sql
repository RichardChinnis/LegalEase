-- Step 2: Create Sync Service User
-- This creates a dedicated user for the sync service with appropriate permissions.
-- Run as postgres superuser or database admin.
--
-- IMPORTANT: Replace 'CHANGE_ME_BEFORE_RUNNING' below with a strong password
-- (generate with: `openssl rand -base64 32 | tr -d '+/=' | head -c 32`)
-- BEFORE running this script. Then put the same value in sync-service/.env
-- as DB_PASSWORD.

\echo 'Creating congress_sync_writer user...'

-- Create the sync service user
CREATE USER congress_sync_writer WITH
    PASSWORD 'CHANGE_ME_BEFORE_RUNNING'
    NOSUPERUSER 
    NOCREATEDB 
    NOCREATEROLE 
    NOINHERIT 
    LOGIN 
    NOREPLICATION 
    NOBYPASSRLS
    CONNECTION LIMIT 10;

-- Grant basic database access
GRANT CONNECT ON DATABASE congress_api TO congress_sync_writer;
GRANT USAGE ON SCHEMA public TO congress_sync_writer;

-- Add comment to document the user's purpose
COMMENT ON ROLE congress_sync_writer IS 'Dedicated user for Congress API sync service - has read/write access to sync data';

\echo 'congress_sync_writer user created successfully'
\echo 'IMPORTANT: Replace CHANGE_ME_BEFORE_RUNNING above with a strong password'
\echo 'before executing this script, then update sync-service/.env to match.'