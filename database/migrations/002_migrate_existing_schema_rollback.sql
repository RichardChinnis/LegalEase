-- Rollback for 002_migrate_existing_schema.sql

BEGIN;

-- Drop new schema elements
DROP VIEW IF EXISTS conversation_summaries;
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS idx_messages_created_at;
DROP INDEX IF EXISTS idx_messages_conversation_id;
DROP INDEX IF EXISTS idx_conversations_hearing;
DROP INDEX IF EXISTS idx_conversations_bill;
DROP INDEX IF EXISTS idx_conversations_updated_at;

-- Drop new tables
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;

-- Restore old conversations table if backup exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'conversations_backup_old' AND table_schema = 'public') THEN
        ALTER TABLE conversations_backup_old RENAME TO conversations;
        RAISE NOTICE 'Restored conversations table from backup';
    END IF;
END
$$;

COMMIT;