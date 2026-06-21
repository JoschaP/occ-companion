#!/usr/bin/env bash
# Seed demo data into the test bucket. Needs: mc alias `occ-test` pointing at the
# bucket, `age`, and .env.test with OCC_TEST_AGE_PUBLIC_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."

PUB=$(grep -m1 OCC_TEST_AGE_PUBLIC_KEY .env.test | sed 's/.*="//;s/"$//')
[ -n "$PUB" ] || { echo "OCC_TEST_AGE_PUBLIC_KEY missing in .env.test"; exit 1; }
WRONG=$(age-keygen 2>/dev/null | grep -i "public key" | sed 's/.*: //')
B=occ-test/occ-secure-exports
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

put_age()   { printf '%s' "$2" >"$tmp/p"; age -r "$PUB"   -o "$tmp/a" "$tmp/p"; mc cp -q "$tmp/a" "$B/$1"; echo "age   $1"; }
put_wrong() { printf '%s' "$2" >"$tmp/p"; age -r "$WRONG" -o "$tmp/a" "$tmp/p"; mc cp -q "$tmp/a" "$B/$1"; echo "wrong $1"; }
put_plain() { printf '%s' "$2" >"$tmp/p"; mc cp -q "$tmp/p" "$B/$1"; echo "plain $1"; }

put_age   "acme/production/api/log-export/2026-06-18/log-export_20260618_a1.json.age" '{"app":"api","rows":1280}'
put_age   "acme/production/api/log-export/2026-06-21/log-export_20260621_e5.json.age" '{"app":"api","rows":2048}'
put_age   "acme/production/web/log-export/2026-06-21/log-export_20260621_f6.json.age" '{"app":"web","rows":512}'
put_age   "acme/production/backups/2026-06-20/db-snapshot.sql.age" 'pretend SQL dump'
put_plain "acme/production/api/manifest.json" '{"note":"NOT encrypted - downloads as-is"}'
put_plain "acme/README.txt" 'Plain text file, downloaded unchanged.'
put_wrong "acme/production/api/log-export/2026-06-21/log-export_20260621_otherkey.json.age" '{"note":"encrypted for a different key"}'
echo "Done."
