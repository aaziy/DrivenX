#!/usr/bin/env bash
#
# Deploy the current code. Run on the server, from /opt/drivenx, as the drivenx user.
#
#   deploy/deploy.sh               an update: back up, build, migrate, restart
#   deploy/deploy.sh --first-run   a new server: also creates the bucket and the first admin
#
# The order matters. The database is backed up before it is migrated, because migrations
# are forward-only and the backup is the only way back. And it is migrated before the new
# application starts: old code against a new schema is survivable for a minute, new code
# against an old schema is not.

set -euo pipefail

cd "$(dirname "$0")/.."

dc() { docker compose -f docker-compose.prod.yml "$@"; }

first_run=false
[[ "${1:-}" == "--first-run" ]] && first_run=true

if [[ ! -f .env ]]; then
  echo "No .env here. Copy deploy/env.production.example to .env and fill it in first." >&2
  exit 1
fi

echo "==> fetching code"
git pull --ff-only

echo "==> building the image"
dc build web

echo "==> starting the database and document store"
dc up -d postgres s3

if [[ "$first_run" == false ]]; then
  if [[ -s /etc/drivenx/backup.pass ]]; then
    echo "==> backing up before migrating"
    deploy/backup.sh
  else
    echo "WARNING: no /etc/drivenx/backup.pass, so no backup before this migration." >&2
  fi
fi

echo "==> migrating"
dc run --rm -T tools db:migrate:deploy

if [[ "$first_run" == true ]]; then
  echo "==> creating the document bucket"
  dc run --rm -T tools storage:ensure-bucket
  echo "==> creating roles, permissions and the first Super Admin"
  dc run --rm -T tools db:seed
fi

echo "==> starting the application"
dc up -d web caddy

dc ps
echo "==> done. Check https://$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2)"
