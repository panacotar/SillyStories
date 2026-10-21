#!/usr/bin/env bash
set -euo pipefail
umask 077
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
if [ ! -f .env.production ]; then
  cp deploy/production.env.example .env.production
fi
chmod 600 .env.production
mkdir -p deploy/secrets
chmod 700 deploy/secrets
for secret_name in mongo_root_password mongo_app_password; do
  if [ ! -e "deploy/secrets/$secret_name" ]; then
    openssl rand -hex 32 > "deploy/secrets/$secret_name"
  fi
  # Compose bind-mounted secrets must be readable by the container's non-root
  # user. The parent directory is accessible only to the deployment owner.
  chmod 444 "deploy/secrets/$secret_name"
done
echo "Production files ready. Set ACME_EMAIL in .env.production before deploying."
