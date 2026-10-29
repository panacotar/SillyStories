#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec docker compose --project-directory "$project_root" \
  --env-file "${SILLY_ENV_FILE:-$project_root/.env.production}" \
  -f "${SILLY_COMPOSE_FILE:-$project_root/compose.production.yaml}" "$@"
