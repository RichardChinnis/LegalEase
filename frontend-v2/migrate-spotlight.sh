#!/bin/bash

##############################################################################
# Spotlight Section Migration Script
#
# This script migrates the dashboard to use the redesigned spotlight section.
# It creates backups, updates HTML, and provides rollback instructions.
#
# Usage:
#   ./migrate-spotlight.sh [--dry-run] [--rollback]
#
# Options:
#   --dry-run   Show what would be changed without making changes
#   --rollback  Restore original files from backup
##############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/backups/spotlight-migration-$(date +%Y%m%d-%H%M%S)"
HTML_FILE="${SCRIPT_DIR}/index.html"
DASHBOARD_JS="${SCRIPT_DIR}/js/pages/dashboard.js"

# Parse arguments
DRY_RUN=false
ROLLBACK=false

for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --rollback)
            ROLLBACK=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown argument: $arg${NC}"
            echo "Usage: $0 [--dry-run] [--rollback]"
            exit 1
            ;;
    esac
done

##############################################################################
# Helper Functions
##############################################################################

print_header() {
    echo -e "\n${BLUE}==================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}==================================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_file_exists() {
    if [ ! -f "$1" ]; then
        print_error "File not found: $1"
        exit 1
    fi
}

create_backup() {
    local file=$1
    local backup_path="${BACKUP_DIR}/$(basename $file)"

    mkdir -p "$BACKUP_DIR"
    cp "$file" "$backup_path"
    print_success "Backed up: $file → $backup_path"
}

##############################################################################
# Rollback Function
##############################################################################

rollback() {
    print_header "ROLLBACK: Restoring Original Files"

    # Find most recent backup
    LATEST_BACKUP=$(ls -dt ${SCRIPT_DIR}/backups/spotlight-migration-* 2>/dev/null | head -1)

    if [ -z "$LATEST_BACKUP" ]; then
        print_error "No backup found. Cannot rollback."
        exit 1
    fi

    print_info "Found backup: $LATEST_BACKUP"

    # Restore files
    if [ -f "${LATEST_BACKUP}/index.html" ]; then
        cp "${LATEST_BACKUP}/index.html" "$HTML_FILE"
        print_success "Restored index.html"
    fi

    if [ -f "${LATEST_BACKUP}/dashboard.js" ]; then
        cp "${LATEST_BACKUP}/dashboard.js" "$DASHBOARD_JS"
        print_success "Restored dashboard.js"
    fi

    print_success "Rollback complete!"
    print_info "Redesigned component files remain in place (can be manually removed)"

    exit 0
}

##############################################################################
# Main Migration Logic
##############################################################################

migrate() {
    print_header "Spotlight Section Migration"

    if [ "$DRY_RUN" = true ]; then
        print_warning "DRY RUN MODE - No changes will be made"
    fi

    # Step 1: Verify files exist
    print_info "Step 1: Verifying files..."
    check_file_exists "$HTML_FILE"
    check_file_exists "$DASHBOARD_JS"
    check_file_exists "${SCRIPT_DIR}/js/components/spotlight-section-redesign.js"
    check_file_exists "${SCRIPT_DIR}/css/spotlight-redesign.css"
    print_success "All required files present"

    # Step 2: Create backups
    if [ "$DRY_RUN" = false ]; then
        print_info "Step 2: Creating backups..."
        create_backup "$HTML_FILE"
        create_backup "$DASHBOARD_JS"
    else
        print_info "Step 2: Would create backups in: $BACKUP_DIR"
    fi

    # Step 3: Update index.html (add CSS and JS)
    print_info "Step 3: Updating index.html..."

    if [ "$DRY_RUN" = false ]; then
        # Check if already added
        if grep -q "spotlight-redesign.css" "$HTML_FILE"; then
            print_warning "CSS already added to index.html (skipping)"
        else
            # Add CSS after components.css
            sed -i.bak '/components\.css/a\    <link rel="stylesheet" href="css/spotlight-redesign.css">' "$HTML_FILE"
            print_success "Added spotlight-redesign.css to index.html"
        fi

        if grep -q "spotlight-section-redesign.js" "$HTML_FILE"; then
            print_warning "JS already added to index.html (skipping)"
        else
            # Add JS before dashboard.js
            sed -i.bak '/spotlight-section\.js/a\    <script src="js/components/spotlight-section-redesign.js"></script>' "$HTML_FILE"
            print_success "Added spotlight-section-redesign.js to index.html"
        fi
    else
        print_info "Would add spotlight-redesign.css after components.css"
        print_info "Would add spotlight-section-redesign.js after spotlight-section.js"
    fi

    # Step 4: Update dashboard.js (swap component)
    print_info "Step 4: Updating dashboard.js..."

    if [ "$DRY_RUN" = false ]; then
        # Check if already updated
        if grep -q "SpotlightSectionRedesigned" "$DASHBOARD_JS"; then
            print_warning "dashboard.js already using redesigned component (skipping)"
        else
            # Replace SpotlightSection with SpotlightSectionRedesigned
            sed -i.bak 's/new SpotlightSection(/new SpotlightSectionRedesigned(/g' "$DASHBOARD_JS"
            print_success "Updated dashboard.js to use SpotlightSectionRedesigned"
        fi
    else
        print_info "Would replace 'new SpotlightSection(' with 'new SpotlightSectionRedesigned('"
    fi

    # Step 5: Verification
    print_info "Step 5: Verifying changes..."

    if [ "$DRY_RUN" = false ]; then
        if grep -q "spotlight-redesign.css" "$HTML_FILE" && \
           grep -q "spotlight-section-redesign.js" "$HTML_FILE" && \
           grep -q "SpotlightSectionRedesigned" "$DASHBOARD_JS"; then
            print_success "All changes applied successfully!"
        else
            print_error "Verification failed. Some changes may not have been applied."
            print_warning "Check the backup directory: $BACKUP_DIR"
            exit 1
        fi
    else
        print_info "Dry run complete. No changes were made."
    fi

    # Step 6: Post-migration instructions
    print_header "Migration Complete!"

    if [ "$DRY_RUN" = false ]; then
        echo -e "${GREEN}The spotlight section has been successfully migrated!${NC}\n"
        echo "Next steps:"
        echo "  1. Clear your browser cache (Ctrl+Shift+R / Cmd+Shift+R)"
        echo "  2. Open the dashboard in your browser"
        echo "  3. Verify the new split-panel layout appears"
        echo "  4. Test on mobile devices (drawer should appear on tap)"
        echo ""
        echo "If you encounter issues:"
        echo "  - Check browser console for errors"
        echo "  - Rollback with: $0 --rollback"
        echo "  - Backup location: $BACKUP_DIR"
        echo ""
        echo -e "${YELLOW}Testing checklist:${NC}"
        echo "  [ ] List displays 5-6 bills vertically"
        echo "  [ ] First bill auto-selects (detail panel shows)"
        echo "  [ ] Clicking item updates detail panel"
        echo "  [ ] Mobile: Tapping item opens drawer"
        echo "  [ ] Follow button works"
        echo "  [ ] Learn More navigates to bill detail"
    else
        echo -e "${BLUE}Dry run summary:${NC}"
        echo "  - Would create backup in: $BACKUP_DIR"
        echo "  - Would update: index.html"
        echo "  - Would update: dashboard.js"
        echo ""
        echo "To apply changes, run without --dry-run:"
        echo "  $0"
    fi
}

##############################################################################
# Entry Point
##############################################################################

if [ "$ROLLBACK" = true ]; then
    rollback
else
    migrate
fi
