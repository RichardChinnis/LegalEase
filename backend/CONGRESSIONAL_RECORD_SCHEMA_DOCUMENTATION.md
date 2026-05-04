# Congressional Record PostgreSQL Schema Documentation

## Overview

This document describes the PostgreSQL schema designed for storing and querying Congressional Record data. The schema supports efficient storage, indexing, and retrieval of Congressional Record volumes, issues, sections, articles, and their references from bill actions.

## Schema Design Principles

### 1. **Hierarchical Structure**
The schema follows the natural hierarchy of Congressional Record data:
- **Volume** → **Issue** → **Section** → **Article**

### 2. **Performance Optimization**
- Comprehensive indexing strategy for common query patterns
- Full-text search capabilities using PostgreSQL's built-in features
- Optimized data types and constraints

### 3. **Data Integrity**
- Foreign key relationships ensure referential integrity
- Check constraints validate data format and ranges
- Triggers enforce complex business rules

### 4. **Scalability**
- Designed to handle millions of articles and references
- Efficient indexing supports fast lookups and searches
- Partitioning-ready design for future growth

## Table Structure

### 1. congressional_record_volume

Stores Congressional Record volumes organized by Congress and session.

```sql
CREATE TABLE congressional_record_volume (
    volume_id BIGSERIAL PRIMARY KEY,
    volume_number INTEGER NOT NULL,
    congress SMALLINT NOT NULL,
    session_number SMALLINT NOT NULL CHECK (session_number IN (1, 2)),
    year INTEGER NOT NULL CHECK (year >= 1873 AND year <= EXTRACT(YEAR FROM CURRENT_DATE) + 1),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Unique constraints
    CONSTRAINT unique_volume_congress_session UNIQUE (volume_number, congress, session_number)
);
```

**Key Features:**
- Auto-incrementing primary key for performance
- Unique constraint prevents duplicate volumes
- Year validation ensures reasonable date ranges
- JSONB metadata field for extensibility

### 2. congressional_record_issue

Daily issues within each Congressional Record volume.

```sql
CREATE TABLE congressional_record_issue (
    issue_id BIGSERIAL PRIMARY KEY,
    volume_id BIGINT NOT NULL REFERENCES congressional_record_volume(volume_id) ON DELETE CASCADE,
    issue_number INTEGER NOT NULL,
    issue_date DATE NOT NULL,
    congress SMALLINT NOT NULL,
    session_number SMALLINT NOT NULL CHECK (session_number IN (1, 2)),
    full_issue_url TEXT,
    update_date DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Unique constraints
    CONSTRAINT unique_issue_volume_number UNIQUE (volume_id, issue_number),
    CONSTRAINT unique_issue_date_congress UNIQUE (issue_date, congress)
);
```

**Key Features:**
- Foreign key to volume with cascade delete
- Unique constraints prevent duplicate issues
- Congress/session consistency enforced by triggers

### 3. congressional_record_section

Sections within each issue (Senate, House, Extensions, Daily Digest).

```sql
CREATE TABLE congressional_record_section (
    section_id BIGSERIAL PRIMARY KEY,
    issue_id BIGINT NOT NULL REFERENCES congressional_record_issue(issue_id) ON DELETE CASCADE,
    name cr_section_type NOT NULL,
    start_page VARCHAR(20) NOT NULL,
    end_page VARCHAR(20),
    pdf_url TEXT,
    text_url TEXT,
    page_count INTEGER GENERATED ALWAYS AS (...) STORED,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
```

**Key Features:**
- ENUM type for section names ensures data consistency
- Generated column for automatic page count calculation
- Flexible page numbering supports various formats (H3218, S1234, etc.)

### 4. congressional_record_article

Individual articles within sections with full-text search capability.

```sql
CREATE TABLE congressional_record_article (
    article_id BIGSERIAL PRIMARY KEY,
    section_id BIGINT NOT NULL REFERENCES congressional_record_section(section_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_page VARCHAR(20) NOT NULL,
    end_page VARCHAR(20),
    pdf_url TEXT,
    text_url TEXT,
    content_text TEXT,
    content_search_vector TSVECTOR GENERATED ALWAYS AS (...) STORED,
    word_count INTEGER,
    character_count INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
```

**Key Features:**
- Generated full-text search vector for performance
- Content statistics tracking (word/character count)
- Large text storage with size limits for safety

### 5. action_congressional_record_reference

References from bill actions to specific Congressional Record pages.

```sql
CREATE TABLE action_congressional_record_reference (
    reference_id BIGSERIAL PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES action(action_id) ON DELETE CASCADE,
    bill_id VARCHAR(255) NOT NULL,
    reference_text VARCHAR(500) NOT NULL,
    chamber cr_chamber_type NOT NULL,
    start_page VARCHAR(20) NOT NULL,
    end_page VARCHAR(20),
    issue_id BIGINT REFERENCES congressional_record_issue(issue_id) ON DELETE SET NULL,
    section_id BIGINT REFERENCES congressional_record_section(section_id) ON DELETE SET NULL,
    article_id BIGINT REFERENCES congressional_record_article(article_id) ON DELETE SET NULL,
    is_resolved BOOLEAN DEFAULT FALSE NOT NULL,
    resolution_confidence DECIMAL(3,2) CHECK (resolution_confidence >= 0 AND resolution_confidence <= 1),
    resolution_notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
```

**Key Features:**
- Links to existing action table
- Resolution system for matching references to actual content
- Confidence scoring for automated resolution
- Nullable foreign keys allow partial resolution

## Indexing Strategy

### Primary Indexes
- All tables have optimized primary keys using BIGSERIAL
- Unique constraints create automatic indexes

### Performance Indexes

#### Volume & Issue Queries
```sql
CREATE INDEX idx_volume_congress_session ON congressional_record_volume (congress, session_number);
CREATE INDEX idx_issue_date ON congressional_record_issue (issue_date DESC);
CREATE INDEX idx_issue_congress_date ON congressional_record_issue (congress, issue_date DESC);
```

#### Full-Text Search
```sql
CREATE INDEX idx_article_content_search ON congressional_record_article USING GIN (content_search_vector);
CREATE INDEX idx_article_title_search ON congressional_record_article USING GIN (to_tsvector('english', title));
```

#### Page Lookup Performance
```sql
CREATE INDEX idx_section_page_lookup ON congressional_record_section (start_page, end_page) WHERE end_page IS NOT NULL;
CREATE INDEX idx_article_page_lookup ON congressional_record_article (start_page, end_page) WHERE end_page IS NOT NULL;
```

#### Reference Resolution
```sql
CREATE INDEX idx_reference_bill ON action_congressional_record_reference (bill_id);
CREATE INDEX idx_reference_chamber_page ON action_congressional_record_reference (chamber, start_page);
CREATE INDEX idx_reference_unresolved ON action_congressional_record_reference (chamber, start_page) WHERE is_resolved = FALSE;
```

## Helper Functions

### 1. extract_page_number(page_text VARCHAR)
Extracts numeric page numbers from formatted strings like "H3218" or "S1234".

### 2. find_articles_by_page_range()
High-performance function for finding articles within specific page ranges.

```sql
SELECT * FROM find_articles_by_page_range('H', 'H3218', 'H3220', '2023-01-03');
```

## Views

### 1. bill_congressional_record_references
Combines bill action data with resolved Congressional Record references.

### 2. congressional_record_search
Optimized view for full-text search across all Congressional Record content.

## Query Patterns

### 1. Full-Text Search
```sql
SELECT article_id, title, ts_rank(content_search_vector, plainto_tsquery('english', 'healthcare')) as rank
FROM congressional_record_article 
WHERE content_search_vector @@ plainto_tsquery('english', 'healthcare')
ORDER BY rank DESC;
```

### 2. Bill CR References
```sql
SELECT * FROM bill_congressional_record_references
WHERE bill_id = 'HR1234-118'
ORDER BY action_date DESC;
```

### 3. Page Range Lookup
```sql
SELECT * FROM find_articles_by_page_range('H', 'H3218', 'H3220');
```

### 4. Unresolved References
```sql
SELECT * FROM action_congressional_record_reference
WHERE is_resolved = FALSE AND chamber = 'H'
ORDER BY created_at DESC;
```

## Performance Optimization

### 1. Query Optimization
- Use prepared statements for repeated queries
- Leverage indexes for WHERE clauses and ORDER BY
- Use appropriate LIMIT and OFFSET for pagination

### 2. Full-Text Search
- Generated tsvector columns provide fast search
- GIN indexes support complex search queries
- Use ts_rank() for relevance scoring

### 3. Batch Operations
- Use transactions for consistency
- Implement upsert patterns with ON CONFLICT
- Consider batch sizes for large imports

### 4. Connection Management
- Use connection pooling
- Monitor connection limits
- Implement proper connection cleanup

## Security Considerations

### 1. Access Control
- Role-based permissions on all tables
- Separate read/write access as needed
- Audit trail through timestamp columns

### 2. Data Validation
- Check constraints prevent invalid data
- Triggers enforce business rules
- Input sanitization in application layer

### 3. Backup Strategy
- Regular automated backups
- Point-in-time recovery capability
- Test restore procedures

## Maintenance

### 1. Statistics
- Regular ANALYZE on tables with frequent updates
- Monitor query performance
- Update table statistics after bulk imports

### 2. Indexing
- Monitor index usage with pg_stat_user_indexes
- Consider partial indexes for filtered queries
- Rebuild indexes if fragmented

### 3. Cleanup
- Archive old data if needed
- Clean up unresolved references periodically
- Monitor storage usage

## Usage Examples

### Service Integration
```javascript
const CongressionalRecordService = require('./congressional-record-service');
const service = new CongressionalRecordService(pool);

// Search for content
const results = await service.searchContent('healthcare reform', {
  congress: 118,
  chamber: 'H',
  limit: 20
});

// Find articles by page
const articles = await service.findArticlesByPageRange('H', 'H3218', 'H3220');

// Get bill references
const references = await service.getBillCongressionalRecordReferences('HR1234-118');
```

## Migration and Deployment

### 1. Initial Setup
```bash
# Execute the migration script
psql -h localhost -U congress_admin -d congress_api -f 001_congressional_record_schema.sql

# Run tests
node test-congressional-record-schema.js
```

### 2. Data Import
Use the CongressionalRecordService.bulkImport() method for initial data loading.

### 3. Monitoring
- Check query performance regularly
- Monitor index usage and effectiveness
- Set up alerts for unusual activity

This schema provides a robust foundation for Congressional Record data management with excellent performance characteristics and room for future growth.