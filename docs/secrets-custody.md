# Secrets custody

## Updated 15 August 2026 (Task 0.3). This document lists what exists and where it lives. It never contains values.

## Stores

1. **Wrangler secrets**: runtime, per service, per environment. Set by Guy in his terminal via `wrangler secret put` (interactive prompt or a local pipe); values touch nothing else.
2. **GitHub Actions secrets**: CI only. Deploy token, Neon API key, and the isolation suite's dev/staging credential sets.

## Inventory and deferral ledger

Deferral ruling (Guy, 15 Aug 2026): production/live credentials land with the module that first uses them, never earlier. Tonight is sandbox/test credentials, encryption keys, DB URLs, and CI secrets only.

| Secret | Service | dev / staging | production |
|---|---|---|---|
| `NEON_DATABASE_URL` | api + conversation | set 0.3 (branch-matched: dev, staging) | set 0.3 (main branch) |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | api | sandbox, set 0.3 | **deferred to M4** |
| `STRIPE_SECRET` | api | test mode, set 0.3 | **deferred to M7** |
| `STRIPE_WEBHOOK_SECRET` | api | **deferred to M7**: minted with the webhook endpoint, test and live | **deferred to M7** |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | api + conversation | **deferred to M3** (unset 15 Aug ruling; the isolation Twilio check skips while absent and re-arms when set) | **deferred to M3** |
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

## Incident log

- **15 Aug 2026**: real Twilio account credentials were placed in all four non-production worker stores and in the CI store during the 0.3 paste session, against the same-night deferral ruling. Found by the 0.3 secret-name audit; all twelve entries deleted the same night (eight wrangler, four GitHub). Recommended follow-up: rotate the Twilio auth token in the Twilio console, since it briefly lived in stores whose reachable surface is wider than production's.
- **15 Aug 2026**: the `neondb_owner` password for the project's main branch was printed into a build-session transcript by `neonctl projects create` output. Remediation: password reset on all three branches (main, staging, dev) in the Neon dashboard before any DB URL was stored as a secret, making the exposed value dead. Standing rule going forward: Neon connection strings are retrieved only inside a pipe into `wrangler secret put`, never displayed.

## Observability privacy controls

Sentry is configured to hold no network identity for households. Three layers, all required, none redundant:

1. **`sendDefaultPii: false`** on both workers' Sentry init.
2. **The scrubber** (`packages/shared/src/sentry-scrub.ts`, run as `beforeSend` and `beforeBreadcrumb`) redacts `CF-Connecting-IP` and its proxy-convention variants, Cloudflare's per-request geolocation headers, and sets an explicit null `user.ip_address`.
3. **Sentry org setting "Prevent Storing of IP Addresses"** (Settings, Security and Privacy). This is the authority: Sentry's ingest infers an IP from the connecting hop and derives a geography from it **after** `beforeSend` has run, so client-side code alone cannot suppress it. Verified 15 Aug 2026 by inspecting a live event.

PostHog carries the matching controls in the committed snippet at `apps/web/public/index.html`: autocapture off, session recording off, automatic pageviews off, memory persistence. Named events only, declared in `packages/shared/src/analytics.ts`.

## Rules

- No secret value ever appears in the repo, CI logs, chat transcripts, or this document.
- gitleaks scans full history and blocks merges from 0.4 onward.
- Staging and dev must be unable to touch production money, messages, or data. The isolation suite (`services/api/test/isolation.test.ts`) proves it by attempting the forbidden action and requiring failure.
