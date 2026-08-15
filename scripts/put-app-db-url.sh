#!/bin/zsh
# Reissues NEON_DATABASE_URL for one environment, for BOTH Workers, as
# marginsheet_app. The value is never displayed and never touches disk.
#
# Usage: scripts/put-app-db-url.sh <dev|staging|production>
#
# Reads the password from /tmp/apppw. Generate it first, delete it after:
#   head -c 24 /dev/urandom | base64 | tr -d '/+=' > /tmp/apppw
#
# WHY THE VALIDATION EXISTS: on 15 Aug 2026 this reissue was done as a bare
# pipe, `app-db-url.mts <branch> | wrangler secret put`. The helper could not
# start, the pipe delivered nothing, and `wrangler secret put` stored the empty
# string in all six secrets and reported success for every one. Every
# environment kept reporting healthy, because nothing was asking the database
# anything. A pipe carries a failure as an empty payload, which is
# indistinguishable from a successful empty result unless something checks.
# This checks.
set -eu
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

env_name="${1:?usage: put-app-db-url.sh <dev|staging|production>}"
case "$env_name" in
  # An explicit empty --env targets the top-level environment. Without it
  # wrangler warns that no target was specified, which is exactly the class of
  # ambiguity that put empty strings in six secrets.
  dev)        branch=dev;     wrangler_env=(--env="") ;;
  staging)    branch=staging; wrangler_env=(--env staging) ;;
  production) branch=main;    wrangler_env=(--env production) ;;
  *) echo "unknown environment: $env_name" >&2; exit 1 ;;
esac

if [[ ! -s /tmp/apppw ]]; then
  echo "/tmp/apppw is missing or empty. Generate the password first." >&2
  exit 1
fi

# Capture rather than pipe, so a failure upstream is visible as a failure
# instead of arriving as an empty payload.
url="$(pnpm exec tsx scripts/app-db-url.mts "$branch")" || {
  echo "REFUSING: the helper failed for branch $branch. Nothing was stored." >&2
  exit 1
}

case "$url" in
  postgresql://marginsheet_app:*@*/marginsheet\?sslmode=require) ;;
  *)
    echo "REFUSING: the helper produced ${#url} characters that are not a" >&2
    echo "marginsheet_app connection string. Nothing was stored." >&2
    exit 1
    ;;
esac

for svc in api conversation; do
  printf '%s' "$url" | scripts/wrangler "$svc" secret put NEON_DATABASE_URL "${wrangler_env[@]}"
done
unset url

echo
echo "Stored for $env_name. Now prove it against the live edge:"
echo "  pnpm --filter @marginsheet/api test:db-identity"
echo "Then delete the password file:  rm -f /tmp/apppw"
