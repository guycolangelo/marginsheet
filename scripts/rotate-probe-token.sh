#!/usr/bin/env bash
# Rotate DEBUG_PROBE_TOKEN everywhere it belongs, in one pass.
#
# WHY A ROTATION RATHER THAN A RETRIEVAL (Guy, 21 Aug 2026). The token already
# lives in GitHub Actions secrets and in nine Worker/environment stores, and
# NEITHER CAN BE READ BACK. So the sync Worker's build SHA has been readable
# only by whoever set the value and still had it, which in practice means never
# read: on 21 Aug the probe was tried by hand for the first time and returned a
# 404 that could not be distinguished from a missing route.
#
# A TENTH STORE WOULD BE A TENTH THING TO KEEP IN SYNC AND A TENTH THING TO
# LEAK. Rotating instead makes the value retrievable from where Guy keeps
# everything else, and solves "someone who already set it and still has it" by
# making him that person deliberately rather than by accident.
#
# THE VALUE IS NEVER DISPLAYED. Generated here, piped to each sink, and gone
# when the process exits. Same rule as TOKEN_ENCRYPTION_KEY.
#
# A PIPE CARRIES A FAILURE AS AN EMPTY PAYLOAD, which is indistinguishable from
# a successful empty result unless something checks. On 15 Aug 2026 exactly that
# stored the empty string in six secrets and reported success for every one. So
# this validates the generated value before using it, and refuses rather than
# writing an empty secret anywhere.
#
# ORDER IS DELIBERATE AND FAILS IN THE LOUD DIRECTION.
#   1. the password manager, FIRST, because a value rotated everywhere and
#      captured nowhere is worse than not rotating: the probe becomes
#      permanently unreadable and that is the state this script exists to end.
#   2. GitHub Actions, so CI has it before any Worker diverges.
#   3. the Workers, derived from config/worker-secrets.json.
# A partial Worker pass leaves CI holding the new value and some Workers the
# old, so verify-deploy fails on those with "no response". Loud, not silent.

set -euo pipefail
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# THE SINK IS REQUIRED AND THE SCRIPT REFUSES WITHOUT IT. A rotation that
# silently skips the capture step produces exactly the condition it was written
# to fix, and it would look like success. Set it to whatever reads a secret on
# stdin in your password manager, for example:
#
#   PROBE_TOKEN_SINK='op item edit "MarginSheet DEBUG_PROBE_TOKEN" password=-'
#
# It is not hardcoded because nobody here knows which manager you use, and
# guessing one would put the value through a command that might not be it.
: "${PROBE_TOKEN_SINK:?refusing: set PROBE_TOKEN_SINK to a command that reads the value on stdin. A rotation that captures the value nowhere makes the probe permanently unreadable, which is the condition this script exists to end.}"

for tool in gh openssl python3; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

# The pairs that DECLARE this secret, read from the declaration rather than
# listed here. Two hand-written statements of one requirement drift by default,
# and a pair added to the declaration and forgotten here would silently keep an
# old token and 404 forever.
pairs="$(python3 -c "
import json
d = json.load(open('config/worker-secrets.json'))['workers']
for worker, envs in d.items():
    for env, secrets in envs.items():
        if 'DEBUG_PROBE_TOKEN' in secrets:
            print(worker, env)
")"
[ -n "$pairs" ] || { echo "no Worker declares DEBUG_PROBE_TOKEN; refusing" >&2; exit 1; }

echo "will rotate DEBUG_PROBE_TOKEN for:"
printf '  %s\n' "$pairs" | sed 's/^  //;s/^/  /'
echo "  github actions (repository secret)"
echo "  your password manager, via PROBE_TOKEN_SINK"
printf 'proceed? [y/N] '
read -r answer
[ "$answer" = "y" ] || { echo "aborted, nothing changed"; exit 1; }

value="$(openssl rand -base64 32 | tr -d '\n')"
# NON-EMPTY AND LONG ENOUGH, checked before anything consumes it. openssl
# failing mid-pipe under `set -o pipefail` should stop us here, and this is the
# assertion that makes that guarantee rather than assuming it.
[ "${#value}" -ge 40 ] || { echo "refusing: generated value is implausibly short" >&2; exit 1; }

printf '%s' "$value" | eval "$PROBE_TOKEN_SINK" \
  || { echo "PROBE_TOKEN_SINK failed; NOTHING was rotated" >&2; exit 1; }
echo "captured in the password manager"

printf '%s' "$value" | gh secret set DEBUG_PROBE_TOKEN
echo "set: github actions"

while read -r worker env; do
  [ -n "$worker" ] || continue
  name="marginsheet-${worker}"
  [ "$worker" = "api" ] && name="marginsheet-api"
  if [ "$env" = "production" ]; then
    printf '%s' "$value" | ./scripts/wrangler secret put DEBUG_PROBE_TOKEN --name "$name"
  else
    printf '%s' "$value" | ./scripts/wrangler secret put DEBUG_PROBE_TOKEN --name "${name}-${env}"
  fi
  echo "set: ${name} (${env})"
done <<< "$pairs"

cat <<'DONE'

Rotated. The value was never printed.

VERIFY, and this is the point of the exercise rather than a formality:

  curl -sS https://api.marginsheet.com/debug/sync-health \
    -H "x-probe-token: $(YOUR_MANAGER_READ_COMMAND)" | jq '{service, build}'

A 404 now means a WRONG TOKEN or a missing route and still cannot tell you
which, by design. A JSON body means the sync Worker's build SHA is readable by
hand for the first time.
DONE
