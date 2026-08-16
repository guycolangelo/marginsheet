#!/usr/bin/env bash
# Ephemeral Neon branch per PR (M0 plan Task 0.2). CI calls create on PR open
# or sync, delete on PR close. Parent is staging: CI never receives a copy of
# production data.
#
# FRESH ON EVERY RUN (ruled 16 August 2026). This used to reuse an existing
# pr-<n> branch across runs, which carried the migration ledger forward between
# them. On 15 Aug that let a run test a schema built by a migration the
# repository no longer contained: the ledger said applied, so the corrected SQL
# never ran, and the introspection step reported a missing constraint that the
# file plainly declared. Nothing was wrong with the code under test.
#
# A reused branch makes every CI result depend on what a previous run left
# behind. Recreating costs seconds against Neon's copy-on-write branching, and
# removes an entire class of confusing failure rather than the one instance of
# it that was noticed.
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
    # Delete any branch left by a previous run, so the ledger cannot survive
    # into this one. Failure here is ignored on purpose: the usual reason is
    # that there is nothing to delete.
    pnpm exec neonctl branches delete "$branch" \
      --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true

    pnpm exec neonctl branches create \
      --project-id "$NEON_PROJECT_ID" \
      --name "$branch" \
      --parent staging \
      --output json >&2
    pnpm exec neonctl connection-string "$branch" \
      --project-id "$NEON_PROJECT_ID" \
      --database-name marginsheet \
      --role-name neondb_owner
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
