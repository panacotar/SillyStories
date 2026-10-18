#!/usr/bin/env bash
# Sourced by backup and restore scripts.
set -euo pipefail
umask 077
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
compose() { "$project_root/scripts/production.sh" "$@"; }
lock_dir="$project_root/.db-operation.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Another database operation is running ($lock_dir)." >&2
  exit 1
fi
restart_app=false
backup_partial=""
cleanup() {
  result=$?
  trap - EXIT
  if [ -n "$backup_partial" ]; then rm -f -- "$backup_partial"; fi
  if [ "$restart_app" = true ]; then
    if ! compose start app; then
      echo "App restart failed. Run scripts/production.sh start app." >&2
      result=1
    fi
  fi
  rmdir "$lock_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
stop_app() {
  if [ -n "$(compose ps --status running --quiet app)" ]; then
    restart_app=true
    compose stop app
  fi
}
