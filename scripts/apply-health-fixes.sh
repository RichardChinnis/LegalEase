#!/usr/bin/env bash
#
# Applies the operator-side half of the 2026-09-21 health-report fixes.
# Everything here needs root; the code changes are already committed on
# fix/health-report-findings and need no privileges.
#
#   sudo ./scripts/apply-health-fixes.sh --dry-run   # show what would happen
#   sudo ./scripts/apply-health-fixes.sh
#
# Steps, in this order for a reason:
#   1. restart both services      - picks up the committed fixes, and closes the
#                                   file descriptors still pointing at the rotated
#                                   log archives. Trimming before this would write
#                                   into unlinked inodes and free nothing.
#   2. restore log ownership      - winston recreates rotated files as whichever
#                                   account ran it, which may not be the service
#                                   account. logrotate's `su` stanza needs them
#                                   back under the log directory's own owner.
#   3. trim 2025 from archives    - drops pre-2026 lines, keeps everything else.
#   4. install logrotate config   - ages and compresses what winston bounds.
#
# Safe to re-run: every step checks its own precondition first.

set -euo pipefail

# Derived from this script's own location, so the repo can live anywhere.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_LOGS="$REPO/sync-service/logs"
BACKEND_LOGS="$REPO/backend/logs"
LOGROTATE_TEMPLATE="$REPO/deploy/logrotate/congress-api.example"
LOGROTATE_DST="/etc/logrotate.d/congress-api"
SERVICES=(congress-sync congress-api-backend)

# The logrotate template ships with placeholders rather than this machine's
# paths and account names; they are filled in from what is actually on disk at
# install time. Ownership differs per directory, and logrotate refuses to rotate
# inside a directory it does not own unless `su` names the owning user.
owner_of() { stat -c '%U' "$1" 2>/dev/null || echo root; }
group_of() { stat -c '%G' "$1" 2>/dev/null || echo root; }

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    \033[33mWARN: %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if (( DRY_RUN )); then info "[dry-run] $*"; else "$@"; fi; }

(( EUID == 0 )) || die "must run as root - use: sudo $0 ${1:-}"
[[ -d "$REPO" ]] || die "repo not found at $REPO"
(( DRY_RUN )) && say "DRY RUN - nothing will be changed"

# ---------------------------------------------------------------- 1. restart
say "1/4  Restarting services"
for svc in "${SERVICES[@]}"; do
  info "restarting $svc"
  run systemctl restart "$svc"
done

if (( ! DRY_RUN )); then
  sleep 5
  for svc in "${SERVICES[@]}"; do
    systemctl is-active --quiet "$svc" \
      || die "$svc did not come back up. Check: journalctl -u $svc -n 50"
    info "$svc is active"
  done

  # The bind change only takes effect here. If this line is missing, Apache
  # can still reach the backend, but something else about the restart failed.
  if ss -ltn 2>/dev/null | grep -q '127.0.0.1:3000'; then
    info "backend is bound to 127.0.0.1:3000 as intended"
  else
    warn "backend is not listening on 127.0.0.1:3000 - check the service log"
  fi
fi

# -------------------------------------------------------------- 2. ownership
say "2/4  Restoring sync-service log ownership"
if [[ -d "$SYNC_LOGS" ]]; then
  # shellcheck disable=SC2012
  # The directory kept the intended ownership; only the files winston recreated
  # drifted. So take the directory as the source of truth rather than hardcoding
  # an account name.
  want_user=$(owner_of "$SYNC_LOGS"); want_group=$(group_of "$SYNC_LOGS")
  wrong=$(find "$SYNC_LOGS" -maxdepth 1 -name '*.log' ! -user "$want_user" | wc -l)
  if (( wrong > 0 )); then
    info "$wrong file(s) not owned by $want_user; fixing"
    run chown "$want_user:$want_group" "$SYNC_LOGS"/*.log
  else
    info "already correct, nothing to do"
  fi
else
  warn "$SYNC_LOGS does not exist - skipping"
fi

# ------------------------------------------------------------------ 3. trim
say "3/4  Trimming 2025 lines from rotated log archives"
info "keeping every line that is not stamped 2025; active .log files untouched"

trim_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0

  local before_bytes before_lines drop
  before_bytes=$(stat -c %s "$f")
  before_lines=$(wc -l < "$f")
  drop=$(grep -ac '"timestamp":"2025' "$f" || true)

  if (( drop == 0 )); then
    info "$(basename "$f"): no 2025 lines, skipping"
    return 0
  fi

  if (( DRY_RUN )); then
    info "[dry-run] $(basename "$f"): would drop $drop of $before_lines lines"
    return 0
  fi

  local tmp
  tmp=$(mktemp "${f}.trim.XXXXXX")
  # `|| true` because grep -v exits 1 when nothing matches, which is not an error here.
  grep -av '"timestamp":"2025' "$f" > "$tmp" || true
  # Rewrite through the original inode so ownership, mode and any open
  # descriptor survive; mv would replace the file and break both.
  cat "$tmp" > "$f"
  rm -f "$tmp"

  local after_bytes
  after_bytes=$(stat -c %s "$f")
  info "$(basename "$f"): dropped $drop lines, $(numfmt --to=iec "$before_bytes") -> $(numfmt --to=iec "$after_bytes")"
}

shopt -s nullglob
for f in "$SYNC_LOGS"/*[0-9].log "$BACKEND_LOGS"/*[0-9].log; do
  trim_file "$f"
done
shopt -u nullglob

# ------------------------------------------------------------- 4. logrotate
say "4/4  Installing logrotate config"
if [[ ! -f "$LOGROTATE_TEMPLATE" ]]; then
  warn "$LOGROTATE_TEMPLATE missing - skipping (is the branch checked out?)"
else
  rendered=$(mktemp)
  sed -e "s#__REPO__#$REPO#g" \
      -e "s#__SYNC_USER__#$(owner_of "$SYNC_LOGS")#g" \
      -e "s#__SYNC_GROUP__#$(group_of "$SYNC_LOGS")#g" \
      -e "s#__BACKEND_USER__#$(owner_of "$BACKEND_LOGS")#g" \
      -e "s#__BACKEND_GROUP__#$(group_of "$BACKEND_LOGS")#g" \
      "$LOGROTATE_TEMPLATE" > "$rendered"
  info "rendered for $REPO (sync: $(owner_of "$SYNC_LOGS"), backend: $(owner_of "$BACKEND_LOGS"))"

  if [[ -f "$LOGROTATE_DST" ]] && cmp -s "$rendered" "$LOGROTATE_DST"; then
    info "already installed and identical"
    rm -f "$rendered"
  else
    run install -o root -g root -m 644 "$rendered" "$LOGROTATE_DST"
    rm -f "$rendered"
    info "installed to $LOGROTATE_DST"
    if (( ! DRY_RUN )); then
      info "validating (debug mode changes nothing):"
      logrotate --debug "$LOGROTATE_DST" 2>&1 | sed 's/^/      /' || warn "logrotate reported a problem above"
    fi
  fi
fi

# ---------------------------------------------------------------- summary
say "Done"
if (( DRY_RUN )); then
  info "dry run only - re-run without --dry-run to apply"
else
  df -h "$REPO" | awk 'NR==2 {printf "    disk now: %s used of %s (%s free)\n", $3, $2, $4}'
  info "logs:"
  ls -la "$SYNC_LOGS" "$BACKEND_LOGS" 2>/dev/null | sed 's/^/      /'
fi
