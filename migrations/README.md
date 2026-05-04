# Congress API Database Migration Guide (Historical)

> **Note:** for fresh installations, use `schema.sql` at the repo root — it is
> the canonical, generated-from-production schema and supersedes the migration
> sequence below. The files in this directory are kept for historical reference
> and to document the role/permission model.

This directory contains SQL scripts that fix the database architecture, security permissions, and schema compatibility issues that arose during the project's evolution.

## Overview of Changes

The migration addresses these issues:
1. **Security**: Backend user had write permissions (should be read-only)
2. **Ownership**: Tables owned by wrong user preventing schema changes
3. **Schema Mismatch**: Database columns don't match what sync service expects
4. **Missing User**: No dedicated sync service user with appropriate permissions

## Execution Order

**IMPORTANT**: Run these scripts in the exact order shown below.

### Step 1: Backup Current State
```bash
sudo -u postgres psql -d congress_api -f 001-backup-current-permissions.sql > /tmp/permissions-backup.sql
```
This creates a backup of current permissions for rollback if needed.

### Step 2: Create Sync User
```bash
sudo -u postgres psql -d congress_api -f 002-create-sync-user.sql
```
Creates `congress_sync_writer` user with secure password.

### Step 3: Transfer Ownership
```bash
sudo -u postgres psql -d congress_api -f 003-transfer-table-ownership.sql
```
Transfers all table ownership to `congress_admin` for proper schema management.

### Step 4: Grant Sync Permissions
```bash
sudo -u postgres psql -d congress_api -f 004-grant-sync-permissions.sql
```
Grants read/write permissions to sync service user.

### Step 5: Restrict Backend Permissions
```bash
sudo -u postgres psql -d congress_api -f 005-restrict-backend-permissions.sql
```
Makes backend user read-only for security.

### Step 6: Fix Schema Issues
```bash
sudo -u postgres psql -d congress_api -f 006-fix-table-columns.sql
```
Adds missing columns that sync service expects.

### Step 7: Verify Setup
```bash
sudo -u postgres psql -d congress_api -f 007-verify-setup.sql
```
Comprehensive verification that all changes worked correctly.

## After Migration

### Update Service Configurations

**sync-service/.env**:
```bash
DB_USER=congress_sync_writer
DB_PASSWORD=<the password you set in step 2>
```

**backend/.env** (confirm it's read-only):
```bash
DB_USER=congress_api_backend
DB_PASSWORD=<your backend user password>
```

### Restart Services

```bash
# Restart sync service
sudo systemctl restart congress-sync

# Restart backend service
sudo systemctl restart your-backend-service
```

### Monitor Results

```bash
# Check sync service logs
journalctl -u congress-sync -f

# Verify no more "column does not exist" errors
journalctl -u congress-sync --since "5 minutes ago" | grep -i error
```

## Security Notes

- **congress_admin**: Owns tables, runs migrations, has full schema control
- **congress_sync_writer**: Can read/write data but cannot alter schema
- **congress_api_backend**: Read-only access, cannot modify any data

This follows the principle of least privilege and prevents accidental data corruption.

## Rollback Plan

If anything goes wrong, restore permissions using:
```bash
sudo -u postgres psql -d congress_api -f /tmp/permissions-backup.sql
```

## Password Security

When creating the sync user (step 2 above), generate a strong random password
and substitute it for `CHANGE_ME_BEFORE_RUNNING` in `002-create-sync-user.sql`
*before* executing that script. Example:

```bash
openssl rand -base64 32 | tr -d '+/=' | head -c 32
```

To rotate later:

```sql
ALTER USER congress_sync_writer PASSWORD 'your_new_secure_password';
```

Never commit a real password to this file or any other tracked file. The
release script (`release-to-public.sh`) scans for this and will refuse to push.

## Verification Checklist

After running all migrations, verify:
- [ ] No "column does not exist" errors in sync service logs
- [ ] Backend service still works (read-only access)
- [ ] Sync service can insert/update data
- [ ] All tables owned by congress_admin
- [ ] Backend user has only SELECT permissions
- [ ] Sync user has appropriate read/write permissions

## Support

If you encounter issues:
1. Check the verification output from step 7
2. Review service logs for specific error messages
3. Use the rollback script if needed to restore original state