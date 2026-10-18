#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ] || [ ! -s "$1" ]; then
  echo "Usage: scripts/restore-db.sh /path/to/sillyStories.archive.gz" >&2
  exit 2
fi
source "$(dirname -- "${BASH_SOURCE[0]}")/db-common.sh"
stop_app
if ! compose exec -T mongodb sh /usr/local/bin/silly-mongo-tools empty; then
  echo "Restore refused: sillyStories must have no collections. See deploy/README.md." >&2
  exit 1
fi
# If a restore fails, keep the app stopped until the operator checks the data.
resume_after_restore=$restart_app
restart_app=false
compose exec -T mongodb sh /usr/local/bin/silly-mongo-tools restore < "$1"
restart_app=$resume_after_restore
echo "Database restored."
