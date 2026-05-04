-- ============================================================================
-- Congressional Activity Dashboard - Common Query Examples
-- ============================================================================
-- This file contains commonly used queries for the dashboard tables
-- ============================================================================

-- ============================================================================
-- SPOTLIGHT_BILL QUERIES
-- ============================================================================

-- Get all active spotlights ordered by priority
SELECT * FROM spotlight_bill
WHERE is_active = true
ORDER BY priority DESC, created_at DESC;

-- Get active spotlights using the helper view (includes bill details)
SELECT * FROM v_active_spotlight_bills;

-- Get breaking news spotlights
SELECT * FROM spotlight_bill
WHERE is_active = true
  AND category = 'breaking'
ORDER BY priority DESC;

-- Get spotlights by category with bill details
SELECT
    s.*,
    b.title,
    b.latest_action_text
FROM spotlight_bill s
JOIN bill b ON s.bill_id = b.bill_id
WHERE s.is_active = true
  AND s.category = 'upcoming_vote'
ORDER BY s.priority DESC;

-- Add a new spotlight
INSERT INTO spotlight_bill (
    bill_id,
    headline,
    news_context,
    priority,
    category,
    created_by
) VALUES (
    '119-HR-1234',
    'Immigration Reform Bill Heads to Senate Vote',
    'After months of debate, this comprehensive immigration reform bill has passed the House and is scheduled for a Senate vote next week.',
    100,
    'upcoming_vote',
    'admin_user'
);

-- Update a spotlight's priority
UPDATE spotlight_bill
SET priority = 150
WHERE spotlight_id = 1;

-- Deactivate a spotlight
UPDATE spotlight_bill
SET is_active = false
WHERE spotlight_id = 1;

-- Set time-limited spotlight (7 days)
UPDATE spotlight_bill
SET start_date = NOW(),
    end_date = NOW() + INTERVAL '7 days'
WHERE spotlight_id = 1;

-- Deactivate expired spotlights
UPDATE spotlight_bill
SET is_active = false
WHERE is_active = true
  AND end_date IS NOT NULL
  AND end_date < NOW();

-- Get spotlight statistics
SELECT
    category,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE is_active = true) as active,
    AVG(priority) as avg_priority
FROM spotlight_bill
GROUP BY category
ORDER BY total DESC;

-- ============================================================================
-- BILL_SUMMARY_ENHANCED QUERIES
-- ============================================================================

-- Get all summaries for a specific bill
SELECT * FROM bill_summary_enhanced
WHERE bill_id = '119-HR-1234'
ORDER BY
    CASE summary_type
        WHEN 'one_liner' THEN 1
        WHEN 'cocktail_party' THEN 2
        WHEN 'eli5' THEN 3
        WHEN 'the_debate' THEN 4
    END;

-- Get cocktail party summary for a bill
SELECT content
FROM bill_summary_enhanced
WHERE bill_id = '119-HR-1234'
  AND summary_type = 'cocktail_party';

-- Get all summaries with bill details
SELECT * FROM v_bill_summaries_complete
WHERE bill_id = '119-HR-1234';

-- Add a one-liner summary
INSERT INTO bill_summary_enhanced (
    bill_id,
    summary_type,
    content,
    generated_by,
    confidence_score,
    affects_tags
) VALUES (
    '119-HR-1234',
    'one_liner',
    'Reforms immigration system by creating new pathways to citizenship for undocumented workers.',
    'claude',
    0.92,
    ARRAY['immigration', 'border_security']
);

-- Add a debate-style summary
INSERT INTO bill_summary_enhanced (
    bill_id,
    summary_type,
    content,
    the_debate_supporters,
    the_debate_critics,
    generated_by,
    affects_tags
) VALUES (
    '119-HR-1234',
    'the_debate',
    'This bill fundamentally reforms how America handles immigration.',
    'Supporters argue this bill provides a humane solution that acknowledges economic realities while maintaining border security.',
    'Critics contend it amounts to amnesty and may encourage future illegal immigration.',
    'claude',
    ARRAY['immigration', 'border_security', 'labor', 'economics']
);

-- Update existing summary
UPDATE bill_summary_enhanced
SET content = 'Updated summary text...',
    confidence_score = 0.95
WHERE bill_id = '119-HR-1234'
  AND summary_type = 'cocktail_party';

-- Find bills with healthcare-related summaries
SELECT DISTINCT
    bill_id,
    summary_type,
    content
FROM bill_summary_enhanced
WHERE 'healthcare' = ANY(affects_tags)
ORDER BY created_at DESC;

-- Find bills tagged with multiple topics
SELECT
    bill_id,
    affects_tags,
    COUNT(*) as summary_count
FROM bill_summary_enhanced
WHERE affects_tags && ARRAY['healthcare', 'taxes']  -- overlaps with array
GROUP BY bill_id, affects_tags;

-- Get summaries by AI model with high confidence
SELECT
    bill_id,
    summary_type,
    content,
    confidence_score
FROM bill_summary_enhanced
WHERE generated_by = 'claude'
  AND confidence_score >= 0.85
ORDER BY confidence_score DESC, created_at DESC;

-- Get bills missing certain summary types
SELECT DISTINCT b.bill_id, b.title
FROM bill b
LEFT JOIN bill_summary_enhanced bse
    ON b.bill_id = bse.bill_id
    AND bse.summary_type = 'cocktail_party'
WHERE b.congress_id = 119
  AND bse.summary_id IS NULL
LIMIT 10;

-- Summary type coverage statistics
SELECT
    summary_type,
    COUNT(*) as count,
    AVG(confidence_score) as avg_confidence
FROM bill_summary_enhanced
GROUP BY summary_type
ORDER BY count DESC;

-- Tag frequency analysis
SELECT
    tag,
    COUNT(*) as frequency
FROM (
    SELECT unnest(affects_tags) as tag
    FROM bill_summary_enhanced
) tags
GROUP BY tag
ORDER BY frequency DESC
LIMIT 20;

-- ============================================================================
-- USER_FOLLOW QUERIES
-- ============================================================================

-- User follows a bill
INSERT INTO user_follow (user_id, follow_type, follow_target_id, notify)
VALUES ('user_12345', 'bill', '119-HR-1234', true)
ON CONFLICT (user_id, follow_type, follow_target_id)
DO UPDATE SET notify = EXCLUDED.notify;

-- User follows a topic
INSERT INTO user_follow (user_id, follow_type, follow_target_id, notify)
VALUES ('user_12345', 'topic', 'healthcare', false);

-- User follows a member
INSERT INTO user_follow (user_id, follow_type, follow_target_id, notify)
VALUES ('user_12345', 'member', 'S000148', true);

-- Get all follows for a user
SELECT * FROM user_follow
WHERE user_id = 'user_12345'
ORDER BY created_at DESC;

-- Get user's followed bills (basic)
SELECT follow_target_id as bill_id, notify, created_at
FROM user_follow
WHERE user_id = 'user_12345'
  AND follow_type = 'bill'
ORDER BY created_at DESC;

-- Get user's followed bills with details (using helper function)
SELECT * FROM get_user_followed_bills('user_12345');

-- Get user's followed bills with details (manual join)
SELECT
    uf.follow_id,
    b.bill_id,
    b.title,
    b.bill_type,
    b.bill_number,
    b.latest_action_date,
    b.latest_action_text,
    uf.notify,
    uf.created_at as followed_at
FROM user_follow uf
JOIN bill b ON uf.follow_target_id = b.bill_id
WHERE uf.user_id = 'user_12345'
  AND uf.follow_type = 'bill'
ORDER BY uf.created_at DESC;

-- Get user's followed members with details
SELECT
    uf.follow_id,
    m.bioguide_id,
    m.first_name,
    m.last_name,
    m.direct_order_name,
    uf.notify,
    uf.created_at as followed_at
FROM user_follow uf
JOIN member m ON uf.follow_target_id = m.bioguide_id
WHERE uf.user_id = 'user_12345'
  AND uf.follow_type = 'member'
ORDER BY uf.created_at DESC;

-- Unfollow a bill
DELETE FROM user_follow
WHERE user_id = 'user_12345'
  AND follow_type = 'bill'
  AND follow_target_id = '119-HR-1234';

-- Toggle notification preference
UPDATE user_follow
SET notify = NOT notify
WHERE user_id = 'user_12345'
  AND follow_type = 'bill'
  AND follow_target_id = '119-HR-1234';

-- Enable notifications for all follows
UPDATE user_follow
SET notify = true
WHERE user_id = 'user_12345';

-- Get users who want notifications for a specific bill
SELECT user_id, created_at
FROM user_follow
WHERE follow_type = 'bill'
  AND follow_target_id = '119-HR-1234'
  AND notify = true;

-- Count followers by bill (most followed bills)
SELECT
    follow_target_id as bill_id,
    COUNT(*) as follower_count,
    COUNT(*) FILTER (WHERE notify = true) as notification_count
FROM user_follow
WHERE follow_type = 'bill'
GROUP BY follow_target_id
ORDER BY follower_count DESC
LIMIT 10;

-- Get user's follow summary by type
SELECT
    follow_type,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE notify = true) as with_notifications
FROM user_follow
WHERE user_id = 'user_12345'
GROUP BY follow_type;

-- Find bills followed by multiple users
SELECT
    follow_target_id as bill_id,
    b.title,
    COUNT(DISTINCT user_id) as unique_followers
FROM user_follow uf
JOIN bill b ON uf.follow_target_id = b.bill_id
WHERE follow_type = 'bill'
GROUP BY follow_target_id, b.title
HAVING COUNT(DISTINCT user_id) > 1
ORDER BY unique_followers DESC;

-- Get recent follows across all users (activity feed)
SELECT
    user_id,
    follow_type,
    follow_target_id,
    created_at
FROM user_follow
ORDER BY created_at DESC
LIMIT 50;

-- ============================================================================
-- COMBINED QUERIES
-- ============================================================================

-- Get spotlight bills with summaries
SELECT
    s.spotlight_id,
    s.headline,
    s.category,
    s.priority,
    b.bill_id,
    b.title,
    bse.content as one_liner,
    bse2.content as cocktail_party
FROM spotlight_bill s
JOIN bill b ON s.bill_id = b.bill_id
LEFT JOIN bill_summary_enhanced bse
    ON b.bill_id = bse.bill_id
    AND bse.summary_type = 'one_liner'
LEFT JOIN bill_summary_enhanced bse2
    ON b.bill_id = bse2.bill_id
    AND bse2.summary_type = 'cocktail_party'
WHERE s.is_active = true
ORDER BY s.priority DESC;

-- Get user's followed bills that are currently spotlighted
SELECT
    b.bill_id,
    b.title,
    s.headline,
    s.category,
    s.priority,
    uf.notify
FROM user_follow uf
JOIN bill b ON uf.follow_target_id = b.bill_id
JOIN spotlight_bill s ON b.bill_id = s.bill_id
WHERE uf.user_id = 'user_12345'
  AND uf.follow_type = 'bill'
  AND s.is_active = true
ORDER BY s.priority DESC;

-- Get trending topics based on follows
SELECT
    unnest(affects_tags) as topic,
    COUNT(DISTINCT bse.bill_id) as bill_count,
    COUNT(DISTINCT uf.user_id) as follower_count
FROM bill_summary_enhanced bse
LEFT JOIN user_follow uf
    ON bse.bill_id = uf.follow_target_id
    AND uf.follow_type = 'bill'
GROUP BY topic
ORDER BY follower_count DESC, bill_count DESC
LIMIT 20;

-- Personalized dashboard: User's followed bills with summaries
SELECT
    b.bill_id,
    b.title,
    b.latest_action_date,
    b.latest_action_text,
    uf.notify,
    bse.content as summary
FROM user_follow uf
JOIN bill b ON uf.follow_target_id = b.bill_id
LEFT JOIN bill_summary_enhanced bse
    ON b.bill_id = bse.bill_id
    AND bse.summary_type = 'cocktail_party'
WHERE uf.user_id = 'user_12345'
  AND uf.follow_type = 'bill'
ORDER BY b.latest_action_date DESC NULLS LAST;

-- Bills that are spotlighted AND followed by many users
SELECT
    s.spotlight_id,
    s.headline,
    s.category,
    b.bill_id,
    b.title,
    COUNT(uf.user_id) as follower_count
FROM spotlight_bill s
JOIN bill b ON s.bill_id = b.bill_id
LEFT JOIN user_follow uf
    ON b.bill_id = uf.follow_target_id
    AND uf.follow_type = 'bill'
WHERE s.is_active = true
GROUP BY s.spotlight_id, s.headline, s.category, b.bill_id, b.title, s.priority
ORDER BY s.priority DESC, follower_count DESC;

-- ============================================================================
-- MAINTENANCE & ANALYTICS QUERIES
-- ============================================================================

-- Table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    pg_total_relation_size(schemaname||'.'||tablename) as bytes
FROM pg_tables
WHERE tablename IN ('spotlight_bill', 'bill_summary_enhanced', 'user_follow')
ORDER BY bytes DESC;

-- Index usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE tablename IN ('spotlight_bill', 'bill_summary_enhanced', 'user_follow')
ORDER BY idx_scan DESC;

-- Row counts
SELECT
    'spotlight_bill' as table_name,
    COUNT(*) as total_rows,
    COUNT(*) FILTER (WHERE is_active = true) as active_rows
FROM spotlight_bill
UNION ALL
SELECT
    'bill_summary_enhanced',
    COUNT(*),
    COUNT(DISTINCT bill_id)
FROM bill_summary_enhanced
UNION ALL
SELECT
    'user_follow',
    COUNT(*),
    COUNT(DISTINCT user_id)
FROM user_follow;

-- Archive old inactive spotlights (older than 90 days)
DELETE FROM spotlight_bill
WHERE is_active = false
  AND updated_at < NOW() - INTERVAL '90 days';

-- Find duplicate or stale data
SELECT bill_id, COUNT(*)
FROM spotlight_bill
WHERE is_active = true
GROUP BY bill_id
HAVING COUNT(*) > 1;

-- Vacuum and analyze (for maintenance)
VACUUM ANALYZE spotlight_bill;
VACUUM ANALYZE bill_summary_enhanced;
VACUUM ANALYZE user_follow;

-- ============================================================================
-- End of Query Examples
-- ============================================================================
