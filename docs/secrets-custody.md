# Secrets custody

## Updated 15 August 2026 (Task 0.3). This document lists what exists and where it lives. It never contains values.

## Stores

1. **Wrangler secrets**: runtime, per service, per environment. Set by Guy in his terminal via `wrangler secret put` (interactive prompt or a local pipe); values touch nothing else.
2. **GitHub Actions secrets**: CI only. Deploy token, Neon API key, and the isolation suite's dev/staging credential sets.

## Inventory and deferral ledger

Deferral ruling (Guy, 15 Aug 2026): production/live credentials land with the module that first uses them, never earlier. Tonight is sandbox/test credentials, encryption keys, DB URLs, and CI secrets only.

| Secret | Service | dev / staging | production |
|---|---|---|---|
| `NEON_DATABASE_URL` | api + conversation | reissued 15 Aug 2026 for `marginsheet_app` (branch-matched: dev, staging) | reissued 15 Aug 2026 for `marginsheet_app` (main branch) |
| `NEON_DATABASE_URL` | **sync** | **M4 task 4.2**, for `marginsheet_sync`. `scripts/sync-db-url.mts` mints it and REFUSES when the role holds a table 0023 does not name, because issuing the credential is the moment an over-broad grant stops being theoretical | **M4 task 4.2** |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | **sync** (was: api) | sandbox, set 0.3 | **M4, at task 4.5b.** Earlier than the deferral ledger's usual shape, ruled 17 Aug 2026: pending to posted is unconstructible in Sandbox, so the founder household's real institutions are the only place categorization-spec §10 is exercised, and that has to happen while M4 can still absorb a fix |
| `STRIPE_SECRET` | api | test mode, set 0.3 | **deferred to M7** |
| `STRIPE_WEBHOOK_SECRET` | api | **deferred to M7**: minted with the webhook endpoint, test and live | **deferred to M7** |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | api + conversation | **deferred to M3** (unset 15 Aug ruling; the isolation Twilio check skips while absent and re-arms when set) | **deferred to M3**; exercised live 15 Aug 2026 by the decoupling probe, prompted into one process on Guy's machine and stored nowhere |
| `TWILIO_VERIFY_SERVICE_SID` | api | **deferred to M3** (inert without real credentials) | **deferred to M3** |
| `POSTMARK_TOKEN` | conversation | sandbox server token, set 0.3 | **deferred to M3** |
| `ANTHROPIC_API_KEY` | conversation | non-production key, set 0.3 (0.5's smoke call needs it) | **deferred to the first production deploy that calls a model** |
| `ANTHROPIC_API_KEY` | api | **deferred to M5** (escalation calls: Haiku to Sonnet parsing chain) | **deferred to M5** |
| `TOKEN_ENCRYPTION_KEY` | **sync** (currently held by api) | set 0.3, distinct per environment | set 0.3, distinct |

GitHub Actions store: `CLOUDFLARE_API_TOKEN` (scoped API token, not a personal OAuth token), `NEON_API_KEY`, `ANTHROPIC_API_KEY` (non-production), and `DEV_` / `STAGING_` prefixed sets for the isolation suite (Plaid sandbox pair, Stripe test key; Twilio pair joins at M3; DB URLs derived from `NEON_API_KEY` at run time).

## TOKEN_ENCRYPTION_KEY custody

- AES-GCM key material for Plaid access tokens (plaid-pipeline invariant 7).
- Generated on Guy's machine by `openssl rand -base64 32`, piped directly into `wrangler secret put`. Displayed nowhere, stored nowhere else. One key per environment, all distinct.
- The only copy lives in the Cloudflare secret store for its environment. Loss means re-linking Plaid Items, not data loss.
- Rotation requires decrypt-and-re-encrypt of stored tokens. That path is built in M4; until then rotation equals re-linking.
- **The key is currently on `api`, and the third-Worker ruling says it should not be** (M4 §2a, 17 Aug 2026). The whole argument for a separate `marginsheet-sync` deployable is that the token-reading surface has no public routes, and a key sitting on the deployable that serves household requests makes the role split cosmetic. **4.2 moves it and removes it from `api`**, and removing it is the half that is easy to skip: a key that is merely also present somewhere else is not a boundary.

## Database roles (the other half of the token control)

Created in migration `0002_banking_sync`, deliberately not in the later RLS migration: the Plaid token needs a **column** privilege, which is independent of row-level security, and waiting would leave the column readable in the meantime.

| Role | Reads `plaid_items.access_token_ciphertext` | Purpose |
|---|---|---|
| `marginsheet_sync` | Yes, exclusively | The Plaid sync worker. The only place `TOKEN_ENCRYPTION_KEY` is used to decrypt. |
| `marginsheet_app` | **No**, by column GRANT | The API and app role. Cannot read the token on any row; `SELECT *` errors rather than returning it. |

The column grant enumerates permitted columns rather than granting all-minus-one, so a column added later is not silently readable by the app role. The invariant-2 test asserts the block by assuming the app role and attempting the read, not by reading the policy.

Scope, verified empirically 15 Aug 2026: roles created by SQL on a Neon branch are branch-local. A probe branch's role was absent from staging and production and left no residue after deletion, so CI's ephemeral-branch teardown leaks nothing at the project level. Neon's control plane lists these roles per branch, which makes them auditable. The author of the RLS migration attaches row policies to **these** roles; parallel roles are how a policy ends up protecting a role nothing connects as.

## The /debug/db-identity endpoint (deliberate, in production)

Both Workers expose `GET /debug/db-identity`, which returns exactly two values: the database role the Worker authenticates as, and whether that role holds `BYPASSRLS`. It exists in **production as well as dev and staging**, deliberately (ruled 15 Aug 2026).

**Why it exists.** Wrangler secrets are write-only, so CI cannot read `NEON_DATABASE_URL` to confirm which role a Worker connects as. Asking the Worker is the only way to check the deployed reality rather than a config file. Checking dev and staging and trusting production by inference is precisely the reasoning that produced the finding this endpoint prevents: every Worker was connecting as `neondb_owner`, which holds `BYPASSRLS` and reads past every `household_isolation` policy, and nothing caught it because nothing asked.

**What it must never return:** a connection string, a host, a password, a database name, or anything else credential-shaped. A role name is not a secret; it is the thing being audited. Adding a field that identifies the connection rather than the role turns an audit endpoint into a disclosure.

**This is not a debug leftover.** It is the enforcement half of the `rls-not-forced` entry in the invariant manifest, and the `db-identity` CI job blocks merges on it. Removing the endpoint removes the check.

**It is asserted by a blocking job, not by the isolation suite.** The isolation suite derives its own `NEON_DATABASE_URL` from `neonctl` as `neondb_owner` at job time, so it validates a credential no Worker uses and never notices what the Workers actually hold.

## The marginsheet-ci Cloudflare token: minimal permissions, established empirically

Trimmed 16 August 2026, one permission at a time, with the `edge-rules` CI job re-run between each change as the oracle. Recorded so the set is not re-accumulated by the next person guessing.

| Permission | Scope | What needs it |
|---|---|---|
| Workers Scripts, Edit | account | `wrangler deploy` uploading either Worker |
| Workers Routes, Edit | zone: marginsheet.com | reconciling `api.marginsheet.com`. Its absence broke every production deploy on 16 Aug 2026, after the upload had already shipped |
| Zone WAF, **Read** | zone: marginsheet.com | the `edge-rules` job reading the `http_ratelimit` ruleset |

Zone Resources is scoped to **marginsheet.com specifically**, not all zones. This token only ever touches one.

### What was removed, and what it cost to learn

Three permissions were attached during this session and none of them did anything:

- **Firewall Services, Read.** Added twice on the assistant's advice, on the belief that rate limiting rules still sit behind the old firewall permission. They do not; they moved into the rulesets engine. It failed on its own and was confirmed dead weight by removal.
- **Config Rules, Edit.** Governs the `http_config_settings` phase. Rate limiting is `http_ratelimit`, a different phase entirely.
- **Zone WAF, Edit.** Read is sufficient to fetch a phase entrypoint. A CI token that only ever reads rules now holds no write access to them.

The method is the point. Cloudflare returns "10000: Authentication error" identically whether a token is invalid, unscoped to the zone, or merely unscoped to the endpoint, so guessing produced two wrong answers in a row. What resolved it was making the checker probe `user/tokens/verify` and the zone read on any refusal and report **which layer** said no. That turned a guess into a finding in one run: token valid, zone visible, rulesets refused.

**Any future permission question on this token is answered the same way**: change one thing, re-run the job, read what it says. Not by reasoning about what Cloudflare probably calls it.

## Incident log

- **15 Aug 2026**: three compounding database failures, each hiding the next: every Worker connected as a `BYPASSRLS` role, all six connection-string secrets then held the empty string, and no migration had ever been applied to any long-lived branch. Written up in full under "Incident: the schema that was never there" below, because the analysis of why every control missed it is worth more than the fix.
- **15 Aug 2026**: real Twilio account credentials were placed in all four non-production worker stores and in the CI store during the 0.3 paste session, against the same-night deferral ruling. Found by the 0.3 secret-name audit; all twelve entries deleted the same night (eight wrangler, four GitHub). Recommended follow-up: rotate the Twilio auth token in the Twilio console, since it briefly lived in stores whose reachable surface is wider than production's.
- **15 Aug 2026**: the `neondb_owner` password for the project's main branch was printed into a build-session transcript by `neonctl projects create` output. Remediation: password reset on all three branches (main, staging, dev) in the Neon dashboard before any DB URL was stored as a secret, making the exposed value dead. Standing rule going forward: Neon connection strings are retrieved only inside a pipe into `wrangler secret put`, never displayed.

- **16 Aug 2026**: two production deploys failed after shipping half of production, and nothing measured the result. Written up under "Incident: the half-applied deploy nobody watched" below. Includes a hand deploy to production made outside CI by Claude, recorded there rather than softened here.

- **16 Aug 2026**: the role-rotating test suites were run locally against the shared dev branch, rotating `marginsheet_app`'s password and leaving both dev Workers unable to authenticate until the secret was reissued. Staging and production untouched. Written up under "Incident: the guard that asked the wrong question" below, because the shape of the guard is worth more than the fix.

- **17 Aug 2026**: the §1 phone-change tightening had been nominally live since 3.2b and had never been exercised, because the endpoint it guards was never built. Written up under "Incident: the control with nothing to guard" below.

- **17 Aug 2026**: the `neondb_owner` connection string for the **dev** branch, password included, was printed into a build-session transcript by a Postgres `Invalid URL` error while Claude was debugging a mis-parsed env file. Read from `services/api/.env.isolation.dev`, which is gitignored and local. Dev branch only; staging and main untouched, and no Worker authenticates as `neondb_owner` in any environment. **Remediated the same session**: password reset through Neon's `reset_password` endpoint, so the new value was generated by Neon and never chosen, displayed or logged; `.env.isolation.dev` rewritten in place; both halves then proven, the new credential connecting as `neondb_owner` and the exposed one refused. CI is unaffected because it derives connection strings from `NEON_API_KEY` at run time.

  Recorded rather than waved off, per Guy: **a secret that has appeared in a transcript gets rotated, and the reasoning for not doing it is always "it probably doesn't matter."** This is the second transcript exposure of a `neondb_owner` password (see 15 Aug) and the standing rule from that one, that Neon connection strings are retrieved only inside a pipe, does not cover this route: the string was already at rest in a local file and an unrelated error printed it. **An error message is an exfiltration path.**

## Incident: the control with nothing to guard (17 August 2026)

No outage and no exposure. A security control that had been believed live for two days could not have failed, because nothing could reach it.

### What happened

The §1 tightening says a phone change requires a passkey when the member has one registered. The phone is the SIM-swap surface, so an email-delivered link that can move it lets whoever controls the inbox move the security primitive.

Task 3.2b shipped `src/auth-guard.ts` with `mayChangePhone()` and a test of its decision table. Both were correct. **`mayChangePhone()` had no caller anywhere in `src/`.** There was no phone-change endpoint, so no request could attempt a phone change, so the tightening could not have gone red however broken it was.

Asked the standing question, would this go red if the thing it guards were completely broken: no. Not because it watched a proxy, and not because it was skipped, but because **the operation it governs did not exist**. A function returning the right answer to a question nobody asks.

### The instruction was recorded and not followed

This was ruled on 15 August, and the ruling is in `docs/m3-2-task-plan.md` §2 in Guy's own framing:

> "Build the minimal real endpoint here, not a stand-in. Guy's reasoning: a control tested against a stand-in is a control nobody has exercised, and the endpoint is small."

The plan recorded the instruction. The build delivered the decision table. Nothing caught the gap for a day, and the reason it was not caught is the part worth keeping: **the only test was against the pure function, and it passed honestly.** A green suite covering a function is indistinguishable from a green suite covering a feature, unless something asks how the function is reached.

### Why it took a second thing to surface it

Even with an endpoint, the refusal case could not have been constructed: proving "member HAS a passkey, magic-link session, refused" requires a registered passkey, and no test could register one until the passkey harness landed on 17 August. Two absences hid each other. The endpoint was missing, and the only case that would have exercised it was unbuildable.

### What changed

- `POST /auth/phone` exists, mounted in the Worker, as ruled on 15 August.
- The three §1 cases are proven **through the endpoint** rather than against the function, against a **real registered passkey**.
- Every assertion is on the **database row**, not the response. A handler that answers 403 while writing the change looks identical from the outside, and the row is what decides whether the SIM-swap surface moved.
- The refusal test asserts the **reason**, not just the status. Its first run failed on `no_member` rather than `passkey_required`, which is how the RLS gap below was found. Asserting `403` alone would have shown green while the tightening never ran.

### Found while closing this one

The endpoint was the first request-scoped read of a policied table in the build, and it did not work: `members` carries `household_isolation`, so a session identifies a user, the member row says which household, and the member row cannot be read until the household is known. That circle has no solution inside the policy and had never been hit because nothing had needed it. Closed by migration 0018's `auth_household_id()`, the first deliberate hole in the RLS boundary, whose constraints are enforced by `services/api/test/rls-resolver.test.ts` rather than described.

### The shape to watch for

**A control's test must show how the control is reached, not only that it decides correctly.** The decision table was never wrong. What was missing was any path to it, and a unit test cannot see that a function has no callers. The question to ask of a guard is not "does it return the right answer" but "what would have to happen for this to run at all, and does that thing exist yet".

## Incident: the guard that asked the wrong question (16 August 2026)

Dev's two Workers lost their database for roughly twenty minutes. No household data was touched and no other environment was affected. The interesting part is not the outage, it is that a guard existed, was working exactly as written, and did not apply.

### What happened

The four role-rotating test suites do `ALTER ROLE marginsheet_app LOGIN PASSWORD '<random>'` in `beforeAll`, because the role's password is write-only in the secret store and setting a new one is the only way to connect as it. On the ephemeral `pr-<n>` branch CI uses, that role is branch-local and the branch is destroyed minutes later. On dev it is the credential both deployed Workers hold.

They were run with `DATABASE_URL` pointed at dev. The Workers kept the old password, `/health` went 503 with `authentication failed`, and `db-identity` went red.

### Why the guard did not stop it

The guard was `AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE=1`. **It gated the action and not the target.** It asked "am I allowed to rotate the role", and the answer to that was legitimately yes. The question that decided the damage was "am I allowed to rotate it *here*", and nothing asked it. Setting a permission flag feels like answering a question about yourself; the blast radius is a property of the place you are pointed, which the flag never mentioned.

`ci.yml` also carried a prominent comment directly above the step: "Never point this at a long-lived branch: the Workers holding the previous password would lose their database until the secret was reissued." Accurate, prominent, and it stopped nothing. **A document asserting a practice is not evidence of the practice**, which is the 15 Aug lesson applied to a warning rather than to a mitigation.

### What caught it

Nothing anyone did deliberately. `db-identity` went red on an unrelated pull request and reported `status=500 ... first-line="<!DOCTYPE html>"`, which is only legible because that check had been taught to say what answered it earlier the same day. The previous message would have read `Unexpected token '<'`, which was the same string it produced for a Cloudflare challenge, a WAF block and a disabled hostname.

### What changed

- **The gate names the target.** `NEON_TEST_BRANCH` must match `pr-<n>`, and CI derives it from the same pull request number that created the branch, so the declaration and the connection string cannot drift.
- **An allowlist, not a blocklist** (ruled by Guy). Resolving the endpoint host and refusing dev, staging and main was the alternative and was rejected: a blocklist is wrong by default the moment a new long-lived branch exists, and the branch nobody remembered to add is the one that gets rotated. Refusing everything that is not `pr-<n>` fails closed on the unanticipated case. Same reasoning as the enumerated column grants in 0002 and 0011.
- **The refusal moved to the operation.** Four files held four copies of the `ALTER ROLE` and four copies of the gate. A control remembered in four places will be correct in three. `services/api/test/helpers/app-role.ts` now owns it and throws before the connection is used, so a caller with wrong skip logic still cannot rotate.
- **The guard has its own test**, which attempts the forbidden rotation against a recording stand-in and asserts that a refused call issues **no SQL at all**. "It threw" and "it threw before touching the database" are different claims. It runs without a database, deliberately: a guard that can only be tested against the thing it protects is a guard nobody runs. It also asserts the permitted case, since a guard that refuses everything passes every negative test while being useless.
- **The suites fail rather than skip in CI.** A skipped suite reports green, which is how a rotating suite quietly stops running.

### Residual risk, stated rather than implied

The guard trusts the caller's declaration of where they are pointed. `NEON_TEST_BRANCH=pr-1` with `DATABASE_URL` aimed at dev would still rotate dev. That is a deliberate false statement about the target rather than the accident this prevents, which was setting a permission flag that never mentioned a target at all. Verifying the declaration against Neon's branch endpoint would close it and is not built.

### The shape to carry forward

**Any destructive operation guarded by "am I allowed to do this" rather than "am I allowed to do this here" has this hole.** The permission is about the operator; the damage is about the target. Recorded in CLAUDE.md alongside the other verification rules, because the next instance will not be a database role.

## Incident: the half-applied deploy nobody watched (16 August 2026)

Two `deploy` runs failed within four minutes. Both had already shipped code to production when they went red, both left production half-applied, and the step that exists to notice that did not run in either. No data was exposed. What was lost was the ability to say what production was serving, which the pipeline had been claiming to guarantee since Task 0.7.

### What happened

`wrangler deploy` uploads the Worker first and reconciles routes second. The upload succeeded both times (`Uploaded marginsheet-api`). The route call then failed:

```
A request to the Cloudflare API (/zones/90a1a8b7.../workers/routes) failed.
Authentication error [code: 10000]
```

`CLOUDFLARE_API_TOKEN` holds account-level Workers Scripts permission but no zone-level Workers Routes permission on marginsheet.com. Commit `e92c825` moved the `api.marginsheet.com` custom domain from the Cloudflare dashboard into `services/api/wrangler.jsonc`, so wrangler began calling an endpoint the token had never needed. **The PR that put the route in the repo is the PR that broke production deploys**, and it would have failed on every subsequent run. The route itself was already correct and serving; wrangler died reconciling a route that needed no change.

Then two guards did what they were written to do:

- **`Deploy conversation to production`** carries GitHub's default `if: success()`. It was skipped. Only api shipped. Only api declares `routes`; the conversation Worker's production config has none, so its deploy would have succeeded had it been allowed to run.
- **`Verify production serves this commit against this schema`** carries the same default. It was skipped too.

So the job went red for the route call, and the serving state of production was never measured, in either run.

### Why the verification missed it, and why this one is different

The five controls in the 15 Aug incident all watched a proxy for the thing they guarded. This one watched exactly the right thing. It was skipped.

**A verify step guarded by `success()` reports on the case where nothing is wrong and is absent in the case it exists to catch.** Asked the standing question, "if production were left half-deployed, would this go red?", the answer is not "no, it would pass" but something worse: it would not run. The job's red pointed at the route call. Nothing pointed at production.

That makes it the purest instance of the family so far. Not a control aimed wrongly, a control that structurally cannot observe its own failure case. When a check is conditional, **the condition is part of the check.**

The corollary for reviewers: a red deploy step does not mean nothing shipped. Deploy tools do work before they fail, and the ordering of that work is theirs, not ours.

### The second finding: green never meant current

The two runs deployed out of order.

| Time | Run | Result |
|---|---|---|
| 18:36:22 | `ea975f9`, main's tip | uploaded api at `ea975f9`, then failed on routes |
| 18:38:39 | `e92c825`, its parent, held for approval and approved later | uploaded api at `e92c825`, then failed on routes |

Production ended on `e92c825`, one commit behind main. **An approval arriving out of order rolled production backwards and nothing said so**, because no check compared deployed state against main's tip. `concurrency: cancel-in-progress: false` preserves the queue but not the ordering once a job waits on a human, and human response time is not a queue discipline.

This is the same family as the first finding. Verification asserted the artifact was the artifact it deployed. It never asked whether that artifact was the current one.

### The third finding: the hand deploy, recorded plainly

The conversation Worker's production deployment at **18:29:49** came from no GitHub Actions job. The nearest production job ran seven minutes later; the run created two seconds afterwards is a different workflow. It was a manual `wrangler deploy` from a terminal, made by Claude during the previous session while diagnosing the "Not found" response from the emailed magic link.

That is precisely the drift `deploy.yml` opens by saying it exists to end: *"This ends manual deploys, and with them the drift they cause."* It happened anyway, eight days after that line was written, because the path was still open. It is also the reason the two Workers were observed on different commits, which read as a half-applied CI deploy and was in fact a hand deploy plus a half-applied CI deploy compounding.

Worth stating without hedging: the workflow header claimed an outcome the system did not enforce, and the person best placed to know that wrote the header. A document asserting a practice is not evidence of the practice, which is the 15 Aug lesson applied to process rather than to code.

**Open question, owner Guy:** whether the terminal path to production should be closed (a token scoped so hand deploys to production fail) or kept as a logged escape hatch. Both are defensible. What is not defensible is the current state, where the path is open, unlogged, and documented as closed.

### What changed

- Every verification step in `deploy.yml` is `if: always()` instead of the default `if: success()`. Verification now runs precisely when a deploy step failed, which is when it is worth running. The one exception is a run refused by the tip check below, where nothing was deployed by design and a mismatch would be one we deliberately created.
- The production job refuses to deploy a commit main has moved past, before it migrates anything. An out-of-order approval now fails loudly and names the run that should be approved instead, rather than silently rolling production back.
- The workflow header's "OPEN ITEM: THAT GATE DOES NOT EXIST" block is closed. Guy attached the required reviewer on 15 Aug, and two runs on 16 Aug held for approval, which is the observation that closes it rather than the setting being reported back.

### Still open, owner Guy

1. **The Cloudflare API token** needs `Zone -> Workers Routes -> Edit` on marginsheet.com. Until then every production deploy fails after shipping api and before shipping conversation. Adding `Zone -> Zone Settings -> Read` would also let checks diagnose item 2 themselves instead of inferring it.
2. **Zone security is blocking CI from the custom domain.** `https://api.marginsheet.com/debug/db-identity` returns JSON to a laptop and an HTML challenge page to GitHub's runners, twice, in 54 to 171ms. The `*.workers.dev` hosts pass from the same runners. Only the zone-attached hostname is subject to the zone's bot and IP-reputation settings, which matches exactly. This is what blocks the `db-identity` gate, and through it PRs #50, #46 and #47. A WAF skip rule for `/health` and `/debug/*` is cleaner than disabling bot protection.

Both were found by asking production directly rather than reading a job summary, which remains the only method that has ever worked here.

## Incident: the schema that was never there (15 August 2026)

Three failures, each one hiding the next. Found while debugging a 503 from a newly built endpoint. No data was exposed and none could have been, because there was no data and no schema. That is the only reason this is an engineering write-up rather than a breach notice.

### What happened, innermost first

**Failure 1: no migration had ever been applied to any long-lived branch.** `main`, `staging` and `dev` each held zero user tables, in both the `marginsheet` and `neondb` databases. Neither `marginsheet_app` nor `marginsheet_sync` existed anywhere. All ten M1 migrations were real, correct, and proven, but only ever against the ephemeral per-PR branch that `ci.yml` creates and `neon-pr-cleanup.yml` then destroys. `deploy.yml` had no migration step at any stage, so nothing had ever run them anywhere that persists. Ten PRs merged green and M1 was accepted on that evidence.

**Failure 2: the application connected as a `BYPASSRLS` role.** Task 0.3 issued every Worker's `NEON_DATABASE_URL` for `neondb_owner`. That role holds `BYPASSRLS`, which supersedes even `FORCE ROW LEVEL SECURITY`, so the application would have read past every `household_isolation` policy. Migration 0008 recorded a mitigation ("the application connects as `marginsheet_app`") that was never in place. Found by the M3 spike, which also disproved 0008's stated reasoning about `FORCE`.

**Failure 3: the fix for failure 2 stored six empty strings.** The corrective reissue piped `scripts/app-db-url.mts` into `wrangler secret put`. `tsx` and `postgres` were declared only in `packages/schema`, while the helper's usage line says to run it from the repo root, so `pnpm exec` failed. The pipe delivered nothing. `wrangler secret put` stored the empty result and reported success, six times. And because of failure 1, `marginsheet_app` did not exist to be reissued for anyway, so the helper could not have succeeded even with a working pipe.

The nesting is the point. Failure 3 was caused by the fix for failure 2, and both were made unfixable by failure 1, which nobody had looked for because every report said the schema was live.

### Why every control missed it

| Control | Why it passed |
|---|---|
| `/health` | Returned `{service, environment, build}`. It proved the Worker had booted and the edge served the right commit. It never touched a database, so an empty one and a correct one were indistinguishable. |
| Deploy verification | Asserted the live `build` matched the deployed commit. Entirely true, and entirely about code. |
| The `migrate` CI job | Ran up, down, and up again against the ephemeral PR branch. It proved the migrations were correct. It never claimed any environment had run them, and nobody noticed it wasn't claiming that. |
| The isolation suite | Derives its own `NEON_DATABASE_URL` from `neonctl` as `neondb_owner` at job time, then asks it `select 1`. `select 1` succeeds against an empty database. It validates the credential CI can derive, never the credential a Worker holds. |
| The M1 invariant suite | 146 tests, all real, all green, all against the ephemeral branch that was destroyed minutes later. |
| The incident log | Recorded failure 2's remediation as complete on all six Workers. It was complete on none. A document asserting a fix is not evidence of a fix. |

The common shape: **every control observed something adjacent to the thing that mattered.** Each was individually correct and honestly written. Not one of them asked a deployed Worker whether it could query a real table, because that question belonged to no module's scope.

### What changed

- `/health` runs a real query against a real table (`households`), reports `database.ok` and the connected database's applied migration count, and answers 503 when the database half fails. `select 1` was rejected deliberately: an empty database answers it happily.
- Deploy verification fails unless `database.ok` is true **and** the reported migration count equals the number of migration files in the commit being deployed. Schema drift is now a named, failing condition rather than a silent one.
- `deploy.yml` migrates each environment's own Neon branch before deploying code to it, and a failed migration fails the deploy.
- `db-identity` is a blocking CI job asserting the positive on all six Workers: `current_user` **is** `marginsheet_app` and it does **not** hold `BYPASSRLS`. Asserting only "not `neondb_owner`" would pass for any wrong role, including one that does not exist and including an empty credential that never connected.
- `scripts/put-app-db-url.sh` captures instead of piping, and refuses to store anything that is not a `marginsheet_app` connection string. A pipe carries a failure as an empty payload, which is indistinguishable from a successful empty result unless something checks.
- `tsx` and `postgres` are declared at the repo root, so the helper runs where it is documented to run.
- Migration 0010 grants `SELECT` on `schema_migrations` to the application roles, and nothing more. A role that could write that table could forge the schema version the deploy check trusts.
- `packages/schema/test/db/health.test.ts` proves the health check goes red: against an empty database, against an unreachable one, and it asserts the error is scrubbed of anything connection-shaped.
- The `/debug/db-identity` and health helpers moved into `packages/shared/src/db.ts`. Both services had byte-identical private copies, which is how a third service inherits a stale one.

### Found while closing this one, still open

The `production` GitHub Environment carries `protection_rules: []`. `deploy.yml` has stated since Task 0.7 that production "waits on the `production` GitHub Environment, whose required reviewer is Guy", and it never has. The environment exists, the `environment: production` line in the workflow is real, and the environment simply has no rules attached, so the job has never paused for anyone. The first run of the extended pipeline took production from queued to migrated, deployed and verified in 37 seconds with no approval.

Nothing bad reached production: the deploy was correct and verification passed. The control was the thing that was missing, not the outcome. This is the same shape as the three failures above and it was found the same way, by asking the system what it actually does instead of reading what it says.

**Owner: Guy.** Settings, Environments, production, Required reviewers. Attempted programmatically on 15 Aug 2026 and refused by the harness classifier, which is the correct outcome for a production control.

### The shape to watch for

The next gap will not be this one. It will have this shape: **a control that reports on a proxy for the thing it is trusted to guarantee.** The test is not "is this check correct?" but "if the thing it guards were completely broken, would this check go red?" For `/health`, the honest answer had always been no, and it was written down nowhere because nobody had asked the question in those words.

The corollary, which cost the most time here: **a fix is not a fix until something fails without it.** Failure 2's remediation was recorded, believed, and never observed. The observation is the remediation. The rest is intent.

## Network identity: what is actually protected, and by how much

Measured 16 August 2026 against a real magic-link sign-in over HTTP, carrying a real `User-Agent` and a real client IP, with the 0012 trigger **disabled** so layer 1 could be seen on its own.

| Column | Layers | Measured with the trigger off |
|---|---|---|
| `session.ip_address` | **two**: `advanced.ipAddress.disableIpTracking` and the 0012 trigger | no address recorded (an empty string, not NULL) |
| `session.user_agent` | **one**: the 0012 trigger, and nothing else | the exact header value was written |

**For user agent the trigger is not defence in depth. It is the sole defence.** Better Auth has no configuration for user agent and reads the header unconditionally. What would break this is a Better Auth upgrade that changes its session insert behaviour, and nothing in the application would report it: the column would simply start holding data the household never agreed to have kept.

**Why the test asserts user agent is populated.** With the trigger enabled both columns are null, so asserting null proves nothing about layer 1; it would pass identically with `disableIpTracking` deleted. The proof disables the trigger, and the user-agent assertion then serves as the tripwire: if a change ever stopped the request context reaching the session write, user agent would go null and the test fails. That is the only way to tell "suppressed" apart from "never arrived". See `services/api/test/real-sign-in.test.ts` and migration 0016.

**Recorded in 0016 rather than in 0012's header**, because 0012 is merged and migrations are append-only after merge (CLAUDE.md). The rule applies to a comment exactly as it applies to a schema change.

## The Verify decoupling probe

`scripts/verify-decoupling-probe.sh` sends a real OTP through the production Twilio Verify service and checks it, to prove that an approved phone verification returns a verdict and nothing session-shaped. Phone is a security primitive under identity-onboarding-spec §§1 and 7, and a Verify response carrying a token would silently make it an authentication factor.

**Custody.** The three Twilio values are prompted into the running process, never echoed, never written to disk, never placed in shell history, and never exported beyond curl. Per the deferral ledger these are live production credentials, so the probe runs on Guy's machine only, never in dev and never in CI. That constraint is why it is a script he runs rather than a CI job.

**Result, 15 August 2026.** HTTP 201 `status=pending`, then HTTP 200 `status=approved valid=True`, with no token, session, JWT, or credential-shaped field in the response. The decoupling holds.

**Known constraint (15 Aug 2026): the account is on trial.** The first attempt returned error 21608, since trial accounts deliver only to verified caller IDs. The founder number was added to the allowlist and the probe passed. Upgrade scheduled Wednesday 19 August 2026 with the A2P brand retry. Blocking condition to watch is the first non-founder phone, not the date.

**It can fail.** The first version of this probe was an inline one-liner using `read -p`, which is bash syntax that means "read from a coprocess" in zsh. Every variable stayed unset, Twilio answered 404, and the assertion scanned that error body and reported success. The script now asserts each HTTP status and payload before the next step runs, and the decoupling verdict is unreachable unless the check returned `approved`. Negative controls: empty credentials, malformed SIDs, and a live 401 all exit non-zero without printing a verdict.

## Observability privacy controls

Sentry is configured to hold no network identity for households. Three layers, all required, none redundant:

1. **`sendDefaultPii: false`** on both workers' Sentry init.
2. **The scrubber** (`packages/shared/src/sentry-scrub.ts`, run as `beforeSend` and `beforeBreadcrumb`) redacts `CF-Connecting-IP` and its proxy-convention variants, Cloudflare's per-request geolocation headers, and sets an explicit null `user.ip_address`.
3. **Sentry org setting "Prevent Storing of IP Addresses"** (Settings, Security and Privacy). This is the authority: Sentry's ingest infers an IP from the connecting hop and derives a geography from it **after** `beforeSend` has run, so client-side code alone cannot suppress it. Verified 15 Aug 2026 by inspecting a live event.

Verified 15 Aug 2026 against live events in all six worker environments: no IP address in the user context, no `user` tag, `Cf-Ipcountry` redacted, and no `CF-Connecting-IP` present in captured headers.

**Known residuals, accepted.** Sentry resolves a country from the connecting IP before discarding the address, so events carry `Geography: United States (US)`. It is country-level only (the pre-fix events showed a city), it describes Cloudflare's egress datacenter rather than a household, it is derived server-side after `beforeSend` and cannot be suppressed by client code, and Sentry exposes no setting to disable it. The timezone that Sentry's culture context carried is attached client-side and is therefore removed by the scrubber (ruled 15 Aug 2026); household timezone is a modeled field on the household record, which is how scheduled sends compute, and never needs to arrive via error telemetry. Revisit the geography residual if Sentry ever adds a control, or if a household-facing surface begins reporting client-side events.

PostHog carries the matching controls in the committed snippet at `apps/web/public/index.html`: autocapture off, session recording off, automatic pageviews off, memory persistence. Named events only, declared in `packages/shared/src/analytics.ts`.

## Rules

- No secret value ever appears in the repo, CI logs, chat transcripts, or this document.
- gitleaks scans full history and blocks merges from 0.4 onward.
- Staging and dev must be unable to touch production money, messages, or data. The isolation suite (`services/api/test/isolation.test.ts`) proves it by attempting the forbidden action and requiring failure.
