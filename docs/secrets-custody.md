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
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | api | sandbox, set 0.3 | **deferred to M4** |
| `STRIPE_SECRET` | api | test mode, set 0.3 | **deferred to M7** |
| `STRIPE_WEBHOOK_SECRET` | api | **deferred to M7**: minted with the webhook endpoint, test and live | **deferred to M7** |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | api + conversation | **deferred to M3** (unset 15 Aug ruling; the isolation Twilio check skips while absent and re-arms when set) | **deferred to M3**; exercised live 15 Aug 2026 by the decoupling probe, prompted into one process on Guy's machine and stored nowhere |
| `TWILIO_VERIFY_SERVICE_SID` | api | **deferred to M3** (inert without real credentials) | **deferred to M3** |
| `POSTMARK_TOKEN` | conversation | sandbox server token, set 0.3 | **deferred to M3** |
| `ANTHROPIC_API_KEY` | conversation | non-production key, set 0.3 (0.5's smoke call needs it) | **deferred to the first production deploy that calls a model** |
| `ANTHROPIC_API_KEY` | api | **deferred to M5** (escalation calls: Haiku to Sonnet parsing chain) | **deferred to M5** |
| `TOKEN_ENCRYPTION_KEY` | api | set 0.3, distinct per environment | set 0.3, distinct |

GitHub Actions store: `CLOUDFLARE_API_TOKEN` (scoped API token, not a personal OAuth token), `NEON_API_KEY`, `ANTHROPIC_API_KEY` (non-production), and `DEV_` / `STAGING_` prefixed sets for the isolation suite (Plaid sandbox pair, Stripe test key; Twilio pair joins at M3; DB URLs derived from `NEON_API_KEY` at run time).

## TOKEN_ENCRYPTION_KEY custody

- AES-GCM key material for Plaid access tokens (plaid-pipeline invariant 7).
- Generated on Guy's machine by `openssl rand -base64 32`, piped directly into `wrangler secret put`. Displayed nowhere, stored nowhere else. One key per environment, all distinct.
- The only copy lives in the Cloudflare secret store for its environment. Loss means re-linking Plaid Items, not data loss.
- Rotation requires decrypt-and-re-encrypt of stored tokens. That path is built in M4; until then rotation equals re-linking.

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

## Incident log

- **15 Aug 2026**: three compounding database failures, each hiding the next: every Worker connected as a `BYPASSRLS` role, all six connection-string secrets then held the empty string, and no migration had ever been applied to any long-lived branch. Written up in full under "Incident: the schema that was never there" below, because the analysis of why every control missed it is worth more than the fix.
- **15 Aug 2026**: real Twilio account credentials were placed in all four non-production worker stores and in the CI store during the 0.3 paste session, against the same-night deferral ruling. Found by the 0.3 secret-name audit; all twelve entries deleted the same night (eight wrangler, four GitHub). Recommended follow-up: rotate the Twilio auth token in the Twilio console, since it briefly lived in stores whose reachable surface is wider than production's.
- **15 Aug 2026**: the `neondb_owner` password for the project's main branch was printed into a build-session transcript by `neonctl projects create` output. Remediation: password reset on all three branches (main, staging, dev) in the Neon dashboard before any DB URL was stored as a secret, making the exposed value dead. Standing rule going forward: Neon connection strings are retrieved only inside a pipe into `wrangler secret put`, never displayed.

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

## The Verify decoupling probe

`scripts/verify-decoupling-probe.sh` sends a real OTP through the production Twilio Verify service and checks it, to prove that an approved phone verification returns a verdict and nothing session-shaped. Phone is a security primitive under identity-onboarding-spec §§1 and 7, and a Verify response carrying a token would silently make it an authentication factor.

**Custody.** The three Twilio values are prompted into the running process, never echoed, never written to disk, never placed in shell history, and never exported beyond curl. Per the deferral ledger these are live production credentials, so the probe runs on Guy's machine only, never in dev and never in CI. That constraint is why it is a script he runs rather than a CI job.

**Result, 15 August 2026.** HTTP 201 `status=pending`, then HTTP 200 `status=approved valid=True`, with no token, session, JWT, or credential-shaped field in the response. The decoupling holds.

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
