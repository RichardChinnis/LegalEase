-- ============================================================================
-- Congressional Activity Dashboard - Database Schema
-- ============================================================================
-- Created: 2025-11-29
-- Description: Three tables for editorial curation, AI summaries, and user follows
-- Database: PostgreSQL (congress_api)
-- ============================================================================

-- ============================================================================
-- Table 1: spotlight_bill
-- Purpose: Store editorially curated "In the News" bills
-- ============================================================================

CREATE TABLE spotlight_bill (
    -- Primary Key
    spotlight_id SERIAL PRIMARY KEY,

    -- Foreign Key to bill table
    bill_id VARCHAR(255) NOT NULL,

    -- Display Content
    headline VARCHAR(500) NOT NULL,
    news_context TEXT NOT NULL,

    -- Organization & Display
    priority INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(50) NOT NULL,

    -- Status & Lifecycle
    is_active BOOLEAN NOT NULL DEFAULT true,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,

    -- Audit Trail
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT fk_spotlight_bill
        FOREIGN KEY (bill_id)
        REFERENCES bill(bill_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_category
        CHECK (category IN ('breaking', 'trending', 'upcoming_vote', 'just_passed')),

    CONSTRAINT chk_dates
        CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),

    CONSTRAINT chk_priority
        CHECK (priority >= 0)
);

-- Indexes for spotlight_bill
CREATE INDEX idx_spotlight_active_priority
    ON spotlight_bill(is_active, priority DESC)
    WHERE is_active = true;

CREATE INDEX idx_spotlight_category
    ON spotlight_bill(category, priority DESC)
    WHERE is_active = true;

CREATE INDEX idx_spotlight_bill_id
    ON spotlight_bill(bill_id);

CREATE INDEX idx_spotlight_dates
    ON spotlight_bill(start_date, end_date)
    WHERE is_active = true;

-- Comments
COMMENT ON TABLE spotlight_bill IS 'Editorially curated bills that should be prominently displayed on the dashboard';
COMMENT ON COLUMN spotlight_bill.priority IS 'Higher values appear more prominently (0 = lowest priority)';
COMMENT ON COLUMN spotlight_bill.category IS 'Type of news relevance: breaking, trending, upcoming_vote, just_passed';
COMMENT ON COLUMN spotlight_bill.news_context IS 'Explanation of why this bill is currently newsworthy';

-- ============================================================================
-- Table 2: bill_summary_enhanced
-- Purpose: Store AI-generated summaries and analysis for bills
-- ============================================================================

CREATE TABLE bill_summary_enhanced (
    -- Primary Key
    summary_id SERIAL PRIMARY KEY,

    -- Foreign Key to bill table
    bill_id VARCHAR(255) NOT NULL,

    -- Summary Type & Content
    summary_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,

    -- Debate Analysis (for 'the_debate' type)
    the_debate_supporters TEXT,
    the_debate_critics TEXT,

    -- Categorization & Tagging
    affects_tags TEXT[] DEFAULT '{}',

    -- Generation Metadata
    generated_by VARCHAR(50) NOT NULL DEFAULT 'manual',
    confidence_score DECIMAL(3,2),

    -- Audit Trail
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT fk_bill_summary_enhanced
        FOREIGN KEY (bill_id)
        REFERENCES bill(bill_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_bill_summary_type
        UNIQUE (bill_id, summary_type),

    CONSTRAINT chk_summary_type
        CHECK (summary_type IN ('one_liner', 'cocktail_party', 'eli5', 'the_debate')),

    CONSTRAINT chk_generated_by
        CHECK (generated_by IN ('manual', 'claude', 'gpt4', 'gemini', 'other')),

    CONSTRAINT chk_confidence_score
        CHECK (confidence_score IS NULL OR (confidence_score >= 0.0 AND confidence_score <= 1.0)),

    CONSTRAINT chk_debate_fields
        CHECK (
            (summary_type = 'the_debate' AND the_debate_supporters IS NOT NULL AND the_debate_critics IS NOT NULL) OR
            (summary_type != 'the_debate' AND the_debate_supporters IS NULL AND the_debate_critics IS NULL)
        )
);

-- Indexes for bill_summary_enhanced
CREATE INDEX idx_bill_summary_enhanced_bill_id
    ON bill_summary_enhanced(bill_id);

CREATE INDEX idx_bill_summary_enhanced_type
    ON bill_summary_enhanced(summary_type);

CREATE INDEX idx_bill_summary_enhanced_tags
    ON bill_summary_enhanced USING GIN(affects_tags);

CREATE INDEX idx_bill_summary_enhanced_generated_by
    ON bill_summary_enhanced(generated_by, created_at DESC);

-- Comments
COMMENT ON TABLE bill_summary_enhanced IS 'AI-generated summaries and analysis for bills in various formats';
COMMENT ON COLUMN bill_summary_enhanced.summary_type IS 'Type of summary: one_liner, cocktail_party, eli5, the_debate';
COMMENT ON COLUMN bill_summary_enhanced.affects_tags IS 'Array of topics/areas affected by the bill (e.g., healthcare, taxes, veterans)';
COMMENT ON COLUMN bill_summary_enhanced.generated_by IS 'AI model or method used to generate the summary';
COMMENT ON COLUMN bill_summary_enhanced.confidence_score IS 'Optional confidence score between 0.0 and 1.0';
COMMENT ON COLUMN bill_summary_enhanced.the_debate_supporters IS 'What supporters say about the bill (only for the_debate type)';
COMMENT ON COLUMN bill_summary_enhanced.the_debate_critics IS 'What critics say about the bill (only for the_debate type)';

-- ============================================================================
-- Table 3: user_follow
-- Purpose: Allow users to follow bills, topics, and members
-- ============================================================================

CREATE TABLE user_follow (
    -- Primary Key
    follow_id SERIAL PRIMARY KEY,

    -- User Identification (supports anonymous session IDs)
    user_id VARCHAR(255) NOT NULL,

    -- Follow Target
    follow_type VARCHAR(50) NOT NULL,
    follow_target_id VARCHAR(255) NOT NULL,

    -- Notification Preference
    notify BOOLEAN NOT NULL DEFAULT false,

    -- Audit Trail
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_user_follow
        UNIQUE (user_id, follow_type, follow_target_id),

    CONSTRAINT chk_follow_type
        CHECK (follow_type IN ('bill', 'topic', 'member'))
);

-- Indexes for user_follow
CREATE INDEX idx_user_follow_user_id
    ON user_follow(user_id);

CREATE INDEX idx_user_follow_type_target
    ON user_follow(follow_type, follow_target_id);

CREATE INDEX idx_user_follow_notify
    ON user_follow(user_id, notify)
    WHERE notify = true;

CREATE INDEX idx_user_follow_created
    ON user_follow(user_id, created_at DESC);

-- Comments
COMMENT ON TABLE user_follow IS 'User follows for bills, topics, and members';
COMMENT ON COLUMN user_follow.user_id IS 'User identifier (can be anonymous session ID or authenticated user ID)';
COMMENT ON COLUMN user_follow.follow_type IS 'Type of entity being followed: bill, topic, or member';
COMMENT ON COLUMN user_follow.follow_target_id IS 'The ID of the entity being followed (bill_id, topic name, or bioguide_id)';
COMMENT ON COLUMN user_follow.notify IS 'Whether user wants notifications for updates to this follow';

-- ============================================================================
-- Helper Views
-- ============================================================================

-- View: Active Spotlight Bills with Bill Details
CREATE OR REPLACE VIEW v_active_spotlight_bills AS
SELECT
    s.spotlight_id,
    s.bill_id,
    s.headline,
    s.news_context,
    s.priority,
    s.category,
    s.start_date,
    s.end_date,
    s.created_at,
    b.title,
    b.bill_type,
    b.bill_number,
    b.introduced_date,
    b.latest_action_date,
    b.latest_action_text,
    b.policy_area
FROM spotlight_bill s
JOIN bill b ON s.bill_id = b.bill_id
WHERE s.is_active = true
  AND (s.start_date IS NULL OR s.start_date <= NOW())
  AND (s.end_date IS NULL OR s.end_date >= NOW())
ORDER BY s.priority DESC, s.created_at DESC;

COMMENT ON VIEW v_active_spotlight_bills IS 'Currently active spotlight bills with full bill details, ordered by priority';

-- View: Bill Summaries with Bill Details
CREATE OR REPLACE VIEW v_bill_summaries_complete AS
SELECT
    bse.summary_id,
    bse.bill_id,
    bse.summary_type,
    bse.content,
    bse.the_debate_supporters,
    bse.the_debate_critics,
    bse.affects_tags,
    bse.generated_by,
    bse.confidence_score,
    bse.created_at,
    b.title,
    b.bill_type,
    b.bill_number,
    b.congress_id,
    b.introduced_date,
    b.policy_area
FROM bill_summary_enhanced bse
JOIN bill b ON bse.bill_id = b.bill_id
ORDER BY bse.created_at DESC;

COMMENT ON VIEW v_bill_summaries_complete IS 'Enhanced bill summaries with complete bill details';

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function: Get User's Followed Bills with Details
CREATE OR REPLACE FUNCTION get_user_followed_bills(p_user_id VARCHAR)
RETURNS TABLE (
    bill_id VARCHAR,
    title TEXT,
    bill_type VARCHAR,
    bill_number VARCHAR,
    latest_action_date DATE,
    latest_action_text TEXT,
    followed_at TIMESTAMP WITH TIME ZONE,
    notify BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.bill_id,
        b.title,
        b.bill_type::VARCHAR,
        b.bill_number,
        b.latest_action_date,
        b.latest_action_text,
        uf.created_at,
        uf.notify
    FROM user_follow uf
    JOIN bill b ON uf.follow_target_id = b.bill_id
    WHERE uf.user_id = p_user_id
      AND uf.follow_type = 'bill'
    ORDER BY uf.created_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_followed_bills IS 'Returns all bills followed by a specific user with bill details';

-- ============================================================================
-- Sample Data (Optional - for testing)
-- ============================================================================

-- Uncomment to insert sample data:
/*
-- Sample spotlight bill
INSERT INTO spotlight_bill (
    bill_id,
    headline,
    news_context,
    priority,
    category,
    created_by
)
SELECT
    bill_id,
    'Sample Spotlight: ' || SUBSTRING(title, 1, 50),
    'This bill is being featured as a test of the spotlight system.',
    100,
    'trending',
    'system'
FROM bill
WHERE congress_id = 119
LIMIT 1
ON CONFLICT DO NOTHING;

-- Sample enhanced summaries
INSERT INTO bill_summary_enhanced (bill_id, summary_type, content, generated_by, affects_tags)
SELECT
    bill_id,
    'one_liner',
    'A concise one-line summary of this legislation.',
    'claude',
    ARRAY['sample', 'test']
FROM bill
WHERE congress_id = 119
LIMIT 1
ON CONFLICT (bill_id, summary_type) DO NOTHING;

-- Sample user follow
INSERT INTO user_follow (user_id, follow_type, follow_target_id, notify)
SELECT
    'sample_user_123',
    'bill',
    bill_id,
    true
FROM bill
WHERE congress_id = 119
LIMIT 1
ON CONFLICT (user_id, follow_type, follow_target_id) DO NOTHING;
*/

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Verify tables were created
SELECT
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('spotlight_bill', 'bill_summary_enhanced', 'user_follow')
ORDER BY table_name;

-- Verify indexes
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('spotlight_bill', 'bill_summary_enhanced', 'user_follow')
ORDER BY tablename, indexname;

-- Verify views
SELECT
    table_name,
    view_definition
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN ('v_active_spotlight_bills', 'v_bill_summaries_complete')
ORDER BY table_name;

-- ============================================================================
-- End of Schema Definition
-- ============================================================================
