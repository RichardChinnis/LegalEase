# Member Synchronization Implementation Plan

## Overview
This plan outlines the implementation of comprehensive member data synchronization from the Congress.gov API, including member biographical information, terms of service, committee memberships, and relationships to bills.

## Current State Analysis

### Existing Infrastructure
- ✅ Database tables: `member`, `member_term`, `member_committee`
- ✅ API client method: `getMembers()` in congress-client.js
- ❌ No database upsert methods for members
- ❌ No member-syncer.js implementation
- ❌ No member sync integration in main service

### Database Schema Review
```sql
-- member table: Core biographical data
- bioguide_id (PK)
- first_name, last_name, middle_name
- birth_year, death_year
- current_member
- depiction_url, official_url
- office_address, phone_number

-- member_term table: Congressional service records
- term_id (PK)
- member_bioguide_id (FK)
- congress
- chamber (House/Senate)
- state_code, state_name
- party_code, party_name
- district (for House members)
- start_year, end_year

-- member_committee table: Committee assignments
- member_bioguide_id (FK)
- committee_code (FK)
- rank_in_party
- is_chair
```

## Implementation Phases

### Phase 1: API Client Enhancement (2 hours)
**File**: `/sync-service/lib/congress-client.js`

Add these methods:
```javascript
// Get specific member details
async getMemberDetails(bioguideId) {
  const endpoint = `/member/${bioguideId}`;
  return this.makeRequest(endpoint);
}

// Get member's sponsored bills
async getMemberSponsoredBills(bioguideId, params = {}) {
  const endpoint = `/member/${bioguideId}/sponsored-legislation`;
  return this.makeRequest(endpoint, params);
}

// Get member's cosponsored bills
async getMemberCosponsoredBills(bioguideId, params = {}) {
  const endpoint = `/member/${bioguideId}/cosponsored-legislation`;
  return this.makeRequest(endpoint, params);
}
```

### Phase 2: Database Service Methods (3 hours)
**File**: `/sync-service/lib/database.js`

Add comprehensive upsert methods:

```javascript
// Upsert member biographical data
async upsertMember(memberData) {
  const query = `
    INSERT INTO member (
      bioguide_id, first_name, last_name, middle_name, suffix_name,
      nickname, direct_order_name, inverted_order_name, honorific_name,
      birth_year, death_year, current_member,
      depiction_url, depiction_attribution, official_url,
      office_address, phone_number, api_update_date
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (bioguide_id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      current_member = EXCLUDED.current_member,
      office_address = EXCLUDED.office_address,
      phone_number = EXCLUDED.phone_number,
      api_update_date = EXCLUDED.api_update_date,
      updated_at = CURRENT_TIMESTAMP
    RETURNING bioguide_id, (xmax = 0) AS inserted`;
}

// Upsert member term of service
async upsertMemberTerm(termData) {
  const query = `
    INSERT INTO member_term (
      member_bioguide_id, congress, chamber, member_type,
      start_year, end_year, state_code, state_name,
      party_code, party_name, district
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (member_bioguide_id, congress, chamber) DO UPDATE SET
      end_year = EXCLUDED.end_year,
      party_code = EXCLUDED.party_code,
      party_name = EXCLUDED.party_name
    RETURNING term_id, (xmax = 0) AS inserted`;
}

// Upsert member committee assignment
async upsertMemberCommittee(committeeData) {
  const query = `
    INSERT INTO member_committee (
      member_bioguide_id, committee_code, 
      rank_in_party, is_chair, start_date, end_date
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (member_bioguide_id, committee_code) DO UPDATE SET
      rank_in_party = EXCLUDED.rank_in_party,
      is_chair = EXCLUDED.is_chair,
      end_date = EXCLUDED.end_date
    RETURNING member_bioguide_id, committee_code, (xmax = 0) AS inserted`;
}
```

### Phase 3: Member Syncer Implementation (4 hours)
**File**: `/sync-service/syncers/member-syncer.js`

Core syncer class with:
- Batch processing capabilities
- Rate limiting compliance
- Error handling and retry logic
- Progress tracking and logging

```javascript
class MemberSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new Database();
    this.stats = { inserted: 0, updated: 0, failed: 0, errors: [] };
  }

  async syncAllMembers(options = {}) {
    // Implementation details:
    // 1. Fetch member list with pagination
    // 2. Process in batches (20 members at a time)
    // 3. For each member:
    //    - Fetch detailed member data
    //    - Extract and upsert biographical info
    //    - Extract and upsert term data
    //    - Extract and upsert committee assignments
    // 4. Handle rate limiting (respect API limits)
    // 5. Track progress and errors
  }

  async syncCurrentMembers() {
    // Sync only members with current_member = true
    // Optimized for regular updates
  }

  async syncMembersByState(stateCode) {
    // Sync members from a specific state
    // Useful for targeted updates
  }

  async syncMemberDetails(bioguideId) {
    // Sync a specific member's complete data
    // Including sponsored/cosponsored bills
  }
}
```

### Phase 4: Migration for Additional Indexes (1 hour)
**File**: `/sync-service/migrations/003-member-indexes.sql`

```sql
-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_member_term_state ON member_term(state_code);
CREATE INDEX IF NOT EXISTS idx_member_term_party ON member_term(party_code);
CREATE INDEX IF NOT EXISTS idx_member_term_chamber ON member_term(chamber);
CREATE INDEX IF NOT EXISTS idx_member_term_congress_state ON member_term(congress, state_code);
CREATE INDEX IF NOT EXISTS idx_member_committee_member ON member_committee(member_bioguide_id);

-- Add unique constraint for member terms
ALTER TABLE member_term 
ADD CONSTRAINT unique_member_term 
UNIQUE (member_bioguide_id, congress, chamber);
```

### Phase 5: Integration Scripts (2 hours)
**File**: `/sync-service/sync-members.js`

Standalone script for member synchronization:
```javascript
// Command-line script for member sync operations
// Usage:
// node sync-members.js --all              # Sync all members
// node sync-members.js --current          # Sync current members only
// node sync-members.js --state GA         # Sync Georgia members
// node sync-members.js --congress 119     # Sync specific congress
// node sync-members.js --bioguide A000370 # Sync specific member
```

**File**: `/sync-service/index.js` (modification)

Add member sync to scheduled operations:
```javascript
// Add to cron schedule
schedule('0 3 * * *', async () => {
  // Daily sync of current members at 3 AM
  await memberSyncer.syncCurrentMembers();
});
```

### Phase 6: Testing and Verification (2 hours)
**File**: `/sync-service/test-member-sync.js`

Test script to verify:
- Member data completeness
- State representation accuracy
- Term data consistency
- Committee assignment validity
- Relationship to bills

## Data Processing Considerations

### Member Data Transformation
1. **Name Processing**:
   - Handle various name formats (Jr., III, etc.)
   - Normalize for consistent display

2. **State/District Mapping**:
   - Validate state codes
   - Handle at-large districts (district = 0)
   - Track redistricting changes

3. **Party Affiliation**:
   - Map party codes to full names
   - Handle party switches mid-term
   - Track independent/third-party members

4. **Term Boundaries**:
   - Handle special elections
   - Track resignations/appointments
   - Manage overlapping terms (Senate class rotation)

### Performance Optimizations
1. **Batch Processing**:
   - Process 20 members per batch
   - Use Promise.all() for parallel API calls
   - Implement connection pooling

2. **Incremental Updates**:
   - Track last_sync timestamps
   - Only update changed data
   - Prioritize current members

3. **Caching Strategy**:
   - Cache member lists for 24 hours
   - Cache biographical data for 7 days
   - Invalidate on manual sync

## Error Handling Strategy

### Retry Logic
```javascript
const retryWithBackoff = async (fn, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      const delay = Math.pow(2, i) * 1000;
      await sleep(delay);
    }
  }
};
```

### Error Categories
1. **API Errors**: Rate limiting, timeouts, 404s
2. **Database Errors**: Constraint violations, connection issues
3. **Data Errors**: Invalid formats, missing required fields

## Success Metrics
- ✅ All current members synced (435 House + 100 Senate)
- ✅ Historical members available for bill attribution
- ✅ State representation accurate for all 50 states + territories
- ✅ Committee assignments current and complete
- ✅ Bill sponsorship relationships established

## Implementation Timeline
- **Day 1**: Phases 1-2 (API client, database methods)
- **Day 2**: Phase 3 (Member syncer core)
- **Day 3**: Phases 4-5 (Migration, integration)
- **Day 4**: Phase 6 (Testing, verification)

## Post-Implementation Queries

Once implemented, these queries will work:

```sql
-- Bills by Georgia representatives
SELECT b.bill_id, b.title, m.first_name, m.last_name
FROM bill b
JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
JOIN member m ON bs.member_bioguide_id = m.bioguide_id
JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
WHERE mt.state_code = 'GA'
AND mt.congress = b.congress_id;

-- Current delegation from any state
SELECT m.first_name, m.last_name, mt.chamber, mt.party_name
FROM member m
JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
WHERE mt.state_code = 'TX'
AND mt.congress = 119
ORDER BY mt.chamber, m.last_name;

-- Committee membership
SELECT c.name, COUNT(mc.member_bioguide_id) as member_count
FROM committee c
JOIN member_committee mc ON c.committee_code = mc.committee_code
GROUPongress_api_backend -d congress_apiBY c.name
ORDER BY member_count DESC;
```

## Next Steps
1. Review and approve this plan
2. Begin implementation starting with Phase 1
3. Test with Georgia delegation as proof of concept
4. Deploy to production with monitoring