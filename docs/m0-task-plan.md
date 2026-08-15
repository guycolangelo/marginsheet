# M0 Task Plan — Foundation
## Drafted for Guy's approval, 14 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, data-model-spec §0, build plan v3 §M0.

---

## Task 0.1 — Repository

- New private repo: `guycolangelo/marginsheet` (the rebuild; `marginsheet-app` stays as Base44 escrow, untouched)
- **First commit is the eleven specs**, verbatim, at `/specs/`, plus `CLAUDE.md` at root. The constitution exists in the repo before any code does.
- Monorepo layout:

```
/CLAUDE.md
/specs/                     (the eleven documents)
/apps/web/                  (React app — M8)
/apps/site/                 (Astro marketing site, migrated in later, placeholder now)
/services/api/              (Workers: app API, Plaid pipeline, engines)
/services/conversation/     (Workers: the brains — Phase B)
/packages/schema/           (Drizzle schema + migrations — M1's home)
/packages/fact-packages/    (typed definitions + fixtures — M2's home)
/packages/shared/           (normalization, money, dates — the one merchant key lives here)
/prompts/                   (versioned system prompts — Phase B)
/.github/workflows/
```

## Task 0.2 — Environments

- Cloudflare: `dev`, `staging`, `production` Workers environments via Wrangler config; Pages project for `/apps/web`
- Neon: one project, branches `main` (production), `staging`, plus **ephemeral branch per PR** (CI creates/destroys)
- **Isolation asserted, not assumed:** staging carries no production secrets — it cannot reach a production Plaid Item, cannot send a real SMS, cannot charge a card. Verified by a smoke test that tries and fails.

## Task 0.3 — Secrets

- Wrangler secrets per environment: `ANTHROPIC_API_KEY`, `PLAID_CLIENT_ID/SECRET` (sandbox creds in dev/staging, production only in production), `STRIPE_SECRET/WEBHOOK_SECRET` (test mode in dev/staging), `POSTMARK_TOKEN`, `TWILIO_*`, `NEON_DATABASE_URL`, `TOKEN_ENCRYPTION_KEY` (the AES-GCM key for Plaid tokens, generated once, custody documented for the Infosec Program)
- Repo history scanned for secrets in CI (gitleaks), blocking

## Task 0.4 — CI (the gates, blocking from day one)

GitHub Actions on every PR:
1. Typecheck + unit tests
2. **Golden tests** (empty suite now; the job exists and blocks so M5/M12 inherit a live gate, not a TODO)
3. **Lint layer** — the vocabulary/format rules from CLAUDE.md as a real linter over source strings and prompt files: em-dash ban, % rule, parentheses rule, banned-word lists. Runs today against the specs themselves as its first fixture set.
4. Secrets scan
5. Migration up/down against the PR's Neon branch (job exists; real migrations arrive with M1)

**Proof:** one deliberately broken commit per gate, each shown blocked, then reverted. The plan's "CI blocks a planted failure" done-criterion.

## Task 0.5 — Model routing config

`/packages/shared/models.ts`: the routing table from CLAUDE.md as typed config — call classes, chains, and per-tier fallback behavior (`stop_and_queue`, `flagged_fallback`, `degrade_to_fixture`, `no_send`, `free_fallthrough`). A forced-unavailability test exercises each behavior. No live model calls in M0 beyond one smoke call per configured model to validate keys.

## Task 0.6 — Observability

- Sentry: both services wired, environment-tagged, with the access-token scrubber installed from day one (plaid-pipeline invariant 7 starts here, not in M4)
- PostHog: project created, web app wired, event naming convention documented in `/packages/shared/analytics.ts`

## Task 0.7 — Deploy proof

An empty Worker (health endpoint returning build SHA + environment) deploys through CI to staging and production. The Pages app deploys a placeholder. This is the M0 exit demo.

---

## Done-when (from build plan v3, verbatim)

Empty Worker deploys through CI to all three environments; CI blocks each planted failure; staging isolation proven; specs live in the repo.

## What I need from you to execute

| Item | Needed for |
|---|---|
| GitHub: create `marginsheet` repo (or grant creation) | 0.1 |
| Cloudflare account access (Workers + Pages enabled) | 0.2 |
| Neon account (free tier fine for now) | 0.2 |
| Anthropic API key | 0.3, 0.5 |
| Plaid sandbox credentials (dashboard → sandbox keys; production keys stay out until M4) | 0.3 |
| Stripe test-mode keys | 0.3 |
| Postmark account + server token (domain setup is a parallel task, not blocking M0) | 0.3 |
| Twilio account SID/auth (Verify service created; A2P submission is your separate track) | 0.3 |
| Sentry + PostHog accounts (I can scaffold against placeholders if you'd rather defer) | 0.6 |

## Estimate

2–3 working days once credentials land. M1 (schema) and M2 (fact packages) open the moment 0.4's gates are proven.

**Approve as written, or mark up.**
