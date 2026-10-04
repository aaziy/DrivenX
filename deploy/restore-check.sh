#!/usr/bin/env bash
#
# Prove a database backup can actually be restored, without touching the live database.
#
#   deploy/restore-check.sh /var/backups/drivenx/db-20261001-033000.dump.enc
#
# Restores into a scratch database, counts what came back, and drops it. A backup nobody
# has restored is a belief, not a backup: run this on a schedule and the first time you
# find out it does not work is not the day you need it.
#
# Restoring for real - replacing the live database - is deliberately not scripted. It
# should be a decision somebody makes with the site stopped, from the steps in
# docs/deployment.md, not a command that can be run by accident.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/etc/drivenx/backup.pass}"
SCRATCH="drivenx_restore_check"

backup="${1:-}"
if [[ -z "$backup" || ! -s "$backup" ]]; then
  echo "usage: $0 <db-backup.dump.enc>" >&2
  exit 2
fi

psql() { docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U drivenx -d postgres -v ON_ERROR_STOP=1 "$@"; }

cleanup() { psql -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT

started="$(date +%s)"

psql -qc "DROP DATABASE IF EXISTS $SCRATCH"
psql -qc "CREATE DATABASE $SCRATCH"

openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$backup" \
  | docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore -U drivenx -d "$SCRATCH" --no-owner --exit-on-error

elapsed=$(( $(date +%s) - started ))

query() { docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U drivenx -d "$SCRATCH" -tAc "$1"; }

# The tables whose absence would mean the restore is not a restore.
tables=(users customers vehicles contracts installments payments ledger_entries documents audit_logs)
echo "Restored $backup in ${elapsed}s. Row counts:"
failed=0
for t in "${tables[@]}"; do
  n="$(query "SELECT count(*) FROM $t")"
  printf '  %-16s %s\n' "$t" "$n"
done

# The ledger's append-only trigger is part of the schema. If it did not come back, the
# restored database has lost the guarantee the whole reporting model rests on.
trigger="$(query "SELECT count(*) FROM pg_trigger WHERE tgname = 'ledger_entries_append_only'")"
if [[ "$trigger" != "1" ]]; then
  echo "FAIL: the ledger's append-only trigger did not survive the restore." >&2
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then exit 1; fi
echo "OK: restorable. Write the elapsed time (${elapsed}s) in the runbook."
