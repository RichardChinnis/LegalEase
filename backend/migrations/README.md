# Congressional API Database Migrations

This directory contains database migration scripts for the Congressional API backend.

## Overview

The database schema supports both chat functionality and Congressional data storage:

- **Chat Tables**: `chat_conversations`, `chat_messages` (existing)
- **Congressional Tables**: Core Congressional schema for bills, hearings, reports, etc. (newly added)

## Migration Structure

### Files

- `migrate.js` - Migration runner script
- `001_add_congressional_schema.sql` - Main migration to add Congressional tables
- `001_add_congressional_schema_rollback.sql` - Rollback script
- `README.md` - This documentation

## Usage

### Check Migration Status
```bash
node migrate.js status
```

### Run All Pending Migrations
```bash
node migrate.js up
```

### Run Specific Migration
```bash
node migrate.js up 001_add_congressional_schema
```

### Rollback Migration
```bash
node migrate.js down 001_add_congressional_schema
```

## Congressional Schema (Migration 001)

### Core Tables Added

#### Legislature Structure
- `congress` - Congressional sessions (118th, 117th, etc.)
- `congress_session` - Session details
- `member` - Congressional members with biographical data
- `member_term` - Historical terms of service
- `committee` - Congressional committees

#### Legislative Content (Search Targets)
- `bill` - Bills and resolutions with titles, policy areas, latest actions
- `bill_summary` - Bill summaries for search
- `bill_title` - Various bill titles
- `hearing` - Committee hearings with titles and citations
- `committee_report` - Committee reports with citations
- `action` - Legislative actions with searchable text

#### Relationships
- `bill_sponsor` / `bill_cosponsor` - Bill sponsorship
- `bill_committee_activity` - Committee activities on bills
- `committee_report_bill` - Links reports to bills
- `member_committee` - Committee membership
- `action_committee` - Committee involvement in actions

### Search-Optimized Features

#### Full-Text Search Indexes (GIN)
- `bill.title` - Bill titles
- `bill.latest_action_text` - Latest legislative actions
- `bill_summary.text` - Bill summaries
- `bill_title.title` - All bill title variants
- `hearing.title` - Hearing titles
- `hearing.citation` - Hearing citations
- `committee_report.citation` - Report citations
- `action.text` - Action descriptions
- `member` names - Member search
- `committee.name` - Committee names

#### Performance Indexes
- Date-based filtering (introduced_date, latest_action_date)
- Type-based filtering (bill_type, chamber, report_type)
- Congress session filtering
- Foreign key relationships

#### ENUM Types
- `chamber` - House, Senate, Joint, NoChamber
- `bill_type` - hr, s, hres, sres, hjres, sjres, hconres, sconres
- `vote_result` - Passed, Failed, Agreed to, Disagreed to

### Data Integrity

- Foreign key constraints ensure referential integrity
- Automatic timestamp updates via triggers
- Transaction-based migrations for atomicity
- Safe rollback capability

## Migration Safety

### What's Protected
- **Existing chat tables remain untouched**
- All existing data is preserved
- Foreign key relationships are maintained
- Rollback removes only Congressional tables

### Testing
The migration has been tested to:
- ✅ Add Congressional schema without affecting chat functionality
- ✅ Create all necessary indexes for search performance
- ✅ Properly handle ENUM types and constraints
- ✅ Support complete rollback
- ✅ Maintain chat table integrity throughout process

## Next Steps

After running the migration:

1. **Data Population**: Use Congress.gov API to populate the Congressional tables
2. **Search Implementation**: Implement vector search with the new schema
3. **API Integration**: Update API endpoints to query Congressional data
4. **Performance Testing**: Monitor query performance with real data

## Troubleshooting

### Migration Already Applied
```
Migration 001_add_congressional_schema has already been applied
```
Check status with `node migrate.js status` - the migration is already complete.

### Connection Issues
Ensure your `.env` file has correct database credentials:
```
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=congress_api
DB_USER=congress_api_backend
DB_PASSWORD=your_password
```

### Rollback Issues
If rollback fails, check for:
- Active connections to the database
- Foreign key dependencies
- Custom data that might prevent table drops

## Schema Evolution

Future migrations should follow the naming convention:
- `002_migration_name.sql`
- `002_migration_name_rollback.sql`

The migration system tracks applied migrations in the `schema_migrations` table.