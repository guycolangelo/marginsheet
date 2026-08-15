# plaid-pipeline-spec.md
## Bank connectivity, sync, webhooks, reconciliation. Governs M4.
## Drafted 14 August 2026. Mostly extraction (Base44's pipeline is proven); new design is marked.

Sources: `base44/shared/plaid.ts` and `transactions.ts` (extracted), the plaid-* function suite, PlaidItem/FinancialAccount/AccountBalanceSnapshot schemas, projection-spec (Recurring consumer), data-model-spec (token custody).

---

## 1. Products and posture

- **Products:** Transactions ($0.30/Item/mo), Recurring ($0.15), Liabilities ($0.20). PAYG through launch. The rate/tier/cap email to Plaid remains an open item on Guy's list.
- **Production from day one for real households; Sandbox retained for CI** (ruled): error-state fixtures — `ITEM_LOGIN_REQUIRED`, connect failures, sync failures, reversals — run against Sandbox in GitHub Actions, never against paid production Items.
- **Access tokens:** `access_token_ciphertext`, app-layer AES-GCM, key in Wrangler secrets, decrypted only inside the sync worker (data-model-spec §2). Never in a client payload, never in a log line, never in Sentry context.

---

## 2. Link and connection

- Plaid Link with the **non-blocking accordion and progressive rendering** — the ported pattern, kept verbatim in behavior: institutions connect in sequence, each begins backfilling immediately, the UI never blocks on the slowest bank.
- `plaid-exchange-public-token` flow ports: public token → access token → Item + accounts created, Institution upserted (global table), balances snapshotted.
- **Zombie prevention** (ported fix): exchange is idempotent per Item; a re-fired exchange never creates a duplicate Item. Reconnect (`plaid-reconnect-link`) reuses the existing Item in update mode; `needs_reauth` clears on success.
- **"I've connected all my accounts"** button state + last-institution timestamp both recorded — the M13 intro trigger consumes whichever fires first (button, or backfill-complete/30-minute fallback per the tightened trigger).
- Capital One parameter handling (ported fix) carries over as a Link-config note.

---

## 3. Sync

- `/transactions/sync` exclusively, cursor per Item, 500/page, **cursor persisted after every page** (a mid-sync crash resumes, never replays from zero).
- Coordination state machine (ported): `idle → syncing → (queued if a webhook lands mid-sync) → immediate follow-up from the just-persisted cursor → idle`, `error` on failure. The **sync_status watchdog** (ported) sweeps stuck `syncing` Items older than a threshold back to `queued`.
- Serialization: the household's Durable Object owns sync execution — two webhooks for the same household never run concurrent syncs (replaces Base44's optimistic status checks with an actual lock).
- Added/modified/removed and pending→posted semantics: per categorization-spec §1 and §10, unchanged.
- **First-sync milestone:** `first_sync_completed_at` set once; feeds the intro trigger and the day-3–5 census scheduling.

---

## 4. Webhooks

All inbound through `provider_events` (unique `source, event_id`) before any processing.

| Webhook | Action |
|---|---|
| `SYNC_UPDATES_AVAILABLE` / `DEFAULT_UPDATE` / `HISTORICAL_UPDATE` | Enqueue sync (or mark `queued` if running). `HISTORICAL_UPDATE` additionally marks backfill-complete for the intro trigger. |
| `TRANSACTIONS_REMOVED` | Handled inside sync's removed stream (flag, never delete) |
| `RECURRING_TRANSACTIONS_UPDATE` | **New consumer (projection-spec):** refresh Recurring streams → upsert `commitments` with `source = plaid_recurring` (lowest authority; census/liability/household-stated rows are never overwritten) |
| `ITEM_LOGIN_REQUIRED` / `PENDING_EXPIRATION` | `status = needs_reauth`; surfaces in-app; **no brain messages about reauth at launch** — an app-surface banner, not a text (message-class decision deferred to the canon, not improvised here) |
| `ITEM_ERROR` | `status = error`, Sentry, watchdog-visible |
| Liabilities webhooks | Refresh `liability_details` → re-run the LiabilityDetail commitment upsert (authority 3) |

Every sync completion fires the internal **household-state-changed** signal the watcher listens on (the brain spec's event-driven requirement; task-zero's "which exists" question is answered: we build the signal, since we own the pipeline now).

---

## 5. Balances and reconciliation

- Balance snapshot per account per day (ported, unique on account+date) + on-demand refresh (`plaid-refresh-balances` ports). Snapshots feed the Cash Flow engine's `as_of` and the runway arithmetic.
- **The reconciliation invariant (new build; the brain spec's monitored-invariant requirement):** every sync completion computes, per account, expected balance = last reconciled balance + sum of transaction flows since, and compares against Plaid's reported balance. Drift beyond tolerance (default: max($1.00, 0.1%) — config) opens an **internal investigation item** (insight-ledger row, `route = wait`, plus Sentry) before any customer-visible number ships from that account's data. The Base44 "Plaid Reconciliation" workflow is the ancestor; this version blocks, not just reports.
- Known honest limits, documented not hidden: pending-transaction timing and same-day float cause benign transient drift; the tolerance and a 24-hour settle window exist for exactly that, and only *persistent* drift opens an item.

---

## 6. Item lifecycle

- Removal (`plaid-remove-item` ports): Plaid-side `/item/remove` **always called** (billing stops), accounts `is_active = false`, transactions retained (books history survives account disconnection).
- **No Item survives `canceled` or `expired`** — the identity-spec invariant, enforced here: entitlement transitions to either state trigger removal of every household Item, verified by a follow-up `/item/get` expecting failure.
- Resync (`plaid-resync-item` ports): cursor reset for support-grade recovery, admin-only.

---

## 7. Invariants (M4 test suite seeds)

1. A webhook retry storm produces exactly one sync and zero duplicate transactions (provider_events + DO lock).
2. Mid-sync crash resumes from the persisted cursor with no gap and no replay.
3. Induced drift beyond tolerance blocks that account's numbers and opens an investigation item; drift inside the settle window does not.
4. Re-fired token exchange never duplicates an Item; reconnect never creates one.
5. `plaid_recurring` commitment upserts never overwrite higher-authority rows.
6. Item removal verified at Plaid (billing actually stops), every path including guarantee redemption.
7. Access token never appears in any log, error report, or client payload (scanned, asserted).
8. Sandbox fixtures cover: login-required, item-error, removed transactions, pending→posted, reversal; all green in CI without touching production.
9. The founder household's real institutions (including Capital One) complete a full backfill and incremental sync on the new pipeline before M9 migration.

---

## 8. Open

1. Reauth nudge channel (app banner at launch is specced; whether it ever earns an SMS class is a canon decision for the conversational spec, not this document).
2. Drift tolerance and settle window are config defaults; tune on founder-household data in week one of M4.
