#!/usr/bin/env bash
# Post-deploy verification (M0 plan Task 0.7).
#
# A wrangler deploy that returns success is not proof the edge serves the new
# code: on 15 Aug 2026 a hand-deployed worker reported an old build for
# minutes after a successful deploy, and another sat stale for hours without
# anyone noticing. This asks the live endpoint what it is running and fails
# the job if the answer is not the commit we just deployed.
#
# Usage: verify-deploy.sh <staging|production> <short-sha>

set -euo pipefail

target="${1:?usage: verify-deploy.sh <staging|production> <short-sha>}"
expected="${2:?usage: verify-deploy.sh <staging|production> <short-sha>}"

case "$target" in
  staging)
    hosts=(
      "marginsheet-api-staging.guy-a84.workers.dev|staging"
      "marginsheet-conversation-staging.guy-a84.workers.dev|staging"
    )
    ;;
  production)
    hosts=(
      "marginsheet-api.guy-a84.workers.dev|production"
      "marginsheet-conversation.guy-a84.workers.dev|production"
    )
    ;;
  *)
    echo "unknown target: $target" >&2
    exit 1
    ;;
esac

# Cloudflare propagation is not instant. Poll rather than sleep-and-hope, so a
# slow rollout does not read as a failure and a genuine failure still fails.
attempts=20
delay=6

for entry in "${hosts[@]}"; do
  host="${entry%%|*}"
  want_env="${entry##*|}"
  echo "verifying https://$host/health"

  for ((i = 1; i <= attempts; i++)); do
    body="$(curl -fsS --max-time 10 "https://$host/health" || echo '{}')"
    got_build="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("build",""))' 2>/dev/null || echo "")"
    got_env="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("environment",""))' 2>/dev/null || echo "")"

    if [[ "$got_build" == "$expected" && "$got_env" == "$want_env" ]]; then
      echo "  ok: build=$got_build environment=$got_env"
      break
    fi

    if (( i == attempts )); then
      echo "  FAIL after $attempts attempts" >&2
      echo "  expected build=$expected environment=$want_env" >&2
      echo "  got      build=${got_build:-<none>} environment=${got_env:-<none>}" >&2
      echo "  response: $body" >&2
      exit 1
    fi
    sleep "$delay"
  done
done

echo "all $target endpoints serve $expected"
