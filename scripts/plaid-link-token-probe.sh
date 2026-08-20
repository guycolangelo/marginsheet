#!/bin/zsh
# Reproduces the /link/token/create call the sync Worker makes, so Plaid's full
# error_message can be read. The Worker's PlaidError published only a summary
# until 20 Aug 2026, and INVALID_FIELD names the offending field in
# error_message and nowhere else.
#
# IT REFUSES RATHER THAN REPORTS WHEN A VALUE IS EMPTY, and that is the whole
# reason this is a script instead of a pasted command line. The first attempt
# was a one-liner using `read -p`, which is BASH syntax: in zsh the variables
# were never set, the request went out with empty credentials, and Plaid
# answered MISSING_FIELDS about client_id and secret.
#
# THAT IS THE WRONG-ANSWER-WITH-A-PLAUSIBLE-EXTERNAL-CAUSE SHAPE, inside a
# diagnostic written to avoid exactly it: an empty credential produced an error
# NAMING the credential, and telling that apart from wrong keys required knowing
# about the zsh quirk. An investigation would have gone to the Plaid dashboard.
#
# The identical failure hit scripts/verify-decoupling-probe.sh on 15 Aug 2026
# and was fixed there, with the reason recorded in a comment. THE FIX EXISTED
# AND WAS NOT APPLIED HERE, which is the sweep-for-the-pattern rule: a fix
# written where a defect was noticed is not a fix applied where it lives.
#
# Credentials are prompted rather than taken from the environment, so nothing
# survives the run or reaches the shell history.
set -uo pipefail

fail() { printf '\nREFUSING: %s\n' "$1" >&2; exit 1; }

# printf plus `read -rs` behaves identically in bash and zsh. `read -p` does
# not. Copied deliberately from verify-decoupling-probe.sh rather than
# rewritten, because rewriting is how the quirk got back in.
prompt_secret() {
  printf '%s' "$2" >&2
  IFS= read -rs "$1"
  printf '\n' >&2
}

BASE="${PLAID_BASE_URL:-https://production.plaid.com}"
REDIRECT="${PLAID_REDIRECT_URI:-https://api.marginsheet.com/plaid/oauth-return}"

# VARIANT lets the two candidate fields be isolated in separate runs:
#   full        exactly what the Worker sends
#   no-redirect drops redirect_uri
#   no-consent  drops additional_consented_products
VARIANT="${1:-full}"

prompt_secret PLAID_CLIENT_ID 'PLAID_CLIENT_ID: '
prompt_secret PLAID_SECRET    'PLAID_SECRET: '

# BEFORE THE REQUEST IS SPENT. An empty value here is a shell problem, and
# sending it produces an error about credentials that is indistinguishable from
# a genuine credential problem.
[ -n "${PLAID_CLIENT_ID:-}" ] || fail "client id is empty. Nothing was sent."
[ -n "${PLAID_SECRET:-}" ]    || fail "secret is empty. Nothing was sent."
[ ${#PLAID_CLIENT_ID} -ge 20 ] || fail "client id is ${#PLAID_CLIENT_ID} characters, which is too short to be real. Nothing was sent."
[ ${#PLAID_SECRET} -ge 20 ]    || fail "secret is ${#PLAID_SECRET} characters, which is too short to be real. Nothing was sent."

case "$VARIANT" in
  full)        EXTRA=', "redirect_uri": "'"$REDIRECT"'", "additional_consented_products": ["liabilities"]' ;;
  no-redirect) EXTRA=', "additional_consented_products": ["liabilities"]' ;;
  no-consent)  EXTRA=', "redirect_uri": "'"$REDIRECT"'"' ;;
  *) fail "unknown variant '$VARIANT'. Use full, no-redirect, or no-consent." ;;
esac

printf 'probing %s  variant=%s  redirect=%s\n\n' "$BASE" "$VARIANT" "$REDIRECT" >&2

body='{"client_id":"'"$PLAID_CLIENT_ID"'","secret":"'"$PLAID_SECRET"'","user":{"client_user_id":"probe"},"client_name":"MarginSheet","products":["transactions"],"country_codes":["US"],"language":"en"'"$EXTRA"'}'

response="$(curl -sS -X POST "$BASE/link/token/create" \
  -H 'content-type: application/json' \
  -d "$body")" || fail "curl could not reach Plaid."

# The whole point: print error_message, which is where INVALID_FIELD names the
# field. The link token itself is truncated, because it is a credential and the
# probe's job is the error rather than the success.
printf '%s' "$response" | python3 -c '
import json, sys
try:
    b = json.load(sys.stdin)
except Exception:
    print("UNPARSEABLE RESPONSE, printed raw:", file=sys.stderr)
    sys.exit(2)
if "link_token" in b:
    print("SUCCESS. This variant is accepted by Plaid.")
    print("  link_token:", b["link_token"][:12] + "... (truncated: it is a credential)")
    print("  expiration:", b.get("expiration"))
else:
    print("REFUSED by Plaid:")
    for k in ("error_type", "error_code", "error_message", "display_message", "request_id"):
        if b.get(k) is not None:
            print(f"  {k}: {b[k]}")
    print()
    print("  error_message is the line that names the offending field.")
'
