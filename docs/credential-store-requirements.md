# Credential store: requirements

**Written 21 August 2026 for Guy to rule on. This is a requirements document, not a recommendation. No product is named as an answer.**

It exists because `rotate-probe-token.sh` was written correctly and has nowhere to write, and because `secrets-custody.md` says values are "pasted by hand and never displayed", which is only true if they exist somewhere retrievable. **Today several do not.**

---

## 1. What is actually held

**11 distinct secret names across 9 Worker/environment pairs.** Neither Cloudflare nor GitHub Actions will read a value back.

| Secret | If the only copy is lost | Recoverable? |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | Every stored Plaid access token becomes undecryptable. Every Item must be re-linked, which is a household-visible re-consent. | **No.** This is the only one. |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Re-issue from the Plaid dashboard. | Yes |
| `STRIPE_SECRET` | Roll the key from the Stripe dashboard. | Yes |
| `NEON_DATABASE_URL` | Re-mint via `scripts/sync-db-url.mts` / `app-db-url.mts`. | Yes |
| `BETTER_AUTH_SECRET` | Generate a new one. Every existing session is invalidated and every member signs in again. | Yes, with user-visible cost |
| `ANTHROPIC_API_KEY`, `POSTMARK_TOKEN` | Re-issue from the vendor. | Yes |
| `DEBUG_PROBE_TOKEN` | Rotate. | Yes |
| `AUTH_FROM_EMAIL`, `BETTER_AUTH_URL` | Not secret; configuration. | n/a |

**One correction to the framing this document was requested under.** Stripe live keys at M7 were described as *"less forgiving"* than `TOKEN_ENCRYPTION_KEY`. **They are more forgiving:** Stripe secret keys roll from the dashboard and the webhook signing secret is re-readable there. **`TOKEN_ENCRYPTION_KEY` is the only value in this system whose loss destroys data rather than requiring a re-issue**, and it is the one already held in exactly one place.

**So the case for a store is not primarily about loss.** Nine of eleven are re-issuable. It is about the three things below.

---

## 2. What the store has to do for this project specifically

**R1. Read a value to stdout, non-interactively, exit non-zero on failure.**
The blocking need tonight was reading one value to put in one header. Any store that requires a GUI copy-paste does not satisfy this, because a value that reaches a clipboard has been displayed.

**R2. Accept a value on stdin, never as an argument.**
`rotate-probe-token.sh` pipes. A store whose CLI takes the value as `--password=X` puts it in the process listing, which is the thing every script here avoids.

**R3. Be readable by Guy alone, from his machine, without a second device in the loop for routine reads.**
A store that prompts for a hardware key on every read will be worked around, and a worked-around store is worse than none because it produces a plaintext copy somewhere unrecorded.

**R4. Survive the loss of that machine.**
Otherwise it is a cache, not a store, and the recovery story is unchanged.

**R5. Not become a source of truth.**
Cloudflare and GitHub remain authoritative for what the running system uses. **The store is a second copy for human retrieval**, and this must stay explicit: two copies of one value drift by default, and the check that they agree does not exist and cannot easily be built, because neither authoritative store reads back.

**R6. Cost nothing to add a secret to.**
11 today, and every module boundary adds more. A store with per-item friction gets used for the important ones and skipped for the rest, which is the state that produced tonight.

---

## 3. What the script needs, concretely

Two commands, named in one environment variable each, so nothing is hardcoded:

```
PROBE_TOKEN_SINK   reads the value on STDIN, writes it to the store, exits non-zero on failure
<read command>     writes the value to STDOUT, exits non-zero on failure
```

**That is the entire interface.** Any store satisfying R1 and R2 can be wired in by setting two variables, and `rotate-probe-token.sh` needs no change beyond documenting the read command in `secrets-custody.md`.

---

## 4. The options, and what breaks in each

### Option A: no store. **This is the live configuration and it is a choice, not the absence of one.**

**What works.** Values exist in exactly one authoritative place each. Nothing to keep in sync, nothing extra to leak, and the blast radius of any single compromise is one system. **`secrets-custody.md`'s claim that values touch nothing else is literally true.**

**What breaks.**
- **A value cannot be used by hand.** Tonight's case: reading a Worker's SHA required a credential nobody could retrieve. That specific need turned out to have a better answer, but the general one recurs whenever anything must be done outside CI.
- **A value cannot be verified.** Nothing can answer "is production's `PLAID_SECRET` the one I think it is". The `secret-inventory` check proves a name exists; `verify-deploy` proves the Worker considers it non-empty. **Neither can compare it to an intended value, and under Option A no intended value exists to compare to.**
- **`TOKEN_ENCRYPTION_KEY` has one copy and its loss is unrecoverable.** Accepted deliberately on 17 August, when it protected zero Items. **It now protects three Items and will protect more**, and the cost of that decision rises monotonically while nothing prompts a re-examination.
- **Rotation scripts have nowhere to write**, so rotation means generating a value that immediately becomes unretrievable.

### Option B: a password manager with a CLI

**What works.** Satisfies R1 through R6 if the CLI reads stdin and writes stdout. Survives machine loss. Familiar failure modes.

**What breaks.**
- **A tenth store**, and R5 becomes a discipline rather than a mechanism. Nothing can check that the store's copy matches Cloudflare's, because Cloudflare will not say.
- **Vendor dependency** on something outside the stack, with its own auth and its own outage surface.
- **The read command becomes a prerequisite for operational work**, which must be recorded in `secrets-custody.md` or it recreates tonight exactly.

### Option C: an encrypted file in the repository (SOPS, age, git-crypt)

**What works.** No vendor. Survives machine loss by being in git. Diffable, reviewable, and **the only option where a check could compare the intended value against what a Worker reports**, if a Worker ever exposed a hash rather than a value.

**What breaks.**
- **Ciphertext for production credentials in a repository**, which is a different risk posture and needs a ruling of its own rather than a preference.
- **The decryption key becomes the thing with no store**, recursively. It is one key rather than eleven, which is a real improvement, and it is the same problem one level up.
- Key distribution across machines is the operational cost, and there is currently one machine.

### Option D: macOS Keychain

**What works.** No vendor, no new dependency, `security find-generic-password -w` satisfies R1 and stdin-writing satisfies R2.

**What breaks.**
- **Does not survive machine loss** unless iCloud Keychain is enabled, which makes it Option B with a different vendor.
- Bound to one operating system, which is fine while there is one machine and a constraint the day there is not.

---

## 5. What this document does not decide

**Which option.** That is Guy's ruling.

**Whether `TOKEN_ENCRYPTION_KEY` should be duplicated at all.** It is the only value where a store changes the outcome rather than the convenience, and it is also the value where a second copy is most dangerous. **Those pull in opposite directions and the tension is the decision**, not a detail of it.

**Whether the store should hold production credentials or only the ones needed for hand operations.** A store holding `DEBUG_PROBE_TOKEN` and nothing else satisfies tonight's need and almost none of section 1.
