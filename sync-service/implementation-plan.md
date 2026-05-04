# Implementation Plan: Full Bill Details Sync

## Phase 1: Database Schema Updates

### 1.1 Update Existing Tables

#### bill table - Add missing core fields:
```sql
ALTER TABLE bill ADD COLUMN IF NOT EXISTS origin_chamber_code VARCHAR(1);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_type VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_number VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS congress_notes JSONB;
```

### 1.2 Create New Tables

#### bill_cosponsor table:
```sql
CREATE TABLE IF NOT EXISTS bill_cosponsor (
  cosponsor_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  bioguide_id VARCHAR(10) NOT NULL,
  full_name VARCHAR(255),
  first_name VARCHAR(100),
  middle_name VARCHAR(100),
  last_name VARCHAR(100),
  party VARCHAR(10),
  state VARCHAR(2),
  district INTEGER,
  sponsorship_date DATE,
  is_original_cosponsor BOOLEAN DEFAULT FALSE,
  sponsorship_withdrawn_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, bioguide_id)
);
```

#### bill_summary table:
```sql
CREATE TABLE IF NOT EXISTS bill_summary (
  summary_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  version_code VARCHAR(10),
  action_date DATE,
  action_desc VARCHAR(255),
  update_date TIMESTAMP,
  text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, version_code)
);
```

#### bill_title table:
```sql
CREATE TABLE IF NOT EXISTS bill_title (
  title_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  title_type VARCHAR(100),
  title_type_code INTEGER,
  title TEXT NOT NULL,
  chamber_code VARCHAR(1),
  chamber_name VARCHAR(10),
  bill_text_version_name VARCHAR(100),
  bill_text_version_code VARCHAR(10),
  update_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, title_type_code, title)
);
```

#### bill_amendment table:
```sql
CREATE TABLE IF NOT EXISTS bill_amendment (
  amendment_id VARCHAR(30) PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  amendment_number INTEGER,
  congress INTEGER,
  type VARCHAR(10),
  description TEXT,
  purpose TEXT,
  latest_action_date DATE,
  latest_action_text TEXT,
  latest_action_time TIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### bill_text_version table:
```sql
CREATE TABLE IF NOT EXISTS bill_text_version (
  text_version_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  version_type VARCHAR(100),
  version_date TIMESTAMP,
  formats JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, version_type, version_date)
);
```

#### bill_related table:
```sql
CREATE TABLE IF NOT EXISTS bill_related (
  related_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  related_bill_id VARCHAR(20),
  related_bill_congress INTEGER,
  related_bill_type VARCHAR(10),
  related_bill_number INTEGER,
  related_bill_title TEXT,
  relationship_type VARCHAR(100),
  identified_by VARCHAR(10),
  latest_action_date DATE,
  latest_action_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, related_bill_id, relationship_type)
);
```

#### bill_committee_report table:
```sql
CREATE TABLE IF NOT EXISTS bill_committee_report (
  report_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  citation VARCHAR(100),
  url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, citation)
);
```

#### bill_cbo_estimate table:
```sql
CREATE TABLE IF NOT EXISTS bill_cbo_estimate (
  estimate_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  pub_date TIMESTAMP,
  title TEXT,
  url TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, pub_date, title)
);
```

#### Update action table - Add missing fields:
```sql
ALTER TABLE action ADD COLUMN IF NOT EXISTS action_type VARCHAR(50);
ALTER TABLE action ADD COLUMN IF NOT EXISTS committees JSONB;
ALTER TABLE action ADD COLUMN IF NOT EXISTS recorded_votes JSONB;
```

#### bill_committee_activity table:
```sql
CREATE TABLE IF NOT EXISTS bill_committee_activity (
  activity_id SERIAL PRIMARY KEY,
  bill_id VARCHAR(20) REFERENCES bill(bill_id) ON DELETE CASCADE,
  committee_system_code VARCHAR(20),
  committee_name VARCHAR(255),
  activity_name VARCHAR(100),
  activity_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bill_id, committee_system_code, activity_name, activity_date)
);
```

## Phase 2: API Client Updates

### 2.1 Add New Methods to congress-client.js

```javascript
// Add these methods to CongressClient class:

async getBillCosponsors(congress, billType, billNumber) {
  const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/cosponsors`;
  return this.makeRequest(endpoint);
}

async getBillRelatedBills(congress, billType, billNumber) {
  const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/relatedbills`;
  return this.makeRequest(endpoint);
}

async getBillSummaries(congress, billType, billNumber) {
  const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/summaries`;
  return this.makeRequest(endpoint);
}

async getBillTitles(congress, billType, billNumber) {
  const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/titles`;
  return this.makeRequest(endpoint);
}

async getBillTextVersions(congress, billType, billNumber) {
  const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/text`;
  return this.makeRequest(endpoint);
}

async getBillAmendments(congress, billType, billNumber) {
  const endpoint = `/bill/${congress}/${billType.toLowerCase()}/${billNumber}/amendments`;
  return this.makeRequest(endpoint);
}
```

## Phase 3: Database Service Updates

### 3.1 Add New Upsert Methods to database.js

```javascript
// Add these methods to DatabaseService class:

async upsertBillCosponsor(cosponsorData) {
  // Implementation for upserting cosponsor
}

async upsertBillSummary(summaryData) {
  // Implementation for upserting summary
}

async upsertBillTitle(titleData) {
  // Implementation for upserting title
}

async upsertBillAmendment(amendmentData) {
  // Implementation for upserting amendment
}

async upsertBillTextVersion(textVersionData) {
  // Implementation for upserting text version
}

async upsertBillRelated(relatedData) {
  // Implementation for upserting related bill
}

async upsertBillCommitteeReport(reportData) {
  // Implementation for upserting committee report
}

async upsertBillCboEstimate(estimateData) {
  // Implementation for upserting CBO estimate
}

async upsertBillCommitteeActivity(activityData) {
  // Implementation for upserting committee activity
}
```

## Phase 4: Bill Syncer Updates

### 4.1 Update syncBillWithDetails Method

```javascript
async syncBillWithDetails(congress, billType, billNumber) {
  try {
    // Get full bill details (existing)
    const billData = await this.client.getBillDetails(congress, billType, billNumber);
    
    // Get ALL additional data in parallel
    const [
      subjects,
      sponsors,
      committees,
      cosponsors,      // NEW
      relatedBills,    // NEW
      summaries,       // NEW
      titles,          // NEW
      textVersions,    // NEW
      amendments       // NEW
    ] = await Promise.all([
      this.client.getBillSubjects(congress, billType, billNumber).catch(() => null),
      this.client.getBillSponsors(congress, billType, billNumber).catch(() => null),
      this.client.getBillCommittees(congress, billType, billNumber).catch(() => null),
      this.client.getBillCosponsors(congress, billType, billNumber).catch(() => null),
      this.client.getBillRelatedBills(congress, billType, billNumber).catch(() => null),
      this.client.getBillSummaries(congress, billType, billNumber).catch(() => null),
      this.client.getBillTitles(congress, billType, billNumber).catch(() => null),
      this.client.getBillTextVersions(congress, billType, billNumber).catch(() => null),
      this.client.getBillAmendments(congress, billType, billNumber).catch(() => null)
    ]);

    // Transform and save main bill (update to include new fields)
    const transformedBill = this.transformBillData(billData.bill, congress);
    const result = await this.db.upsertBill(transformedBill);

    // Sync all related data
    await this.syncBillActions(congress, billType, billNumber);
    await this.syncBillCosponsors(billId, cosponsors);
    await this.syncBillRelatedBills(billId, relatedBills);
    await this.syncBillSummaries(billId, summaries);
    await this.syncBillTitles(billId, titles);
    await this.syncBillTextVersions(billId, textVersions);
    await this.syncBillAmendments(billId, amendments);
    await this.syncBillCommitteeActivities(billId, committees);

    return result;

  } catch (error) {
    // Error handling
  }
}
```

### 4.2 Add New Sync Methods

```javascript
async syncBillCosponsors(billId, cosponsorsData) {
  if (!cosponsorsData || !cosponsorsData.cosponsors) return;
  
  for (const cosponsor of cosponsorsData.cosponsors) {
    const cosponsorData = {
      bill_id: billId,
      bioguide_id: cosponsor.bioguideId,
      full_name: cosponsor.fullName,
      first_name: cosponsor.firstName,
      middle_name: cosponsor.middleName,
      last_name: cosponsor.lastName,
      party: cosponsor.party,
      state: cosponsor.state,
      district: cosponsor.district,
      sponsorship_date: cosponsor.sponsorshipDate,
      is_original_cosponsor: cosponsor.isOriginalCosponsor,
      sponsorship_withdrawn_date: cosponsor.sponsorshipWithdrawnDate
    };
    await this.db.upsertBillCosponsor(cosponsorData);
  }
}

// Similar methods for other data types...
```

## Phase 5: Migration Scripts

### 5.1 Create Database Migration

```sql
-- migration-001-full-bill-details.sql

-- Phase 1: Update existing tables
ALTER TABLE bill ADD COLUMN IF NOT EXISTS origin_chamber_code VARCHAR(1);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_type VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS law_number VARCHAR(20);
ALTER TABLE bill ADD COLUMN IF NOT EXISTS congress_notes JSONB;

ALTER TABLE action ADD COLUMN IF NOT EXISTS action_type VARCHAR(50);
ALTER TABLE action ADD COLUMN IF NOT EXISTS committees JSONB;
ALTER TABLE action ADD COLUMN IF NOT EXISTS recorded_votes JSONB;

-- Phase 2: Create new tables
-- (Include all CREATE TABLE statements from above)

-- Phase 3: Create indexes for performance
CREATE INDEX idx_bill_cosponsor_bill_id ON bill_cosponsor(bill_id);
CREATE INDEX idx_bill_cosponsor_bioguide_id ON bill_cosponsor(bioguide_id);
CREATE INDEX idx_bill_summary_bill_id ON bill_summary(bill_id);
CREATE INDEX idx_bill_title_bill_id ON bill_title(bill_id);
CREATE INDEX idx_bill_amendment_bill_id ON bill_amendment(bill_id);
CREATE INDEX idx_bill_text_version_bill_id ON bill_text_version(bill_id);
CREATE INDEX idx_bill_related_bill_id ON bill_related(bill_id);
CREATE INDEX idx_bill_committee_report_bill_id ON bill_committee_report(bill_id);
CREATE INDEX idx_bill_cbo_estimate_bill_id ON bill_cbo_estimate(bill_id);
CREATE INDEX idx_bill_committee_activity_bill_id ON bill_committee_activity(bill_id);
```

## Phase 6: Performance Optimization

### 6.1 Batch Processing Strategy

```javascript
// Implement rate-limited parallel fetching
async syncBillBatch(billBatch) {
  // Process bills in smaller sub-batches to avoid rate limits
  const subBatchSize = 5; // Process 5 bills at a time
  
  for (let i = 0; i < billBatch.length; i += subBatchSize) {
    const subBatch = billBatch.slice(i, i + subBatchSize);
    await Promise.all(subBatch.map(bill => 
      this.syncBillWithDetails(bill.congress, bill.type, bill.number)
    ));
    
    // Add delay between sub-batches to respect rate limits
    await this.sleep(1000);
  }
}
```

### 6.2 Incremental Sync Strategy

```javascript
// Add configuration for selective syncing
const syncConfig = {
  fetchCosponsors: true,
  fetchSummaries: true,
  fetchRelatedBills: true,
  fetchAmendments: true,
  fetchTextVersions: false, // May be large, fetch on-demand
  fetchTitles: true,
  maxCosponsorsPerBill: 1000, // Limit for very popular bills
};
```

## Phase 7: Testing Plan

### 7.1 Unit Tests
- Test each new API client method
- Test each new database upsert method
- Test data transformation functions

### 7.2 Integration Tests
- Test full bill sync with all details
- Test incremental sync with new fields
- Test error handling and retry logic
- Test rate limiting compliance

### 7.3 Performance Tests
- Measure sync time for different batch sizes
- Monitor API rate limit compliance
- Test database query performance with new tables

## Implementation Timeline

1. **Week 1**: Database schema updates and migration scripts
2. **Week 2**: API client methods and database service methods
3. **Week 3**: Update bill syncer with new sync methods
4. **Week 4**: Testing and performance optimization
5. **Week 5**: Deployment and monitoring

## Rollback Plan

1. Keep backup of current database before migration
2. Implement feature flags to enable/disable new sync features
3. Maintain backwards compatibility in API responses
4. Create rollback migration script to revert schema changes

## Monitoring

- Track sync completion rates for each data type
- Monitor API rate limit violations
- Set up alerts for sync failures
- Track database storage growth
- Monitor query performance on new tables