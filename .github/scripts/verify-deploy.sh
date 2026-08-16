#!/usr/bin/env bash
# Post-deploy verification (M0 plan Task 0.7, extended 15 Aug 2026).
#
# A wrangler deploy that returns success is not proof the edge serves the new
# code: on 15 Aug 2026 a hand-deployed worker reported an old build for
# minutes after a successful deploy, and another sat stale for hours without
# anyone noticing. This asks the live endpoint what it is running and fails
# the job if the answer is not the commit we just deployed.
#
# EXTENDED 15 Aug 2026. Serving the right commit was never enough. /health
# reported only {service, environment, build}, so it returned green for ten
# merged PRs against Neon branches holding zero tables, and stayed green for
# hours while all six Workers held an empty connection string. The endpoint now
# runs a real query against a real table and reports its applied migration
# count, and this script fails the deploy unless:
#
#   database.ok         is true                      (it can query at all)
#   database.migrations equals the migration files    (schema matches code)
#                       in the commit being deployed
#
# The second check is the one that matters. Code deployed against a schema it
# does not match is worse than a failed deploy, because it runs.
#
# Usage: verify-deploy.sh <dev|staging|production> <short-sha> <expected-migrations>

set -euo pipefail

target="${1:?usage: verify-deploy.sh <env> <short-sha> <expected-migrations>}"
expected="${2:?usage: verify-deploy.sh <env> <short-sha> <expected-migrations>}"
want_migrations="${3:?usage: verify-deploy.sh <env> <short-sha> <expected-migrations>}"

# Addresses come from config/environments.json, the one place a public address
# is written down. Hardcoding a hostname pattern here is what went wrong on
# 16 Aug 2026: adding a custom domain made Cloudflare disable the workers.dev
# hostname, and the checks went red against an address nobody reaches while
# production was healthy. A pattern encodes an assumption about deployment
# shape; the config encodes the address.
# A read loop rather than mapfile: mapfile needs bash 4 and macOS ships 3.2,
# so the script would work in CI and fail on the machine of whoever needed to
# debug CI.
hosts=()
while IFS= read -r line; do
  [ -n "$line" ] && hosts+=("$line")
done < <(python3 -c "
import json, sys
envs = json.load(open('config/environments.json'))
target = sys.argv[1]
if target not in envs or target.startswith('_'):
    sys.exit('unknown target: ' + target)
for origin in envs[target].values():
    print(origin + '|' + target)
" "$target")

if [ "${#hosts[@]}" -eq 0 ]; then
  echo "no addresses configured for $target" >&2
  exit 1
fi

# Read a dotted field out of the JSON body. Returns empty on any failure, so a
# malformed body reads as a mismatch rather than crashing the script.
field() {
  printf '%s' "$1" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
for k in sys.argv[1].split('.'):
    if not isinstance(d, dict) or k not in d:
        print(''); raise SystemExit
    d = d[k]
print('' if d is None else (str(d).lower() if isinstance(d, bool) else d))
" "$2" 2>/dev/null || echo ""
}

# Cloudflare propagation is not instant. Poll rather than sleep-and-hope, so a
# slow rollout does not read as a failure and a genuine failure still fails.
# Overridable so the failure path is testable without waiting two minutes.
attempts=${VERIFY_ATTEMPTS:-20}
delay=${VERIFY_DELAY:-6}

for entry in "${hosts[@]}"; do
  origin="${entry%%|*}"
  want_env="${entry##*|}"
  echo "verifying $origin/health"

  for ((i = 1; i <= attempts; i++)); do
    # Deliberately NOT curl -f: /health answers 503 when the database half
    # fails, and that body carries the reason. Discarding it would leave the
    # most useful failure message unread.
    body="$(curl -sS --max-time 15 "$origin/health" || echo '{}')"

    got_build="$(field "$body" build)"
    got_env="$(field "$body" environment)"
    got_ok="$(field "$body" database.ok)"
    got_migrations="$(field "$body" database.migrations)"

    if [[ "$got_build" == "$expected" && "$got_env" == "$want_env" \
       && "$got_ok" == "true" && "$got_migrations" == "$want_migrations" ]]; then
      echo "  ok: build=$got_build environment=$got_env database.ok=true migrations=$got_migrations"
      break
    fi

    if (( i == attempts )); then
      echo "  FAIL after $attempts attempts" >&2
      echo "  expected build=$expected environment=$want_env database.ok=true migrations=$want_migrations" >&2
      echo "  got      build=${got_build:-<none>} environment=${got_env:-<none>} database.ok=${got_ok:-<none>} migrations=${got_migrations:-<none>}" >&2
      echo "  response: $body" >&2
      if [[ "$got_build" == "$expected" && "$got_ok" != "true" ]]; then
        echo "  The right code is deployed but it cannot query its database." >&2
      elif [[ -n "$got_migrations" && "$got_migrations" != "$want_migrations" ]]; then
        echo "  Schema drift: this commit carries $want_migrations migrations, the database has $got_migrations." >&2
      fi
      exit 1
    fi
    sleep "$delay"
  done
done

echo "all $target endpoints serve $expected against a schema of $want_migrations migrations"
