# Congressional Record PostgreSQL Functions Documentation

## Overview

This document provides comprehensive documentation for all PostgreSQL functions that operate on Congressional Record tables in the `congress_api` database. The Congressional Record system consists of four main tables organized in a hierarchical structure:

- `congressional_record_volume` - Congressional Record volumes by congress/session
- `congressional_record_issue` - Daily issues within volumes
- `congressional_record_section` - Sections within issues (House, Senate, Extensions, Daily Digest)
- `congressional_record_article` - Individual articles within sections

## Table Structure and Relationships

### Entity Hierarchy
```
Volume (Congress 119, Session 1)
  ├── Issue (Date: 2025-01-03)
  │   ├── Section (House)
  │   │   ├── Article 1
  │   │   └── Article 2
  │   ├── Section (Senate)
  │   │   ├── Article 3
  │   │   └── Article 4
  │   └── Section (Extensions of Remarks)
  │       └── Article 5
  └── Issue (Date: 2025-01-04)
      └── ...
```

### Key Constraints and Features
- **Referential Integrity**: Cascading deletes from volumes to issues to sections to articles
- **Business Logic**: Trigger-enforced consistency between volumes and issues
- **Search Optimization**: Full-text search vectors with GIN indexes
- **Page Range Validation**: Check constraints ensuring valid page formats
- **Performance**: Denormalized convenience fields for fast lookups

## Custom Types

### cr_chamber_type
Enum defining chamber types:
- `'H'` - House of Representatives
- `'S'` - Senate  
- `'E'` - Extensions of Remarks
- `'D'` - Daily Digest

### cr_section_type  
Enum defining section names:
- `'House'` - House proceedings
- `'Senate'` - Senate proceedings
- `'Extensions of Remarks'` - Member submissions
- `'Daily Digest'` - Summary and schedule information

## Core Functions

## 1. Data Integrity Functions

### enforce_issue_volume_consistency()

**Purpose**: Trigger function that ensures Congressional Record issues maintain referential and business logic consistency with their parent volumes.

**Type**: `RETURNS trigger`  
**Language**: PL/pgSQL  
**Usage**: Automatically executed on INSERT/UPDATE to `congressional_record_issue`

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.enforce_issue_volume_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    volume_congress SMALLINT;
    volume_session SMALLINT;
BEGIN
    SELECT congress, session_number INTO volume_congress, volume_session
    FROM congressional_record_volume
    WHERE volume_id = NEW.volume_id;

    IF volume_congress IS NULL THEN
        RAISE EXCEPTION 'Volume % does not exist', NEW.volume_id;
    END IF;

    IF NEW.congress != volume_congress THEN
        RAISE EXCEPTION 'Issue congress (%) must match volume congress (%)', NEW.congress, volume_congress;
    END IF;

    IF NEW.session_number != volume_session THEN
        RAISE EXCEPTION 'Issue session (%) must match volume session (%)', NEW.session_number, volume_session;
    END IF;

    RETURN NEW;
END;
$function$
```

**Key Features**:
- Validates that issue congress matches volume congress
- Validates that issue session matches volume session  
- Prevents orphaned issues by checking volume existence
- Provides clear error messages for debugging

**Performance Notes**:
- Single SELECT query per trigger execution
- Uses indexed lookup on `congressional_record_volume.volume_id`
- Minimal overhead due to simple validation logic

---

### populate_article_convenience_fields()

**Purpose**: Trigger function that automatically populates denormalized fields in the `congressional_record_article` table to optimize query performance.

**Type**: `RETURNS trigger`  
**Language**: PL/pgSQL  
**Usage**: Automatically executed on INSERT/UPDATE to `congressional_record_article`

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.populate_article_convenience_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  vol_num INTEGER;
  iss_num INTEGER;
  iss_date DATE;
  congress_num INTEGER;
BEGIN
  -- Get volume, issue, date, and congress from related tables
  SELECT
    v.volume_number,
    i.issue_number,
    i.issue_date,
    i.congress
  INTO vol_num, iss_num, iss_date, congress_num
  FROM congressional_record_section s
  JOIN congressional_record_issue i ON s.issue_id = i.issue_id
  JOIN congressional_record_volume v ON i.volume_id = v.volume_id
  WHERE s.section_id = NEW.section_id;

  -- Populate convenience fields
  NEW.volume_number := vol_num;
  NEW.issue_number := iss_num;
  NEW.issue_date := iss_date;
  NEW.congress := congress_num;
  NEW.chamber := extract_chamber_from_page(NEW.start_page);
  NEW.start_page_number := extract_page_number(NEW.start_page);
  NEW.end_page_number := CASE
    WHEN NEW.end_page IS NOT NULL THEN extract_page_number(NEW.end_page)
    ELSE extract_page_number(NEW.start_page)
  END;

  RETURN NEW;
END;
$function$
```

**Populated Fields**:
- `volume_number` - From parent volume
- `issue_number` - From parent issue
- `issue_date` - From parent issue
- `congress` - From parent issue
- `chamber` - Extracted from start_page using helper function
- `start_page_number` - Numeric page extracted from start_page
- `end_page_number` - Numeric page extracted from end_page

**Performance Impact**:
- Requires 3-table join on each article insert/update
- Uses indexed foreign key relationships for optimal join performance
- Significant query performance improvement for article searches
- Trade-off: Insert/update cost vs. massive read performance gains

---

## 2. Search and Lookup Functions

### find_articles_by_page_range()

**Purpose**: Finds Congressional Record articles that overlap with a specified page range within a chamber, with optional date filtering.

**Signature**: 
```sql
find_articles_by_page_range(
    p_chamber cr_chamber_type,
    p_start_page character varying,
    p_end_page character varying DEFAULT NULL,
    p_issue_date date DEFAULT NULL
)
RETURNS TABLE(
    article_id bigint,
    title text,
    section_name cr_section_type,
    issue_date date,
    article_start_page character varying,
    article_end_page character varying
)
```

**Parameters**:
- `p_chamber` - Chamber type ('H', 'S', 'E', 'D')
- `p_start_page` - Starting page reference (e.g., 'H3218')
- `p_end_page` - Ending page reference (optional, defaults to start_page)
- `p_issue_date` - Optional date filter

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.find_articles_by_page_range(
    p_chamber cr_chamber_type,
    p_start_page character varying,
    p_end_page character varying DEFAULT NULL,
    p_issue_date date DEFAULT NULL
)
RETURNS TABLE(
    article_id bigint,
    title text,
    section_name cr_section_type,
    issue_date date,
    article_start_page character varying,
    article_end_page character varying
)
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        a.article_id,
        a.title,
        s.name,
        i.issue_date,
        a.start_page,
        a.end_page
    FROM congressional_record_article a
    JOIN congressional_record_section s ON a.section_id = s.section_id
    JOIN congressional_record_issue i ON s.issue_id = i.issue_id
    WHERE
        -- Chamber matching through section name
        (p_chamber = 'H' AND s.name = 'House') OR
        (p_chamber = 'S' AND s.name = 'Senate') OR
        (p_chamber = 'E' AND s.name = 'Extensions of Remarks') OR
        (p_chamber = 'D' AND s.name = 'Daily Digest')
        -- Page range overlap check
        AND (
            (extract_page_number(a.start_page) <= extract_page_number(p_start_page) AND
             extract_page_number(COALESCE(a.end_page, a.start_page)) >= extract_page_number(p_start_page))
            OR
            (extract_page_number(a.start_page) <= extract_page_number(COALESCE(p_end_page, p_start_page)) AND
             extract_page_number(COALESCE(a.end_page, a.start_page)) >= extract_page_number(COALESCE(p_end_page, p_start_page)))
        )
        -- Optional date filter
        AND (p_issue_date IS NULL OR i.issue_date = p_issue_date)
    ORDER BY i.issue_date DESC, extract_page_number(a.start_page);
END;
$function$
```

**Use Cases**:
- Finding articles that reference specific page ranges
- Cross-referencing legislative mentions to Congressional Record content
- Building page-based navigation systems

**Performance Characteristics**:
- Uses 3-table join with indexed relationships
- Page number extraction functions may impact performance on large datasets
- Ordering by date and page number for logical result presentation

---

### find_cr_article_by_page()

**Purpose**: Finds a specific Congressional Record article by exact page reference, useful for direct page lookups.

**Signature**:
```sql
find_cr_article_by_page(page_ref text)
RETURNS TABLE(
    article_id bigint,
    title text,
    start_page character varying,
    end_page character varying,
    pdf_url text,
    text_url text
)
```

**Parameters**:
- `page_ref` - Complete page reference (e.g., 'H3218', 'S1234')

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.find_cr_article_by_page(page_ref text)
RETURNS TABLE(
    article_id bigint,
    title text,
    start_page character varying,
    end_page character varying,
    pdf_url text,
    text_url text
)
LANGUAGE plpgsql
AS $function$
DECLARE
    target_chamber TEXT;
    target_page_num INTEGER;
BEGIN
    -- Extract chamber prefix (S, H, E, D) and page number
    target_chamber := REGEXP_REPLACE(page_ref, '\d+', '', 'g');
    target_page_num := extract_page_number(page_ref);

    -- Return null if we can't parse the page
    IF target_page_num IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        a.article_id,
        a.title,
        a.start_page,
        a.end_page,
        a.pdf_url,
        a.text_url
    FROM congressional_record_article a
    WHERE
        -- Match chamber prefix
        REGEXP_REPLACE(a.start_page, '\d+', '', 'g') = target_chamber
        -- Check if target page falls within article range
        AND target_page_num >= extract_page_number(a.start_page)
        AND target_page_num <= COALESCE(
            extract_page_number(a.end_page),
            extract_page_number(a.start_page)
        );
END;
$function$
```

**Key Features**:
- Handles single-page and multi-page articles
- Chamber-specific page reference parsing
- Returns article metadata including URLs
- Graceful handling of unparseable page references

---

### find_cr_article_by_page_enhanced()

**Purpose**: Enhanced version of `find_cr_article_by_page()` that uses denormalized convenience fields for superior performance and returns additional metadata.

**Signature**:
```sql
find_cr_article_by_page_enhanced(page_ref text)
RETURNS TABLE(
    article_id bigint,
    title text,
    start_page character varying,
    end_page character varying,
    pdf_url text,
    text_url text,
    volume_number integer,
    issue_number integer,
    issue_date date,
    congress integer,
    chamber character varying
)
```

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.find_cr_article_by_page_enhanced(page_ref text)
RETURNS TABLE(
    article_id bigint,
    title text,
    start_page character varying,
    end_page character varying,
    pdf_url text,
    text_url text,
    volume_number integer,
    issue_number integer,
    issue_date date,
    congress integer,
    chamber character varying
)
LANGUAGE plpgsql
AS $function$
DECLARE
    target_chamber VARCHAR(20);
    target_page_num INTEGER;
BEGIN
    -- Extract chamber and page number
    target_chamber := extract_chamber_from_page(page_ref);
    target_page_num := extract_page_number(page_ref);

    -- Return null if we can't parse the page
    IF target_page_num IS NULL OR target_chamber = 'Unknown' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        a.article_id,
        a.title,
        a.start_page,
        a.end_page,
        a.pdf_url,
        a.text_url,
        a.volume_number,
        a.issue_number,
        a.issue_date,
        a.congress,
        a.chamber
    FROM congressional_record_article a
    WHERE
        -- Use convenience fields for faster lookup
        a.chamber = target_chamber
        AND target_page_num >= a.start_page_number
        AND target_page_num <= COALESCE(a.end_page_number, a.start_page_number)
    ORDER BY
        -- If multiple articles contain the same page, prefer the one where it's the primary focus
        CASE WHEN a.start_page_number = target_page_num THEN 1 ELSE 2 END,
        a.start_page_number DESC;
END;
$function$
```

**Performance Advantages**:
- Uses indexed convenience fields instead of joins
- Eliminates need for helper function calls during search
- Leverages `idx_article_page_numbers` composite index
- Intelligent result ordering for overlapping articles

**Additional Features**:
- Returns complete article context (volume, issue, congress)
- Prioritizes articles where the target page is the starting page
- Better error handling with chamber validation

---

## 3. Utility Functions

### extract_page_number()

**Purpose**: Extracts numeric page numbers from Congressional Record page references.

**Signature**: `extract_page_number(page_text character varying) RETURNS integer`  
**Language**: PL/pgSQL  
**Attributes**: `IMMUTABLE` (safe for indexing and optimization)

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.extract_page_number(page_text character varying)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
    -- Extract numeric part from formats like "H3218", "S1234", "3218"
    RETURN CASE
        WHEN page_text ~ '^\d+$' THEN page_text::INTEGER
        WHEN page_text ~ '^\w\d+$' THEN SUBSTRING(page_text FROM '\d+')::INTEGER
        ELSE NULL
    END;
END;
$function$
```

**Supported Formats**:
- `'3218'` → `3218` (plain numeric)
- `'H3218'` → `3218` (chamber prefix)
- `'S1234'` → `1234` (chamber prefix)
- Invalid formats → `NULL`

**Performance Notes**:
- `IMMUTABLE` function can be used in indexes
- Regex patterns optimized for Congressional Record page formats
- Used extensively by other functions for page-based operations

---

### extract_chamber_from_page()

**Purpose**: Extracts chamber information from page references.

**Signature**: `extract_chamber_from_page(page_ref text) RETURNS character varying`  
**Language**: SQL  
**Attributes**: `IMMUTABLE`

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.extract_chamber_from_page(page_ref text)
RETURNS character varying
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN page_ref ~ '^[Ss]\d+' THEN 'Senate'
    WHEN page_ref ~ '^[Hh]\d+' THEN 'House'
    WHEN page_ref ~ '^[Ee]\d+' THEN 'Extensions'
    WHEN page_ref ~ '^[Dd]\d+' THEN 'Daily Digest'
    ELSE 'Unknown'
  END;
$function$
```

**Mapping**:
- `S1234` → `'Senate'`
- `H3218` → `'House'`
- `E4567` → `'Extensions'`
- `D8901` → `'Daily Digest'`
- Invalid → `'Unknown'`

**Features**:
- Case-insensitive chamber detection
- Returns full chamber names matching convenience field values
- Used by `populate_article_convenience_fields()` trigger

---

### update_updated_at_column()

**Purpose**: Generic trigger function for automatically updating `updated_at` timestamps.

**Type**: `RETURNS trigger`  
**Language**: PL/pgSQL  
**Usage**: Applied to all Congressional Record tables

**Function Logic**:
```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$function$
```

**Applied To**:
- `congressional_record_volume` (trigger: `update_volume_updated_at`)
- `congressional_record_issue` (trigger: `update_issue_updated_at`)  
- `congressional_record_section` (trigger: `update_section_updated_at`)
- `congressional_record_article` (trigger: `update_article_updated_at`)

---

## Performance Analysis

### Indexing Strategy

The Congressional Record system employs a comprehensive indexing strategy optimized for different access patterns:

#### Volume Table Indexes
- `congressional_record_volume_pkey` - Primary key (volume_id)
- `idx_volume_congress_session` - Congress/session lookups
- `idx_volume_year` - Year-based filtering
- `unique_volume_congress_session` - Business logic enforcement

#### Issue Table Indexes  
- `congressional_record_issue_pkey` - Primary key (issue_id)
- `idx_issue_congress_date` - Congress and date queries (DESC for recent-first)
- `idx_issue_date` - Date range queries (DESC for recent-first) 
- `idx_issue_volume_number` - Volume-based lookups
- `unique_issue_date_congress` - One issue per date per congress
- `unique_issue_volume_number` - Sequential numbering within volumes

#### Section Table Indexes
- `congressional_record_section_pkey` - Primary key (section_id)
- `idx_issue_section_lookup` - Issue + section + page lookups
- `idx_section_issue_name` - Issue-based section queries
- `idx_section_page_lookup` - Page range queries (partial index)
- `unique_section_issue_name` - One section per type per issue

#### Article Table Indexes
- `congressional_record_article_pkey` - Primary key (article_id)
- `idx_article_chamber` - Chamber-based filtering
- `idx_article_congress` - Congress-based filtering  
- `idx_article_content_search` - **GIN index** for full-text search
- `idx_article_issue_date` - Date-based filtering
- `idx_article_page_lookup` - Page range queries (partial index)
- `idx_article_page_numbers` - **Composite index** (chamber, start_page_number, end_page_number)
- `idx_article_section` - Section-based lookups
- `idx_article_title_search` - **GIN index** for title search
- `idx_article_volume_issue` - Volume/issue navigation

### Key Performance Optimizations

#### 1. Denormalized Convenience Fields
The `congressional_record_article` table includes denormalized fields that eliminate expensive joins:

- `volume_number`, `issue_number`, `issue_date`, `congress` - From parent tables
- `chamber` - Extracted from page reference
- `start_page_number`, `end_page_number` - Numeric page values

**Impact**: 
- `find_cr_article_by_page_enhanced()` avoids 3-table joins
- Index `idx_article_page_numbers` enables fast page-based lookups
- Direct chamber filtering without section table joins

#### 2. Full-Text Search Infrastructure
- `content_search_vector` - Generated column with English text search vectors
- `idx_article_content_search` - GIN index for content search
- `idx_article_title_search` - GIN index for title search

**Capabilities**:
- Fast full-text search across article content and titles
- Automatic stemming and language-aware search
- Ranked search results with relevance scoring

#### 3. Partial Indexes for Optional Data
- `idx_article_page_lookup` and `idx_section_page_lookup` only index rows with end_page values
- Reduces index size and improves performance for single-page articles

#### 4. Descending Date Indexes
- `idx_issue_congress_date` and `idx_issue_date` use DESC ordering
- Optimizes common "recent first" query patterns
- Eliminates need for explicit ORDER BY DESC operations

### Function Performance Characteristics

#### Trigger Functions
- **Low Overhead**: Simple validation and field population
- **Indexed Lookups**: Use primary keys and foreign key indexes
- **Batch-Friendly**: Minimal per-row cost for bulk operations

#### Search Functions  
- **find_articles_by_page_range()**: 3-table join with function calls
  - Best for: Complex page range queries with date filtering
  - Performance: Moderate (requires joins and function evaluations)
  
- **find_cr_article_by_page()**: Single table with function calls
  - Best for: Simple page lookups
  - Performance: Good (single table, indexed)
  
- **find_cr_article_by_page_enhanced()**: Single table with convenience fields
  - Best for: High-performance page lookups with metadata
  - Performance: Excellent (leverages denormalized fields and composite indexes)

### Recommended Usage Patterns

#### For High-Volume Production Applications:
1. Use `find_cr_article_by_page_enhanced()` for page-based lookups
2. Leverage convenience fields for filtering (chamber, congress, issue_date)
3. Use full-text search indexes for content queries
4. Prefer indexed columns in WHERE clauses

#### For Data Loading Operations:
1. Batch INSERT operations to amortize trigger costs
2. Consider temporarily disabling triggers for bulk loads
3. Rebuild search vectors after bulk content updates
4. Use prepared statements for repetitive operations

#### For Analytics and Reporting:
1. Use convenience fields to avoid joins where possible
2. Leverage date DESC indexes for temporal queries
3. Consider materialized views for complex aggregations
4. Use covering indexes to avoid table lookups

---

## System Integration

### How Functions Work Together

The Congressional Record functions form a cohesive system:

1. **Data Integrity Layer**:
   - `enforce_issue_volume_consistency()` maintains parent-child relationships
   - `update_updated_at_column()` provides audit trails
   - Check constraints validate data formats and ranges

2. **Data Enhancement Layer**:
   - `populate_article_convenience_fields()` optimizes query performance
   - Helper functions (`extract_page_number()`, `extract_chamber_from_page()`) normalize data

3. **Query Layer**:
   - Search functions provide different performance/feature trade-offs
   - Indexed access patterns support various application needs
   - Full-text search enables content discovery

### Error Handling and Monitoring

#### Function-Level Error Handling
- **Graceful Degradation**: Functions return NULL for invalid inputs rather than errors
- **Descriptive Messages**: Trigger functions provide clear error descriptions
- **Input Validation**: Page format validation prevents runtime errors

#### Monitoring Recommendations
- Track trigger function execution times during bulk operations
- Monitor search function performance with EXPLAIN ANALYZE
- Watch for constraint violations indicating data quality issues
- Alert on unusual patterns in updated_at timestamps

### Backup and Recovery Considerations

#### Function Dependencies
- Helper functions must be restored before dependent functions
- Triggers are automatically reattached during schema restoration
- Generated columns are rebuilt automatically

#### Performance During Recovery
- Consider disabling triggers during large data restorations
- Rebuild search vectors after content restoration
- Update statistics after bulk operations

---

## Development Guidelines

### When to Use Each Function

#### find_articles_by_page_range()
- **Use for**: Complex page range queries with date filtering
- **Avoid for**: High-frequency single page lookups
- **Example**: Finding all articles in House pages H3200-H3250 on a specific date

#### find_cr_article_by_page() vs find_cr_article_by_page_enhanced()
- **Basic version**: Use only if you need minimal metadata
- **Enhanced version**: Preferred for all production use cases
- **Example**: Enhanced version returns congress and date without additional queries

#### Custom Functions
- **Consider creating**: Application-specific aggregation functions
- **Pattern**: Use convenience fields and existing indexes
- **Example**: Functions for page count statistics or chamber activity reports

### Best Practices

#### Query Optimization
```sql
-- Good: Uses convenience fields and indexes
SELECT article_id, title FROM congressional_record_article 
WHERE chamber = 'House' AND issue_date = '2025-01-03';

-- Avoid: Requires joins and function calls
SELECT a.article_id, a.title FROM congressional_record_article a
JOIN congressional_record_section s ON a.section_id = s.section_id
JOIN congressional_record_issue i ON s.issue_id = i.issue_id
WHERE s.name = 'House' AND i.issue_date = '2025-01-03';
```

#### Function Usage
```sql
-- Good: Use enhanced function for metadata
SELECT * FROM find_cr_article_by_page_enhanced('H3218');

-- Good: Use helper functions for data validation
SELECT article_id FROM congressional_record_article 
WHERE extract_page_number(start_page) = 3218;

-- Avoid: Manual string parsing
SELECT article_id FROM congressional_record_article 
WHERE SUBSTRING(start_page FROM '\d+')::int = 3218;
```

### Testing and Validation

#### Function Testing
- Test edge cases (NULL values, invalid page formats)
- Verify trigger consistency during concurrent operations
- Validate search function performance with realistic datasets

#### Data Quality Validation
```sql
-- Verify convenience field accuracy
SELECT COUNT(*) FROM congressional_record_article a
JOIN congressional_record_section s ON a.section_id = s.section_id
JOIN congressional_record_issue i ON s.issue_id = i.issue_id
WHERE a.issue_date != i.issue_date;

-- Check page number extraction
SELECT start_page, extract_page_number(start_page) 
FROM congressional_record_article 
WHERE extract_page_number(start_page) IS NULL;
```

---

## Conclusion

The Congressional Record PostgreSQL function system provides a robust, performant foundation for managing and querying Congressional Record data. The combination of data integrity triggers, performance-optimized convenience fields, and flexible search functions supports both high-volume production applications and complex analytical queries.

Key design principles:
- **Performance-First**: Denormalized fields and strategic indexes
- **Data Integrity**: Comprehensive constraint and trigger system  
- **Flexibility**: Multiple search functions for different use cases
- **Maintainability**: Clear separation of concerns and comprehensive documentation

This system scales efficiently to handle the full Congressional Record dataset while maintaining sub-second query response times for typical application use cases.