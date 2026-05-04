# Congress API Sync Schedule Audit & Recommendations

**Date:** August 31, 2025  
**Status:** CRITICAL - Multiple Issues Found

---

## 🔴 Critical Issues Found

### 1. **Missing Scheduler Implementations**
- Only 2 of 6 entity types have scheduler code in `index.js`
- Missing: Committees, Committee Reports, Actions, Amendments
- Config defines schedules but they're never used

### 2. **Member Sync is Incomplete**
- Currently only syncs current members (`syncCurrentMembers()`)
- **MUST sync historical members** for cosponsor foreign keys
- Should use `syncAllMembers()` method

### 3. **Bill Sync Still Has Errors**
- Service logs show it's still trying to fetch sponsors separately (404s)
- Should use sponsors from main bill response
- Needs to use `sync-recent-bills.js` for incremental updates

### 4. **No Dependency Ordering**
- Syncs run independently without considering foreign keys
- Bills depend on members existing
- Committee reports depend on bills existing

---

## ✅ Recommended Sync Schedule

### **Dependency Order (CRITICAL)**

```
1. Members (includes historical) 
   ↓
2. Committees
   ↓  
3. Bills
   ↓
4. Committee Reports
```

### **Optimal Schedule Timing**

| Entity | Schedule | Type | Reason |
|--------|----------|------|---------|
| **Members** | Monthly (1st @ 3 AM) | Full sync (current + historical) | Member changes are rare |
| **Committees** | Weekly (Monday @ 4 AM) | Full sync | Committee changes are infrequent |
| **Bills** | Every 4 hours | Incremental (last 100) | High activity, needs frequent updates |
| **Committee Reports** | Daily @ 1 AM | Incremental (last 30 days) | Moderate activity |

### **Full Sync vs Incremental**

#### Incremental Syncs (Regular Schedule):
- **Bills**: Fetch latest 100 bills sorted by updateDate
- **Reports**: Fetch reports from last 30 days
- **Members**: Always full (they're not that many)
- **Committees**: Always full (they're not that many)

#### Full Syncs (Manual/Monthly):
- Run manually or monthly for complete data refresh
- Use checkpoint/resume for large datasets
- Rate limited to prevent API throttling

---

## 📋 Implementation Checklist

### Immediate Actions Required:

1. **Fix Member Sync** ✅
   ```javascript
   // Change from:
   await syncer.syncCurrentMembers();
   // To:
   await syncer.syncAllMembers();
   ```

2. **Add Committee Scheduler** ✅
   - Created in `index-improved.js`

3. **Add Committee Report Scheduler** ✅
   - Created in `index-improved.js`
   - Uses incremental sync for scheduled runs

4. **Fix Bill Sync** ✅
   - Use `sync-recent-bills.js` for incremental
   - Remove sponsor fetch attempts

5. **Implement Dependency Ordering** ✅
   - Initial sync runs in correct order
   - Stagger scheduled times to maintain order

---

## 🚀 Deployment Steps

1. **Test the improved scheduler**:
   ```bash
   node index-improved.js --help
   node index-improved.js --entity members  # Test manual sync
   ```

2. **Stop current service**:
   ```bash
   sudo systemctl stop congress-sync.service
   ```

3. **Update service file**:
   ```bash
   sudo vim /etc/systemd/system/congress-sync.service
   # Change: ExecStart=/usr/bin/node index-improved.js --initial-sync
   ```

4. **Reload and restart**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl start congress-sync.service
   sudo systemctl status congress-sync.service
   ```

---

## 📊 Monitoring

### Health Check Endpoint
- URL: `http://localhost:3001/health`
- Shows all scheduled jobs and their status
- Check last run times and next scheduled runs

### Log Monitoring
```bash
# Watch sync service logs
journalctl -u congress-sync.service -f

# Check for errors
journalctl -u congress-sync.service | grep -i error
```

### Database Verification Queries
```sql
-- Check sync completeness
SELECT 
  'Bills' as entity,
  COUNT(*) as total,
  MAX(updated_at) as last_update
FROM bill
WHERE congress_id = 119
UNION ALL
SELECT 
  'Members',
  COUNT(*),
  MAX(updated_at)
FROM member
UNION ALL
SELECT 
  'Committees',
  COUNT(*),
  MAX(updated_at)
FROM committee
UNION ALL
SELECT 
  'Reports',
  COUNT(*),
  MAX(updated_at)
FROM committee_report
WHERE congress_id = 119;

-- Check for foreign key issues
SELECT 
  'Orphaned Cosponsors' as issue,
  COUNT(*) as count
FROM bill_cosponsor bc
LEFT JOIN member m ON bc.bioguide_id = m.bioguide_id
WHERE m.bioguide_id IS NULL
UNION ALL
SELECT 
  'Orphaned Report-Bills',
  COUNT(*)
FROM committee_report_bill crb
LEFT JOIN bill b ON crb.bill_id = b.bill_id
WHERE b.bill_id IS NULL;
```

---

## 🎯 Expected Outcomes After Implementation

1. **Zero foreign key constraint violations**
2. **Complete historical member data for cosponsors**
3. **All committee reports properly linked to bills**
4. **Incremental syncs running smoothly every 4 hours**
5. **No more 404 errors in logs**

---

## 📝 Notes

- The improved scheduler (`index-improved.js`) addresses all identified issues
- Maintains backward compatibility with existing data
- Uses proper dependency ordering
- Implements incremental sync for efficiency
- Ready for production deployment after testing