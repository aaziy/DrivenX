#!/usr/bin/env bash
#
# Fill an EMPTY server with a made-up leasing business, for showing DrivenX to people.
#
#   DEMO_STAFF_PASSWORD='Choose2026Something' deploy/demo-data.sh
#
# Demo only. The seed refuses to run against a database that already holds a customer, so
# it cannot mix with real records. Before a demo server becomes the real one, it is emptied
# and deployed again from scratch - see "A demo server" in docs/deployment.md.
#
# Three demo staff accounts are created (sales, operations, finance), all with
# DEMO_STAFF_PASSWORD. Their addresses are at example.com, which never receives mail.

set -euo pipefail

cd "$(dirname "$0")/.."

: "${DEMO_STAFF_PASSWORD:?Set DEMO_STAFF_PASSWORD: 12+ characters with upper case, lower case and a digit.}"

dc() { docker compose -f docker-compose.prod.yml "$@"; }

echo "==> loading the demo business"
# -e NAME with no value passes the variable through from this shell, so the password never
# appears in the command line that `ps` shows other users of the server.
dc run --rm -T -e DEMO_SEED=yes -e DEMO_STAFF_PASSWORD tools db:seed:demo

echo "==> running the nightly jobs once, so today's alerts appear"
for job in expiry-scan maintenance-due contracts-daily; do
  dc run --rm -T worker "$job" >/dev/null
done

echo "==> done. Sign in as the Super Admin, or as a demo staff member:"
echo "    layla.hassan@example.com (sales), karim.nasser@example.com (operations),"
echo "    noura.saeed@example.com (finance) - all with DEMO_STAFF_PASSWORD."
