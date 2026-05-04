-- Rollback for 001_initial_schema.sql

-- Drop view
DROP VIEW IF EXISTS conversation_summaries;

-- Drop trigger and function
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS idx_messages_created_at;
DROP INDEX IF EXISTS idx_messages_conversation_id;
DROP INDEX IF EXISTS idx_conversations_hearing;
DROP INDEX IF EXISTS idx_conversations_bill;
DROP INDEX IF EXISTS idx_conversations_updated_at;

-- Drop tables (messages first due to foreign key)
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;