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
for name, service in envs[target].items():
    # EVERY ENTRY HAS THE SAME SHAPE: an origin that answers, and a path per
    # purpose. This branches on nothing. The previous version did
    # origin + '|' + target against values that had become objects, and threw
    # TypeError on dev and staging, which would have failed verification on the
    # very deploy that shipped the change.
    print(service['origin'] + service['paths']['health'] + '|' + target + '|' + name)
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
  probe="${entry%%|*}"
  rest="${entry#*|}"
  want_env="${rest%%|*}"
  service="${rest##*|}"
  echo "verifying $service at $probe"

  for ((i = 1; i <= attempts; i++)); do
    # Deliberately NOT curl -f: /health answers 503 when the database half
    # fails, and that body carries the reason. Discarding it would leave the
    # most useful failure message unread.
    body="$(curl -sS --max-time 15 "$probe" || echo '{}')"

    got_build="$(field "$body" build)"
    got_env="$(field "$body" environment)"
    got_ok="$(field "$body" database.ok)"
    got_migrations="$(field "$body" database.migrations)"

    # EVERY declared secret must be NON-EMPTY. wrangler never returns a value,
    # so secret-inventory can only prove a name exists: an empty
    # BETTER_AUTH_SECRET means sessions signed with an empty key while every
    # other check reports green. The Worker is the only thing that can see it.
    empty_secrets="$(printf '%s' "$body" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('UNREADABLE'); raise SystemExit
s = d.get('secrets')
if not isinstance(s, dict) or not s:
    print('NO_SECRETS_BLOCK'); raise SystemExit
print(','.join(sorted(k for k, v in s.items() if not v)))
" 2>/dev/null || echo UNREADABLE)"

    if [[ "$got_build" == "$expected" && "$got_env" == "$want_env" \
       && "$got_ok" == "true" && "$got_migrations" == "$want_migrations" \
       && -z "$empty_secrets" ]]; then
      echo "  ok: build=$got_build environment=$got_env database.ok=true migrations=$got_migrations, every declared secret non-empty"
      break
    fi

    if (( i == attempts )); then
      echo "  FAIL after $attempts attempts" >&2
      echo "  expected build=$expected environment=$want_env database.ok=true migrations=$want_migrations" >&2
      echo "  got      build=${got_build:-<none>} environment=${got_env:-<none>} database.ok=${got_ok:-<none>} migrations=${got_migrations:-<none>}" >&2
      echo "  RAW RESPONSE (trust this over the reading below): $body" >&2
      echo "  Likely causes, ILLUSTRATIVE and not exhaustive:" >&2
      if [[ "$got_build" == "$expected" && "$got_ok" != "true" ]]; then
        echo "  The right code is deployed but it cannot query its database." >&2
      elif [[ -n "$got_migrations" && "$got_migrations" != "$want_migrations" ]]; then
        echo "  Schema drift: this commit carries $want_migrations migrations, the database has $got_migrations." >&2
      elif [[ "$empty_secrets" == "NO_SECRETS_BLOCK" ]]; then
        echo "  This Worker reported no secrets block. Either it runs code older than this check, or the block was removed, in which case NOTHING is verifying that any secret is non-empty. That is not a pass." >&2
      elif [[ -n "$empty_secrets" && "$empty_secrets" != "UNREADABLE" ]]; then
        echo "  SECRETS PRESENT BUT EMPTY: $empty_secrets" >&2
        echo "  The names exist, so secret-inventory passes. The VALUES are empty strings." >&2
        echo "  An empty BETTER_AUTH_SECRET means sessions signed with an empty key." >&2
      fi
      exit 1
    fi
    sleep "$delay"
  done
done

# marginsheet-sync, reached through api's service binding because it has no
# public route of its own (M4 section 2a).
#
# WHY THIS BLOCK EXISTS. The sync Worker holds a production database credential
# and the key that decrypts every household's Plaid token, and until this was
# written NOTHING PROVED IT COULD USE EITHER. Its /health reported that the
# secrets were PRESENT, which is a different claim from "the Worker can connect",
# and the first reports green while the second is false. That is the 15 Aug
# empty-string incident with a better disguise: six Workers held connection
# strings that were the empty string and every environment reported healthy.
#
# SPLIT DELIBERATELY. Connection is proven here. DECRYPTION IS NOT, because
# nothing is encrypted yet, and a check that asserted the key "works" today
# would be asserting over an empty set. That half is owed at 4.2.2 and carried
# in docs/open-items.json rather than assumed.
api_origin="$(python3 -c "
import json, sys
print(json.load(open('config/environments.json'))[sys.argv[1]]['api']['origin'])
" "$target")"

echo "verifying marginsheet-sync via $api_origin/debug/sync-health"
for ((i = 1; i <= attempts; i++)); do
  body="$(curl -sS --max-time 15 "$api_origin/debug/sync-health" || echo '{}')"

  got_service="$(field "$body" service)"
  got_build="$(field "$body" build)"
  got_env="$(field "$body" environment)"
  got_ok="$(field "$body" database.ok)"
  got_migrations="$(field "$body" database.migrations)"
  got_key="$(field "$body" tokenKeyPresent)"

  # EVERY declared secret must be NON-EMPTY, not merely named. wrangler secret
  # list returns {name, type} and never a value, so secret-inventory can only
  # prove a name exists: a secret set to the empty string passes it perfectly.
  # That is the 15 Aug 2026 incident exactly, and the Worker is the only thing
  # that can see the value, so the Worker is asked.
  empty_secrets="$(printf '%s' "$body" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('UNREADABLE'); raise SystemExit
s = d.get('secrets')
if not isinstance(s, dict) or not s:
    print('NO_SECRETS_BLOCK'); raise SystemExit
print(','.join(sorted(k for k, v in s.items() if not v)))
" 2>/dev/null || echo UNREADABLE)"

  if [[ "$got_service" == "marginsheet-sync" && "$got_build" == "$expected" \
     && "$got_env" == "$target" && "$got_ok" == "true" \
     && "$got_migrations" == "$want_migrations" && "$got_key" == "true" \
     && -z "$empty_secrets" ]]; then
    echo "  ok: sync build=$got_build database.ok=true migrations=$got_migrations, every declared secret non-empty"
    break
  fi

  if (( i == attempts )); then
    echo "  FAIL after $attempts attempts" >&2
    echo "  expected service=marginsheet-sync build=$expected environment=$target database.ok=true migrations=$want_migrations tokenKeyPresent=true" >&2
    echo "  got      service=${got_service:-<none>} build=${got_build:-<none>} environment=${got_env:-<none>} database.ok=${got_ok:-<none>} migrations=${got_migrations:-<none>} tokenKeyPresent=${got_key:-<none>}" >&2
    # RAW SIGNAL FIRST, INTERPRETATION SECOND, and the interpretation is
    # labelled illustrative rather than exhaustive. The first version of the
    # list below named three causes for a database failure and the first real
    # failure was a fourth: connected fine, refused a table. A reader trusting
    # that list would have gone looking at the credential, which was the one
    # thing that was fine, while the raw error said "permission denied for
    # table households" and named the problem exactly.
    echo "  RAW RESPONSE (trust this over the reading below): $body" >&2
    echo "  Likely causes, ILLUSTRATIVE and not exhaustive:" >&2
    if [[ -z "$got_service" ]]; then
      echo "  Could not reach sync through the binding at all. Either api has no SYNC binding in this environment, or the sync Worker is not deployed." >&2
    elif [[ "$got_ok" != "true" ]]; then
      echo "  The sync Worker is deployed and CANNOT QUERY ITS DATABASE." >&2
      # Four causes, not three. "permission denied" means the role CONNECTED
      # fine and lacks privilege on the table the probe reads, which is a
      # different fix from a bad credential and was the actual cause the first
      # time this check ran: the probe read households, a table migration 0023
      # deliberately took away from marginsheet_sync.
      case "$body" in
        *"permission denied"*)
          echo "  It CONNECTED and was refused a table. The credential is fine; either the probe reads a table the sync role should not have, or 0023 revoked something the pipeline needs." >&2 ;;
        *)
          echo "  Its NEON_DATABASE_URL is empty, wrong, or issued for a role that cannot connect." >&2 ;;
      esac
    elif [[ "$got_key" != "true" ]]; then
      echo "  The sync Worker has no TOKEN_ENCRYPTION_KEY. It cannot decrypt any Plaid token." >&2
    elif [[ "$empty_secrets" == "NO_SECRETS_BLOCK" ]]; then
      echo "  sync reported no secrets block. Either it is running code older than this check, or the block was removed, in which case NOTHING is verifying that any secret is non-empty." >&2
    elif [[ -n "$empty_secrets" && "$empty_secrets" != "UNREADABLE" ]]; then
      echo "  SECRETS PRESENT BUT EMPTY: $empty_secrets" >&2
      echo "  The names exist, so secret-inventory passes. The VALUES are empty strings." >&2
      echo "  wrangler secret put reports success for an empty payload, which is how six" >&2
      echo "  connection strings were empty on 15 Aug 2026 while everything reported healthy." >&2
    elif [[ "$got_migrations" != "$want_migrations" ]]; then
      echo "  Schema drift: this commit carries $want_migrations migrations, sync sees $got_migrations." >&2
    fi
    exit 1
  fi
  sleep "$delay"
done

# THE DEPLOYED ROUND TRIP, using the key sync actually holds.
#
# The unit tests supply their own key, which proves the algorithm and says
# nothing about the value in the secret store: malformed, truncated and
# wrong-length keys all pass a round trip against a key the test generated
# itself. This is the half that could only ever be proven here.
#
# tamperRejected is the one that proves the AUTHENTICATION TAG is verified on
# the deployed code path. A wrong-key rejection alone does not: a wrong key
# could be refused for reasons unrelated to authentication. One flipped byte of
# ciphertext under the CORRECT key is rejected by nothing else.
echo "verifying sync crypto via $api_origin/debug/sync-crypto"
for ((i = 1; i <= attempts; i++)); do
  body="$(curl -sS --max-time 15 "$api_origin/debug/sync-crypto" || echo '{}')"
  got_round="$(field "$body" roundTrip)"
  got_wrong="$(field "$body" wrongKeyRejected)"
  got_tamper="$(field "$body" tamperRejected)"

  if [[ "$got_round" == "true" && "$got_wrong" == "true" && "$got_tamper" == "true" ]]; then
    echo "  ok: roundTrip=true wrongKeyRejected=true tamperRejected=true"
    break
  fi

  if (( i == attempts )); then
    echo "  FAIL after $attempts attempts" >&2
    echo "  RAW RESPONSE (trust this over the reading below): $body" >&2
    echo "  Likely causes, ILLUSTRATIVE and not exhaustive:" >&2
    if [[ "$got_round" != "true" ]]; then
      echo "  The key sync holds cannot encrypt and decrypt its own output. It is present but unusable: wrong length, not base64, or truncated in the store." >&2
    elif [[ "$got_tamper" != "true" ]]; then
      echo "  A TAMPERED CIPHERTEXT DECRYPTED. The authentication tag is not being verified, and a caller could be handed corrupted bytes as an access token." >&2
    elif [[ "$got_wrong" != "true" ]]; then
      echo "  Decryption under a wrong key succeeded, which should be impossible." >&2
    fi
    exit 1
  fi
  sleep "$delay"
done

echo "all $target endpoints serve $expected against a schema of $want_migrations migrations"
