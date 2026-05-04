#!/bin/bash

# Congress API Database Backup Script (Enhanced)
# Backs up the congress_api PostgreSQL database with improved error handling

set -euo pipefail

# Configuration — DB_PASSWORD must be set in the environment (e.g. via systemd
# EnvironmentFile or a sourced .env). The script refuses to run without it.
: "${DB_PASSWORD:?DB_PASSWORD must be set in the environment}"
DB_NAME="congress_api"
DB_USER="congress_admin"
DB_HOST="localhost"
BACKUP_DIR="/storage/backups/congress-api"
DATE=$(date +"%Y%m%d_%H%M%S")
DAY_OF_WEEK=$(date +%A)
if [ "$DAY_OF_WEEK" = "Sunday" ]; then
    BACKUP_FILE="congress_api_weekly_${DATE}.sql.gz"
else
    BACKUP_FILE="congress_api_backup_${DATE}.sql.gz"
fi
LOG_FILE="/var/log/congress-api-backup.log"

# Error handling setup
trap 'ERROR_CODE=$?; log_error "Script failed at line $LINENO with exit code $ERROR_CODE"; exit $ERROR_CODE' ERR
trap 'cleanup_on_exit' EXIT INT TERM

# Function to log messages
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
    logger -p user.info -t congress-backup "$1"
}

# Function to log errors
log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" | tee -a "$LOG_FILE"
    logger -p user.err -t congress-backup "ERROR: $1"
}

# Cleanup function
cleanup_on_exit() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log_error "Backup process terminated unexpectedly with exit code: $exit_code"
        # Clean up partial backup file if it exists
        if [ -n "${BACKUP_FILE:-}" ] && [ -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
            rm -f "$BACKUP_DIR/$BACKUP_FILE"
            log_message "Cleaned up partial backup file: $BACKUP_FILE"
        fi
    fi
}

# Pre-flight checks
check_prerequisites() {
    log_message "Running pre-flight checks"
    
    # Check if backup directory exists and is writable
    if [ ! -d "$BACKUP_DIR" ]; then
        log_message "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR" || {
            log_error "Failed to create backup directory: $BACKUP_DIR"
            exit 1
        }
    fi
    
    if [ ! -w "$BACKUP_DIR" ]; then
        log_error "Backup directory not writable: $BACKUP_DIR"
        exit 1
    fi
    
    # Check disk space (require at least 1GB free)
    AVAILABLE=$(df "$BACKUP_DIR" | awk 'NR==2 {print $4}')
    REQUIRED=1048576  # 1GB in KB
    
    # Handle both numeric and suffixed output from df
    if [[ "$AVAILABLE" =~ ^[0-9]+$ ]]; then
        if [ "$AVAILABLE" -lt "$REQUIRED" ]; then
            log_error "Insufficient disk space. Available: ${AVAILABLE}KB, Required: ${REQUIRED}KB"
            exit 1
        fi
    else
        # Convert human-readable format if needed
        AVAILABLE_BYTES=$(df -B1 "$BACKUP_DIR" | awk 'NR==2 {print $4}')
        REQUIRED_BYTES=$((REQUIRED * 1024))
        if [ "$AVAILABLE_BYTES" -lt "$REQUIRED_BYTES" ]; then
            log_error "Insufficient disk space. Available: $AVAILABLE_BYTES bytes, Required: $REQUIRED_BYTES bytes"
            exit 1
        fi
    fi
    log_message "Disk space check passed. Available space in $BACKUP_DIR"
    
    # Check if pg_dump is available
    if ! command -v pg_dump >/dev/null 2>&1; then
        log_error "pg_dump command not found"
        exit 1
    fi
    
    # Check if gzip is available
    if ! command -v gzip >/dev/null 2>&1; then
        log_error "gzip command not found"
        exit 1
    fi
    
    log_message "Pre-flight checks completed successfully"
}

# Test database connectivity
test_db_connection() {
    log_message "Testing database connectivity"
    
    # Export password for pg_isready
    export PGPASSWORD="$DB_PASSWORD"
    
    if ! pg_isready -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
        log_error "Database connection failed: $DB_HOST:$DB_NAME"
        exit 1
    fi
    
    # Test actual connection with a simple query
    if ! psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
        log_error "Database query test failed: $DB_HOST:$DB_NAME"
        exit 1
    fi
    
    log_message "Database connectivity test passed"
}

# Validate backup file integrity
validate_backup() {
    local backup_file="$1"
    
    log_message "Validating backup file integrity"
    
    if [ ! -f "$backup_file" ]; then
        log_error "Backup file not found: $backup_file"
        return 1
    fi
    
    # Check if file is not empty
    if [ ! -s "$backup_file" ]; then
        log_error "Backup file is empty: $backup_file"
        return 1
    fi
    
    # Test gzip integrity
    if ! gzip -t "$backup_file" 2>/dev/null; then
        log_error "Backup file corrupted (gzip test failed): $backup_file"
        return 1
    fi
    
    # Get file size for logging
    BACKUP_SIZE=$(du -h "$backup_file" | cut -f1)
    log_message "Backup file validation passed. Size: $BACKUP_SIZE"
    
    return 0
}

# Main backup function
perform_backup() {
    log_message "Starting backup of congress_api database"
    
    # Export password for pg_dump
    export PGPASSWORD="$DB_PASSWORD"
    
    # Create backup with error capture
    local temp_error_file=$(mktemp)
    local temp_backup_file="${BACKUP_DIR}/.${BACKUP_FILE}.tmp"
    
    # Use temporary file to avoid partial backups
    if pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --verbose --no-password 2>"$temp_error_file" | gzip -9 > "$temp_backup_file"; then
        # Move temp file to final location atomically
        mv "$temp_backup_file" "$BACKUP_DIR/$BACKUP_FILE"
        # Log any warnings from pg_dump
        if [ -s "$temp_error_file" ]; then
            log_message "pg_dump warnings/info:"
            while IFS= read -r line; do
                log_message "  $line"
            done < "$temp_error_file"
        fi
        
        rm -f "$temp_error_file"
        
        # Validate the backup
        if validate_backup "$BACKUP_DIR/$BACKUP_FILE"; then
            log_message "Backup completed successfully: $BACKUP_DIR/$BACKUP_FILE"
        else
            log_error "Backup validation failed"
            exit 1
        fi
        
    else
        # Log errors from pg_dump
        log_error "pg_dump failed with errors:"
        while IFS= read -r line; do
            log_error "  $line"
        done < "$temp_error_file"
        rm -f "$temp_error_file"
        # Clean up temp backup file if it exists
        [ -f "$temp_backup_file" ] && rm -f "$temp_backup_file"
        exit 1
    fi
}

# Cleanup old backups
cleanup_old_backups() {
    log_message "Cleaning up old backups"
    
    # Count files before cleanup
    OLD_DAILY_COUNT=$(find "$BACKUP_DIR" -name "congress_api_backup_*.sql.gz" -mtime +7 | wc -l)
    
    if [ "$OLD_DAILY_COUNT" -gt 0 ]; then
        log_message "Removing $OLD_DAILY_COUNT old daily backup files"
        find "$BACKUP_DIR" -name "congress_api_backup_*.sql.gz" -mtime +7 -delete
    fi
    
    # Keep only last 4 weekly backups (1 month)
    OLD_WEEKLY_COUNT=$(find "$BACKUP_DIR" -name "congress_api_weekly_*.sql.gz" -mtime +28 | wc -l)
    
    if [ "$OLD_WEEKLY_COUNT" -gt 0 ]; then
        log_message "Removing $OLD_WEEKLY_COUNT old weekly backup files"
        find "$BACKUP_DIR" -name "congress_api_weekly_*.sql.gz" -mtime +28 -delete
    fi
    
    log_message "Backup cleanup completed"
}

# Lock file to prevent concurrent backups
LOCK_FILE="/var/lock/congress-backup.lock"

# Main execution
main() {
    # Check for lock file
    if [ -f "$LOCK_FILE" ]; then
        # Check if the process is still running
        if [ -d "/proc/$(cat "$LOCK_FILE")" ]; then
            log_error "Another backup process is already running (PID: $(cat "$LOCK_FILE"))"
            exit 1
        else
            log_message "Removing stale lock file"
            rm -f "$LOCK_FILE"
        fi
    fi
    
    # Create lock file
    echo $$ > "$LOCK_FILE"
    trap 'rm -f "$LOCK_FILE"' EXIT
    
    log_message "=== Congress API Backup Started ==="
    log_message "Backup type: $([ "$DAY_OF_WEEK" = "Sunday" ] && echo "Weekly" || echo "Daily")"
    log_message "Target file: $BACKUP_FILE"
    
    check_prerequisites
    test_db_connection
    perform_backup
    cleanup_old_backups
    
    # Final status
    CURRENT_BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
    log_message "Backup process completed successfully. Total backups: $CURRENT_BACKUP_COUNT"
    log_message "=== Congress API Backup Finished ==="
}

# Run main function
main