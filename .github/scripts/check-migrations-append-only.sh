#!/usr/bin/env bash
# Migrations are append-only after merge (CLAUDE.md, ruled 16 August 2026).
#
# Once a migration file is on main its contents are frozen. Corrections go
# forward as a new migration, never as an edit.
#
# WHY THIS IS A JOB AND NOT A CONVENTION. An environment that has applied a
# migration will never apply it again, so an edit reaches only the databases
# that have not seen it yet. The result is two databases carrying IDENTICAL
# LEDGERS AND DIFFERENT SCHEMAS, and nothing reports a problem until something
# reads the column. That is worse than an error, because an error stops.
#
# It happened on 15 Aug 2026: 0014 was edited in place after merging, and CI
# reported a missing constraint that the file plainly declared, because the
# reused branch's ledger already said applied.
#
# Additions pass. Edits do not. Deletions do not either: a migration removed
# from the repository still exists in every ledger that applied it.

set -euo pipefail

DIR="packages/schema/migrations"
base="${1:-origin/main}"

git fetch --quiet origin main 2>/dev/null || true

if ! git rev-parse --verify --quiet "$base" >/dev/null; then
  echo "cannot resolve $base, so nothing can be compared against it" >&2
  exit 1
fi

changed=0

# Every migration file as it exists on main, compared byte for byte.
while IFS= read -r file; do
  [ -z "$file" ] && continue

  if ! git cat-file -e "$base:$file" 2>/dev/null; then
    continue  # not on main yet: this is an addition, which is allowed
  fi

  merged_hash="$(git rev-parse "$base:$file")"

  if [ ! -f "$file" ]; then
    echo "DELETED: $file" >&2
    echo "  It is merged, so every environment that applied it still carries it in its ledger." >&2
    changed=1
    continue
  fi

  current_hash="$(git hash-object "$file")"

  if [ "$merged_hash" != "$current_hash" ]; then
    echo "MODIFIED: $file" >&2
    changed=1
  fi
done < <(git ls-tree -r --name-only "$base" -- "$DIR" | grep '\.sql$' || true)

if [ "$changed" -ne 0 ]; then
  cat >&2 <<'MSG'

Migrations are append-only after merge (CLAUDE.md).

A merged migration has already been applied somewhere. Editing it changes only
the databases that have not run it yet, leaving two databases with identical
ledgers and different schemas. Nothing will report that as wrong.

Add a new migration that corrects the old one, and say in its header what it
corrects and why. See 0015_auth_method_text.sql for the shape.
MSG
  exit 1
fi

count="$(git ls-tree -r --name-only "$base" -- "$DIR" | grep -c '\.sql$' || true)"
echo "all $count merged migrations are byte-identical to $base"
