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
- **Serialization: the household's Durable Object owns sync execution, and the LOCK IS EXPLICIT.** Two webhooks for the same household never run concurrent syncs, and the thing that makes that true is a promise-chain lock inside the object, not the object itself.

  **Amended 17 August 2026, because the original sentence was wrong on a load-bearing detail.** It read "replaces Base44's optimistic status checks with an actual lock", which invited exactly the implementation that does not work: route the webhooks through a DO and consider the race solved.

  **A Durable Object gives single-threaded execution, not mutual exclusion.** One object runs on one thread in one location, so nothing is ever truly parallel. But a plain `fetch` handler yields at every `await`, and another request enters at that point. Measured under `wrangler dev`, three concurrent requests to one object id, counting how many were inside the handler at once:

  ```
  { "naive": 3, "blocking": 1, "chained": 1 }
  ```

  A sync awaits on every Plaid page and every database write, so a naive handler is interleaved at every step. **Implemented as originally written, the DO would have reproduced Base44's race with more machinery**, and the failure would have looked like exactly the thing it replaced.

  **The fix is a promise-chain lock**, where each request awaits the previous one's completion before starting its own. `blockConcurrencyWhile()` also serialises and is the wrong tool here: it holds the whole object, including status reads, and is documented for initialisation. Reserve it for the object's own startup.

  **What the DO is still for:** a single, addressable, consistent place to hold the lock and the coordination state for one household. It is the right home for the lock. It is not itself the lock, and anyone reading "the DO owns sync execution" should not infer one.
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
| `ITEM_ERROR` (Plaid sends this as `webhook_type: ITEM`, `webhook_code: ERROR`) | `status = error`, Sentry, watchdog-visible. **Not constructible in Sandbox**: `/sandbox/item/fire_webhook` answers `webhook_type has no code ERROR`, so this handler is exercised against a synthesised payload, never against Plaid |
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

1. A webhook retry storm produces exactly one sync and zero duplicate transactions (provider_events + the DO's lock). **The test CONSTRUCTS the collision rather than hoping for one** (ruled 17 Aug 2026): two webhooks are fired at genuinely the same moment against one household, and exactly one sync is asserted. A test that fires them in sequence, or that relies on timing, passes against an unlocked handler most of the time and is the ninth finding wearing a different hat.
2. Mid-sync crash resumes from the persisted cursor with no gap and no replay. **Verified against Sandbox 17 Aug 2026 in the quiet case** (16 + 32 of 48, zero overlap, zero missing), and the cursor is idempotent when the same bookmark is presented twice.

   **AMENDED: THE PIPELINE PERSISTS TWO CURSORS, NOT ONE.** An intermediate cursor is not a durable resume point. If the underlying data changes while a pagination is in flight, Plaid refuses it:

   ```
   400 TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION
   Underlying transaction data changed since last page was fetched.
   Please restart pagination from last update.
   ```

   That is exactly what §3's own "queued if a webhook lands mid-sync" arrow describes, so it is **a normal control-flow branch and not an exception**. Handled as an error it produces a stuck Item that the watchdog sweeps and that fails again identically.

   - **The in-flight cursor**, persisted after every page, resumes a crash.
   - **The last-completed-sync cursor**, the only one guaranteed to survive a mutation, is the fallback on that error.
3. Induced drift beyond tolerance blocks that account's numbers and opens an investigation item; drift inside the settle window does not.
4. Re-fired token exchange never duplicates an Item; reconnect never creates one.
5. `plaid_recurring` commitment upserts never overwrite higher-authority rows.
6. Item removal verified at Plaid (billing actually stops), every path including guarantee redemption.
7. Access token never appears in any log, error report, or client payload (scanned, asserted).
8. **AMENDED 17 Aug 2026, because four of the five could not be built.** The original text claimed Sandbox fixtures cover login-required, item-error, removed transactions, pending to posted and reversal, all green in CI. Spike 1d attempted each. **Only `ITEM_LOGIN_REQUIRED` is constructible** (`/sandbox/item/reset_login`, after which `/transactions/sync` returns the error and `/item/get` carries it). Sandbox will not fire `ITEM:ERROR`, will not fire `TRANSACTIONS_REMOVED`, never populated the `removed` stream under any fixture shape, and **produced zero pending transactions** across 48 default-user rows and every `user_custom` shape tried.

   So the invariant now claims what can actually be proven: **`ITEM_LOGIN_REQUIRED` is exercised against Sandbox in CI without touching production.** The other four are named gaps carrying owners in `docs/open-items.json`, and none of them gets a test written against a fixture that cannot fail.

   **Pending to posted is the one that matters most**, because it is not an error path: it is the normal daily behaviour of every card transaction, categorization-spec §10 turns on it, and it is unreachable in Sandbox. It is tested against a hand-built fixture of our own rows, which proves our filing logic and **does not** prove Plaid's shape. The second claim is first met by invariant 9, at M9.
9. The founder household's real institutions (including Capital One) complete a full backfill and incremental sync on the new pipeline before M9 migration.

---

## 8. Open

1. Reauth nudge channel (app banner at launch is specced; whether it ever earns an SMS class is a canon decision for the conversational spec, not this document).
2. Drift tolerance and settle window are config defaults; tune on founder-household data in week one of M4.
