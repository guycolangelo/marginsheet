#!/usr/bin/env bash
# The live Twilio Verify decoupling probe (M3).
#
# WHAT IT PROVES: identity-onboarding-spec §§1 and 7 require that phone is a
# security primitive and NOT an authentication factor. A successful phone
# verification must return a verdict and nothing that could be mistaken for an
# authenticated session. If Verify ever hands back a token, phone has quietly
# become an auth factor and M3's design premise is wrong.
#
# WHY IT IS A SCRIPT AND NOT A ONE-LINER. The first version was an inline
# pipeline. It used `read -p`, which is bash syntax; the target shell was zsh,
# where -p means "read from a coprocess". Every variable stayed unset, the URL
# collapsed to /v2/Services//Verifications, the credentials sent were ":", and
# Twilio answered 404. The decoupling assertion then scanned that 404 body,
# found no session-shaped field, and printed "DECOUPLING: HOLDS".
#
# It reported success while proving nothing, which is the exact failure the
# constitution now names: if the thing this guards were completely broken,
# would this go red? It did not. So this script is built so it cannot:
#
#   - every HTTP step asserts its own status code and payload before the next
#     step is allowed to run, and a failure exits non-zero immediately;
#   - the decoupling verdict is UNREACHABLE unless the check returned
#     status=approved, so an error body can never be mistaken for a pass;
#   - the credentials are checked for non-emptiness before any request.
#
# CREDENTIAL CUSTODY: values are read interactively into this process, are
# never echoed, never written to disk, never placed in the shell history, and
# never exported to a child beyond curl. Per the deferral ledger these are
# live production Twilio credentials, and this probe is the only place they
# appear outside production. It runs on Guy's machine, never in dev, never in
# CI.
set -uo pipefail

fail() { printf '\nFAILED: %s\n' "$1" >&2; exit 1; }

# --- credentials ------------------------------------------------------------
# Prompted rather than taken from the environment, so nothing survives the run.
# printf plus `read -rs` behaves identically in bash and zsh. `read -p` does
# not, which is what broke the first attempt.
prompt_secret() {
  printf '%s' "$2" >&2
  IFS= read -rs "$1"
  printf '\n' >&2
}

prompt_secret TWILIO_ACCOUNT_SID      'Twilio Account SID:     '
prompt_secret TWILIO_AUTH_TOKEN       'Twilio Auth token:      '
prompt_secret TWILIO_VERIFY_SERVICE_SID 'Verify Service SID:     '
printf 'Your phone (+1...):     ' >&2
IFS= read -r PROBE_PHONE

[[ -n "${TWILIO_ACCOUNT_SID:-}" ]]       || fail "Account SID is empty. Nothing was sent."
[[ -n "${TWILIO_AUTH_TOKEN:-}" ]]        || fail "Auth token is empty. Nothing was sent."
[[ -n "${TWILIO_VERIFY_SERVICE_SID:-}" ]] || fail "Verify Service SID is empty. Nothing was sent."
[[ -n "${PROBE_PHONE:-}" ]]              || fail "Phone number is empty. Nothing was sent."

# Shape checks before spending a real SMS. These catch a paste that grabbed the
# wrong value, which a 404 would otherwise report as an ambiguous failure.
[[ "$TWILIO_ACCOUNT_SID" == AC* ]]        || fail "Account SID does not start with AC."
[[ "$TWILIO_VERIFY_SERVICE_SID" == VA* ]] || fail "Verify Service SID does not start with VA."
[[ "$PROBE_PHONE" == +* ]]                || fail "Phone must be E.164, starting with +."

BASE="https://verify.twilio.com/v2/Services/$TWILIO_VERIFY_SERVICE_SID"

# --- step 1: send the code --------------------------------------------------
printf '\nSending a verification SMS...\n'
start_body="$(curl -s -w '\n%{http_code}' -X POST "$BASE/Verifications" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  --data-urlencode "To=$PROBE_PHONE" \
  --data-urlencode "Channel=sms")" || fail "curl could not reach Twilio."

start_code="$(printf '%s' "$start_body" | tail -1)"
start_json="$(printf '%s' "$start_body" | sed '$d')"

if [[ "$start_code" != "201" ]]; then
  printf 'Twilio answered HTTP %s\n' "$start_code" >&2
  printf '%s\n' "$start_json" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print("  twilio code:", d.get("code"), "message:", d.get("message"), file=sys.stderr)
except Exception:
    print("  unparseable body", file=sys.stderr)' 2>&1 >/dev/null || true
  fail "Verification was not created. No code was sent, so nothing can be proven."
fi

printf '%s' "$start_json" | python3 -c 'import json,sys
d = json.load(sys.stdin)
if d.get("status") != "pending":
    print("status was", d.get("status"), "not pending", file=sys.stderr); sys.exit(1)
print("  created: status=%s channel=%s" % (d.get("status"), d.get("channel")))' \
  || fail "Verification did not enter the pending state."

# --- step 2: check the code -------------------------------------------------
printf '\nCode from SMS: ' >&2
IFS= read -r CODE
[[ -n "${CODE:-}" ]] || fail "No code entered."

check_body="$(curl -s -w '\n%{http_code}' -X POST "$BASE/VerificationCheck" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  --data-urlencode "To=$PROBE_PHONE" \
  --data-urlencode "Code=$CODE")" || fail "curl could not reach Twilio."

check_code="$(printf '%s' "$check_body" | tail -1)"
check_json="$(printf '%s' "$check_body" | sed '$d')"

[[ "$check_code" == "200" ]] || fail "VerificationCheck answered HTTP $check_code, not 200. The decoupling verdict is not reachable from an error response."

# --- step 3: the verdict ----------------------------------------------------
# Reachable ONLY after a 200 with status=approved. This ordering is the whole
# point: the first version of this probe reported HOLDS off a 404 body.
printf '%s' "$check_json" | python3 -c '
import json, sys

d = json.load(sys.stdin)
status, valid = d.get("status"), d.get("valid")
print("  check: status=%s valid=%s" % (status, valid))

if status != "approved" or valid is not True:
    print("\nFAILED: the code was not approved, so the decoupling claim is not earned.", file=sys.stderr)
    sys.exit(1)

SESSIONISH = ("token", "session", "jwt", "auth", "secret", "key", "credential", "bearer")
leaks = sorted(k for k in d if any(t in k.lower() for t in SESSIONISH))

print()
if leaks:
    print("DECOUPLING: BROKEN. An approved verification returned %s." % leaks)
    print("Phone has become an authentication factor. M3 §§1 and 7 do not hold.")
    sys.exit(1)

print("DECOUPLING: HOLDS.")
print("An APPROVED verification returned a verdict and no session-shaped field.")
print("Phone is a security primitive. It authenticates nobody.")
' || exit 1

printf '\nCredentials were never written to disk and leave with this process.\n'
