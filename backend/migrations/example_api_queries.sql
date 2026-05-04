-- Example queries to demonstrate API-compatible data retrieval
-- These queries show how to fetch data that matches the Congress API response structure

-- ======================================
-- 1. GET MEMBER WITH FULL API STRUCTURE (matches Congress API response)
-- ======================================
-- This query returns data in the exact structure expected by the Congress API
SELECT json_build_object(
    'member', json_build_object(
        'bioguideId', m.bioguide_id,
        'firstName', m.first_name,
        'lastName', m.last_name,
        'middleName', m.middle_name,
        'suffixName', m.suffix_name,
        'nickname', m.nickname,
        'directOrderName', m.direct_order_name,
        'invertedOrderName', m.inverted_order_name,
        'honorificName', m.honorific_name,
        'birthYear', m.birth_year::text,
        'currentMember', m.current_member,
        'officialWebsiteUrl', m.official_url,
        
        -- Address Information
        'addressInformation', CASE 
            WHEN ma.member_bioguide_id IS NOT NULL THEN
                json_build_object(
                    'city', ma.city,
                    'district', ma.district,
                    'zipCode', ma.zip_code
                )
            ELSE NULL
        END,
        
        -- Depiction
        'depiction', CASE 
            WHEN m.depiction_url IS NOT NULL THEN
                json_build_object(
                    'imageUrl', m.depiction_url,
                    'attribution', m.depiction_attribution
                )
            ELSE NULL
        END,
        
        -- Legislation counts
        'sponsoredLegislation', CASE 
            WHEN mls.member_bioguide_id IS NOT NULL THEN
                json_build_object(
                    'count', mls.sponsored_legislation_count,
                    'url', mls.sponsored_legislation_url
                )
            ELSE json_build_object('count', 0, 'url', NULL)
        END,
        
        'cosponsoredLegislation', CASE 
            WHEN mls.member_bioguide_id IS NOT NULL THEN
                json_build_object(
                    'count', mls.cosponsored_legislation_count,
                    'url', mls.cosponsored_legislation_url
                )
            ELSE json_build_object('count', 0, 'url', NULL)
        END,
        
        -- Current state (from most recent term)
        'state', mt_current.state_name,
        
        -- Party History (as array)
        'partyHistory', COALESCE(
            (SELECT json_agg(
                json_build_object(
                    'partyAbbreviation', ph.party_abbreviation,
                    'partyName', ph.party_name,
                    'startYear', ph.start_year,
                    'endYear', ph.end_year
                ) ORDER BY ph.start_year
            ) FROM member_party_history ph WHERE ph.member_bioguide_id = m.bioguide_id),
            '[]'::json
        ),
        
        -- Previous Names (as array)
        'previousNames', COALESCE(
            (SELECT json_agg(
                json_build_object(
                    'firstName', pn.first_name,
                    'lastName', pn.last_name,
                    'middleName', pn.middle_name,
                    'suffixName', pn.suffix_name,
                    'nickname', pn.nickname,
                    'directOrderName', pn.direct_order_name,
                    'invertedOrderName', pn.inverted_order_name,
                    'startDate', pn.start_date,
                    'endDate', pn.end_date,
                    'nameType', pn.name_type
                ) ORDER BY pn.start_date
            ) FROM member_previous_names pn WHERE pn.member_bioguide_id = m.bioguide_id),
            '[]'::json
        ),
        
        -- Terms (as array with detailed information)
        'terms', COALESCE(
            (SELECT json_agg(
                json_build_object(
                    'congress', mt.congress,
                    'chamber', mt.chamber,
                    'memberType', mt.member_type,
                    'startYear', mt.start_year,
                    'endYear', mt.end_year,
                    'stateCode', mt.state_code,
                    'stateName', mt.state_name,
                    'partyCode', mt.party_code,
                    'partyName', mt.party_name,
                    'district', mt.district
                ) ORDER BY mt.congress DESC, mt.start_year DESC
            ) FROM member_term mt WHERE mt.member_bioguide_id = m.bioguide_id),
            '[]'::json
        )
    )
) as api_response
FROM member m
-- Current address
LEFT JOIN member_address ma ON m.bioguide_id = ma.member_bioguide_id 
    AND ma.is_active = TRUE AND ma.address_type = 'current'
-- Most recent term for current state
LEFT JOIN LATERAL (
    SELECT state_name, state_code, congress
    FROM member_term mt
    WHERE mt.member_bioguide_id = m.bioguide_id
    ORDER BY mt.congress DESC, mt.start_year DESC
    LIMIT 1
) mt_current ON true
-- Most recent legislation stats
LEFT JOIN LATERAL (
    SELECT * FROM member_legislation_stats mls_inner
    WHERE mls_inner.member_bioguide_id = m.bioguide_id
    ORDER BY mls_inner.congress DESC
    LIMIT 1
) mls ON true
WHERE m.bioguide_id = $1;  -- Parameter for specific member


-- ======================================
-- 2. GET CURRENT MEMBERS WITH PAGINATION
-- ======================================
SELECT 
    m.bioguide_id,
    m.direct_order_name,
    m.first_name,
    m.last_name,
    m.current_member,
    mt_current.state_name,
    mt_current.chamber,
    mt_current.party_name
FROM member m
LEFT JOIN LATERAL (
    SELECT state_name, chamber, party_name, congress
    FROM member_term mt
    WHERE mt.member_bioguide_id = m.bioguide_id
    ORDER BY mt.congress DESC, mt.start_year DESC
    LIMIT 1
) mt_current ON true
WHERE m.current_member = TRUE
ORDER BY m.last_name, m.first_name
LIMIT $1 OFFSET $2;  -- Parameters for pagination


-- ======================================
-- 3. SEARCH MEMBERS BY NAME
-- ======================================
SELECT 
    m.bioguide_id,
    m.direct_order_name,
    m.inverted_order_name,
    m.current_member,
    mt_current.state_name,
    mt_current.chamber,
    mt_current.party_abbreviation,
    -- Search ranking for relevance
    ts_rank(
        to_tsvector('english', 
            COALESCE(m.first_name, '') || ' ' || 
            COALESCE(m.middle_name, '') || ' ' || 
            COALESCE(m.last_name, '') || ' ' || 
            COALESCE(m.nickname, '')
        ), 
        plainto_tsquery('english', $1)
    ) as search_rank
FROM member m
LEFT JOIN LATERAL (
    SELECT state_name, chamber, party_abbreviation, congress
    FROM member_term mt
    WHERE mt.member_bioguide_id = m.bioguide_id
    ORDER BY mt.congress DESC, mt.start_year DESC
    LIMIT 1
) mt_current ON true
WHERE to_tsvector('english', 
    COALESCE(m.first_name, '') || ' ' || 
    COALESCE(m.middle_name, '') || ' ' || 
    COALESCE(m.last_name, '') || ' ' || 
    COALESCE(m.nickname, '')
) @@ plainto_tsquery('english', $1)
ORDER BY search_rank DESC, m.current_member DESC, m.last_name
LIMIT $2;  -- Parameters: search_term, limit


-- ======================================
-- 4. GET MEMBER PARTY HISTORY
-- ======================================
SELECT 
    ph.party_abbreviation,
    ph.party_name,
    ph.start_year,
    ph.end_year,
    CASE WHEN ph.end_year IS NULL THEN TRUE ELSE FALSE END as is_current_party,
    (ph.end_year - ph.start_year) as years_in_party
FROM member_party_history ph
WHERE ph.member_bioguide_id = $1
ORDER BY ph.start_year;


-- ======================================
-- 5. GET LEGISLATION STATISTICS BY CONGRESS
-- ======================================
SELECT 
    mls.congress,
    mls.sponsored_legislation_count,
    mls.cosponsored_legislation_count,
    mls.sponsored_legislation_url,
    mls.cosponsored_legislation_url,
    mls.last_calculated
FROM member_legislation_stats mls
WHERE mls.member_bioguide_id = $1
ORDER BY mls.congress DESC;


-- ======================================
-- 6. PERFORMANCE MONITORING QUERIES
-- ======================================

-- Check index usage for member lookups
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE tablename LIKE 'member%'
ORDER BY idx_tup_read DESC;

-- Check table sizes and row counts
SELECT 
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_live_tup as live_rows,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size
FROM pg_stat_user_tables 
WHERE tablename LIKE 'member%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;