-- Congress API Database Schema
-- Migration: 001_initial_schema.sql

-- Create conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_type VARCHAR(10),
    bill_number VARCHAR(20),
    bill_congress VARCHAR(10),
    bill_title TEXT,
    jacket_number VARCHAR(50), -- For hearings
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    context_config JSONB NOT NULL,
    context_data JSONB NOT NULL,
    token_count INTEGER DEFAULT 0,
    is_hearing BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    token_count INTEGER DEFAULT 0,
    token_usage JSONB,
    streaming BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_bill ON conversations(bill_type, bill_number, bill_congress);
CREATE INDEX idx_conversations_hearing ON conversations(jacket_number) WHERE is_hearing = TRUE;
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(conversation_id, created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for conversations
CREATE TRIGGER update_conversations_updated_at 
    BEFORE UPDATE ON conversations 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for conversation summaries
CREATE VIEW conversation_summaries AS
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
FROM conversations c
LEFT JOIN messages m ON c.id = m.conversation_id
GROUP BY c.id, c.bill_type, c.bill_number, c.bill_congress, c.bill_title, 
         c.jacket_number, c.provider, c.model, c.is_hearing, c.created_at, 
         c.updated_at, c.token_count;