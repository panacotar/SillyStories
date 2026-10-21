#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/db-common.sh"
backup_dir=${1:-$project_root/backups}
mkdir -p -- "$backup_dir"
chmod 700 "$backup_dir"
backup_partial=$(mktemp "$backup_dir/.sillyStories-XXXXXXXX")
backup_file="$backup_dir/sillyStories-$(date -u +%Y%m%dT%H%M%SZ)-${backup_partial##*-}.archive.gz"
stop_app
compose exec -T mongodb sh /usr/local/bin/silly-mongo-tools dump > "$backup_partial"
test -s "$backup_partial"
mv -- "$backup_partial" "$backup_file"
backup_partial=""
echo "Backup saved: $backup_file"
