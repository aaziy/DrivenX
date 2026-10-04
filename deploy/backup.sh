#!/usr/bin/env bash
#
# Back up the database and the document store, encrypted.
#
#   deploy/backup.sh
#
# Two things, because losing either is serious in a different way: the database is every
# record, and the document store is the evidence - the signed handover forms, the scanned
# Emirates IDs. A backup of one without the other restores a system that knows a customer
# signed something and cannot show it.
#
# A backup that lives on the same disk as the thing it backs up protects against a bad
# deploy and nothing else. BACKUP_RSYNC_TARGET copies it elsewhere; without it, this is
# only half of a backup strategy and says so at the end.
#
# Configuration, all optional:
#   COMPOSE_FILE            compose file to use          (docker-compose.prod.yml)
#   DB_NAME                 database to back up          (drivenx)
#   S3_VOLUME               volume holding the documents (drivenx_s3data)
#   BACKUP_DIR              where backups are written    (/var/backups/drivenx)
#   BACKUP_PASSPHRASE_FILE  encryption passphrase        (/etc/drivenx/backup.pass)
#   KEEP_DAYS               how long to keep them        (14)
#   BACKUP_RSYNC_TARGET     user@host:/path to copy to   (unset)

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_NAME="${DB_NAME:-drivenx}"
S3_VOLUME="${S3_VOLUME:-drivenx_s3data}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/drivenx}"
BACKUP_PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/etc/drivenx/backup.pass}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [[ ! -s "$BACKUP_PASSPHRASE_FILE" ]]; then
  echo "No passphrase at $BACKUP_PASSPHRASE_FILE. Refusing to write an unencrypted backup." >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
now() { date '+%Y-%m-%dT%H:%M:%S%z'; }
encrypt() { openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$BACKUP_PASSPHRASE_FILE"; }

db_out="$BACKUP_DIR/db-$stamp.dump.enc"
files_out="$BACKUP_DIR/files-$stamp.tar.gz.enc"

# Written under a temporary name and renamed only once everything has succeeded. Without
# this a failed run leaves a file with a backup's name behind - and encrypting nothing
# still produces 32 bytes, so it is not even empty. It looks exactly like a backup until
# the day somebody tries to restore it.
db_part="$db_out.partial"
files_part="$files_out.partial"
trap 'rm -f "$db_part" "$files_part"' EXIT

echo "[$(now)] database -> $db_out"
# Custom format: compressed, and restorable table by table, which a plain SQL dump is not.
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U drivenx -d "$DB_NAME" --format=custom \
  | encrypt > "$db_part"

echo "[$(now)] documents -> $files_out"
# Read-only mount: a backup must not be able to change what it is backing up. The
# Postgres image is used for its tar because it is already on the server; pulling a
# fresh image at half past three in the morning is one more thing that can fail.
docker run --rm -v "$S3_VOLUME:/data:ro" postgres:16-alpine tar czf - -C /data . | encrypt > "$files_part"

# Smaller than this is a header around nothing: a failure upstream, not a backup.
for f in "$db_part" "$files_part"; do
  if [[ "$(wc -c < "$f")" -lt 100 ]]; then
    echo "Backup $f is too small to be real. Something failed upstream." >&2
    exit 1
  fi
done

mv "$db_part" "$db_out"
mv "$files_part" "$files_out"

find "$BACKUP_DIR" -name '*.enc' -mtime "+$KEEP_DAYS" -delete

if [[ -n "${BACKUP_RSYNC_TARGET:-}" ]]; then
  echo "[$(now)] copying off the server -> $BACKUP_RSYNC_TARGET"
  rsync -a --partial "$db_out" "$files_out" "$BACKUP_RSYNC_TARGET/"
else
  echo "WARNING: BACKUP_RSYNC_TARGET is not set. These backups are on the same disk as the data." >&2
fi

echo "[$(now)] done: $(du -h "$db_out" | cut -f1) database, $(du -h "$files_out" | cut -f1) documents"
