#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const { Pool } = require('../backend/node_modules/pg');

async function setupFreshSchema() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    console.log('Setting up fresh schema for Congress API...\n');
    
    // Create new tables with different names to avoid conflicts
    console.log('Creating chat_conversations table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          bill_type VARCHAR(10),
          bill_number VARCHAR(20),
          bill_congress VARCHAR(10),
          bill_title TEXT,
          jacket_number VARCHAR(50),
          provider VARCHAR(50) NOT NULL,
          model VARCHAR(100) NOT NULL,
          context_config JSONB NOT NULL,
          context_data JSONB NOT NULL,
          token_count INTEGER DEFAULT 0,
          is_hearing BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ Created chat_conversations table');

    console.log('Creating chat_messages table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          token_count INTEGER DEFAULT 0,
          token_usage JSONB,
          streaming BOOLEAN DEFAULT FALSE,
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ Created chat_messages table');

    console.log('Creating indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_bill ON chat_conversations(bill_type, bill_number, bill_congress);
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_hearing ON chat_conversations(jacket_number) WHERE is_hearing = TRUE;
      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(conversation_id, created_at);
    `);
    console.log('✓ Created indexes');

    console.log('Creating update trigger...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_chat_conversations_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      DROP TRIGGER IF EXISTS update_chat_conversations_updated_at ON chat_conversations;
      CREATE TRIGGER update_chat_conversations_updated_at 
          BEFORE UPDATE ON chat_conversations 
          FOR EACH ROW 
          EXECUTE FUNCTION update_chat_conversations_updated_at();
    `);
    console.log('✓ Created update trigger');

    console.log('Creating summary view...');
    await pool.query(`
      CREATE OR REPLACE VIEW chat_conversation_summaries AS
      SELECT 
          c.id,
          c.bill_type,
          c.bill_number,
          c.bill_congress,
          c.bill_title,
          c.jacket_number,
          c.provider,
          c.model,
          c.is_hearing,
          c.created_at,
          c.updated_at,
          COUNT(m.id) as message_count,
          COALESCE(SUM(m.token_count), 0) as total_message_tokens,
          c.token_count as context_tokens,
          (COALESCE(SUM(m.token_count), 0) + c.token_count) as total_tokens
      FROM chat_conversations c
      LEFT JOIN chat_messages m ON c.id = m.conversation_id
      GROUP BY c.id, c.bill_type, c.bill_number, c.bill_congress, c.bill_title, 
               c.jacket_number, c.provider, c.model, c.is_hearing, c.created_at, 
               c.updated_at, c.token_count;
    `);
    console.log('✓ Created summary view');

    // Mark migrations as complete
    await pool.query(`
      INSERT INTO migrations (filename) 
      VALUES ('001_initial_schema.sql'), ('002_migrate_existing_schema.sql')
      ON CONFLICT (filename) DO NOTHING
    `);
    console.log('✓ Updated migration records');
    
    console.log('\n✅ Fresh schema setup completed successfully!');
    console.log('\nThe Congress API chat service will now use:');
    console.log('  - chat_conversations (instead of conversations)');
    console.log('  - chat_messages (instead of messages)');
    console.log('  - Your existing tables remain untouched');
    
  } catch (error) {
    console.error('Setup failed:', error.message);
    console.error('Detail:', error.detail || '');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupFreshSchema();