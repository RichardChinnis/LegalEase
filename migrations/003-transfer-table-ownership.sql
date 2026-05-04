-- Step 3: Transfer Table Ownership to Admin User
-- This ensures the admin user owns all tables for schema management
-- Run as postgres superuser

\echo 'Transferring table ownership to congress_admin...'

-- Transfer ownership of all tables to admin user
DO $$
DECLARE
    r RECORD;
    table_count INTEGER := 0;
BEGIN
    -- Get all tables in public schema
    FOR r IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        ORDER BY tablename
    LOOP
        -- Transfer ownership
        EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO congress_admin';
        table_count := table_count + 1;
        RAISE NOTICE 'Transferred ownership of table: %', r.tablename;
    END LOOP;
    
    RAISE NOTICE 'Total tables transferred: %', table_count;
END$$;

\echo ''
\echo 'Transferring sequence ownership to congress_admin...'

-- Transfer ownership of all sequences to admin user
DO $$
DECLARE
    r RECORD;
    seq_count INTEGER := 0;
BEGIN
    -- Get all sequences in public schema
    FOR r IN 
        SELECT sequencename 
        FROM pg_sequences 
        WHERE schemaname = 'public' 
        ORDER BY sequencename
    LOOP
        -- Transfer ownership
        EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequencename) || ' OWNER TO congress_admin';
        seq_count := seq_count + 1;
        RAISE NOTICE 'Transferred ownership of sequence: %', r.sequencename;
    END LOOP;
    
    RAISE NOTICE 'Total sequences transferred: %', seq_count;
END$$;

\echo ''
\echo 'Ownership transfer completed successfully'