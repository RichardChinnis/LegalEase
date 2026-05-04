-- Grant permissions for congress_api_backend user
-- Run this as the postgres superuser or database owner

-- Connect to the congress_api database first
\c congress_api;

-- Grant schema usage and creation permissions
GRANT USAGE ON SCHEMA public TO congress_api_backend;
GRANT CREATE ON SCHEMA public TO congress_api_backend;

-- Grant all privileges on existing tables (if any)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO congress_api_backend;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO congress_api_backend;

-- Grant privileges on future tables and sequences
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO congress_api_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO congress_api_backend;

-- Verify permissions
\dp public.*