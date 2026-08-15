#!/usr/bin/env bash
# Ephemeral Neon branch per PR (M0 plan Task 0.2). CI calls create on PR open
# or sync, delete on PR close. Parent is staging: CI never receives a copy of
# production data.
#
# Usage:
#   neon-pr-branch.sh create <pr-number>   prints the branch connection string
#   neon-pr-branch.sh delete <pr-number>
#
# Requires: NEON_API_KEY, NEON_PROJECT_ID in the environment.

set -euo pipefail

cmd="${1:?usage: neon-pr-branch.sh create|delete <pr-number>}"
pr="${2:?usage: neon-pr-branch.sh create|delete <pr-number>}"
branch="pr-${pr}"

case "$cmd" in
  create)
    pnpm exec neonctl branches create \
      --project-id "$NEON_PROJECT_ID" \
      --name "$branch" \
      --parent staging \
      --output json
    pnpm exec neonctl connection-string "$branch" \
      --project-id "$NEON_PROJECT_ID"
    ;;
  delete)
    pnpm exec neonctl branches delete "$branch" \
      --project-id "$NEON_PROJECT_ID"
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 1
    ;;
esac
