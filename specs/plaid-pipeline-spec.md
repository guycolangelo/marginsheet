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

  **AN ITEM IS A LOGIN, NOT AN INSTITUTION, AND RECONNECT KEYS ON THE ITEM** (ruled 18 Aug 2026). A household with a personal and a business login at the same bank has two credential sets, two authorizations, and Plaid bills for two. Recorded because `institution_id` feels like the natural key and someone will reach for it: keying reconnect there finds the wrong Item, updates it, and **orphans the other**, which silently stops syncing while still appearing connected. Exercised by a test that connects two Items at one institution and requires both to survive a reconnect of either.

  **THE api WORKER BRIEFLY HOLDS A PUBLIC TOKEN, AND THAT IS NOT A BOUNDARY VIOLATION.** After §4a the browser posts the `public_token` to `api`, which proxies it to `marginsheet-sync` over a service binding. A public token is short-lived and single-use; an access token is neither. **The boundary is "api never holds an ACCESS token", not "api touches nothing from Plaid"**, and it is stated here so the distinction is not later mistaken for a violation of the third-Worker ruling.
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

  **Amended again 19 August 2026, on building it (task 4.5), because the chain has a second way to be wrong and the obvious test cannot see it.** The lock is `this.tail = new Promise(...)` assigned **before** awaiting the predecessor. Moving that assignment **after** the await leaves code that reads like a chain, is a chain by every description of it, and serialises nothing: two callers both read the old tail before either replaces it.

  **Every HTTP test stayed green against that mutation.** The window it opens is one microtask, and two requests arriving over the network are milliseconds apart, so nothing the network can deliver lands inside it. The comfortable conclusion is that the window is too small to matter. It is wrong, because **sync work is dispatched from inside the object as well as from the network**: a queue batch or an alarm that takes the lock per item takes it twice in one tick, which is precisely the arrival the network cannot produce.

  So the object carries a **same-tick collision** path that dispatches two units of work with no await between them, and the lock is proven against it. Two arrival shapes, two tests: the network one proves the deployable serialises, and the same-tick one proves the chain is a chain.

  **The counters that prove a collision happened are maintained OUTSIDE the lock**, and that ordering is load-bearing. The first version had the test's fixture guard read a queue depth the lock itself kept, so removing the lock reported *"the collision never formed"* when it had formed and the lock was gone. A guard the mutation can silence sends the reader to re-run rather than to look.
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

Every sync completion **that changed something** fires the internal **household-state-changed** signal the watcher listens on (the brain spec's event-driven requirement; task-zero's "which exists" question is answered: we build the signal, since we own the pipeline now).

### The contract (ruled 18 August 2026, before 4.4 built anything)

**A THIN SIGNAL. It carries no financial data.**

| Field | Purpose |
|---|---|
| `signal_id` | Idempotency, the same reasoning as `provider_events` |
| `household_id` | Which household to look at |
| `occurred_at` | When |
| `source` | The `plaid_item_id` and sync run that produced it, for traceability |
| `changed` | Change KINDS, specific enough to route: `transactions_added`, `transactions_modified`, `transactions_removed`, `balances_updated`, `item_status_changed`, `recurring_updated`, `liabilities_updated` |
| counts per kind | Optional. **A count is metadata; an amount is not.** |

**IT MUST NEVER CARRY** amounts, balances, merchant names, dates of household activity, category names, or any transaction detail.

**Two reasons, and the second is the load-bearing one.**

**One: the watcher needs CURRENT state, not deltas.** "Balance versus upcoming commitment" needs the balance now. A payload carrying the change would make the watcher reason from a delta about a state it should read.

**Two, and this is why it is doctrine rather than design preference: a payload carrying household financial data puts that data OUTSIDE THE RLS BOUNDARY.** Every column privilege, every policy, the sync role narrowed to nine tables in migration 0023, `household_isolation` itself: **none of it applies to a message in transit.** A fat signal would be the one place in this system where a household's figures exist unprotected, and it would exist for convenience.

So the watcher reads state from the database as `marginsheet_app` with the household GUC set. **The signal says "look again, at this household, because these kinds of things moved."**

**A sync that changed nothing does not fire.** A watcher waking for nothing is how a watcher becomes noise.

**TWO INPUTS, STATED SO NOBODY CONFLATES THEM.** This signal is the **event-driven** half. The **time-based** half is the daily Cron: an expected commitment missed, an income stream missed, a date passing. **A rule that fires because time moved cannot fire from a signal that fires when data moves**, and building only the signal would leave those rules permanently silent.

**WHY THIS REASONING IS RECORDED AND NOT JUST THE SHAPE.** The pressure to widen the payload will come from a real place: some future rule will be cheaper to evaluate with the delta already in hand, and **that will read as an optimisation rather than as moving household figures outside the boundary.** It is the second. The privacy argument also gets stronger the further the payload travels, so a queue transport makes the thin payload do more work than an in-database outbox would.

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

   That is exactly what §3's own "queued if a webhook lands mid-sync" arrow describes, so it is **a normal control-flow branch and not an exception**.

   **Do not classify it as an error, and do not answer it with a retry.** Handled as an error it parks the Item in `error`, the watchdog sweeps it back to `queued`, and it fails again identically. The obvious remedy for a sync that keeps failing is a retry, and **a retry of the in-flight cursor replays**: duplicate transactions in a household's ledger, arriving through a change that looked like reliability work.

   - **The in-flight cursor**, persisted after every page, resumes a crash.
   - **The last-completed-sync cursor**, the only one guaranteed to survive a mutation, is the fallback on that error.
3. Induced drift beyond tolerance blocks that account's numbers and opens an investigation item; drift inside the settle window does not.
4. Re-fired token exchange never duplicates an Item; reconnect never creates one.
5. `plaid_recurring` commitment upserts never overwrite higher-authority rows.
6. Item removal verified at Plaid (billing actually stops), every path including guarantee redemption.
7. Access token never appears in any log, error report, or client payload (scanned, asserted).

   **AMENDED 18 Aug 2026. The behavioural half moves from Plaid's RESPONSE shape to our REQUEST-side envelope.** This is a change to what the control guards, not to how it is built.

   **The evidence, captured against Sandbox before anything was built.** Seven error classes: `INVALID_API_KEYS`, `INVALID_ACCESS_TOKEN`, `MISSING_FIELDS`, `INVALID_FIELD`, `NOT_FOUND`, `INVALID_PRODUCT`, `ITEM_LOGIN_REQUIRED`. Every one returned an **identical seven-key envelope**: `display_message`, `documentation_url`, `error_code`, `error_message`, `error_type`, `request_id`, `suggested_action`. No nesting, no populated `causes`, **no echo of the request**, and **no credential even in the error whose entire subject is a bad secret**.

   The original concern was whether Sentry scrubbing survives a Plaid error object carrying a token in a nested field. **That describes a shape Plaid does not produce.** A scrubber pointed there would pass forever while proving nothing, which is the standing question answered before building rather than after.

   **The redirected control, stated plainly: the token is in the REQUEST, not the response.** So the exposure is anything of ours that serialises what we sent. A retry wrapper attaching the failed request for context. A debug line logging `init`. An error whose serialised form carries the body.

   **The behavioural probe forces a failure on a call that genuinely carries a token** and asserts it appears in no log line, no Sentry payload, and no thrown error's serialised form.

   **Prior art, not hypothesis.** On 17 Aug 2026 the `postgres` driver formatted a failed connection into an exception and printed a database password in full into a transcript. Same class, already observed in this codebase, once. A library that puts what you sent into an error message is not a theoretical risk here.

   The static scan is unchanged.
8. **AMENDED 17 Aug 2026, because four of the five could not be built.** The original text claimed Sandbox fixtures cover login-required, item-error, removed transactions, pending to posted and reversal, all green in CI. Spike 1d attempted each. **Only `ITEM_LOGIN_REQUIRED` is constructible** (`/sandbox/item/reset_login`, after which `/transactions/sync` returns the error and `/item/get` carries it). Sandbox will not fire `ITEM:ERROR`, will not fire `TRANSACTIONS_REMOVED`, never populated the `removed` stream under any fixture shape, and **produced zero pending transactions** across 48 default-user rows and every `user_custom` shape tried.

   So the invariant now claims what can actually be proven: **`ITEM_LOGIN_REQUIRED` is exercised against Sandbox in CI without touching production.** The other four are named gaps carrying owners in `docs/open-items.json`, and none of them gets a test written against a fixture that cannot fail.

   **Pending to posted is the one that matters most**, because it is not an error path: it is the normal daily behaviour of every card transaction, categorization-spec §10 turns on it, and it is unreachable in Sandbox. It is tested against a hand-built fixture of our own rows, which proves our filing logic and **does not** prove Plaid's shape. The second claim is first met by invariant 9, at M9.
9. The founder household's real institutions (including Capital One) complete a full backfill and incremental sync on the new pipeline before M9 migration.

---

## 8. Open

1. Reauth nudge channel (app banner at launch is specced; whether it ever earns an SMS class is a canon decision for the conversational spec, not this document).
2. Drift tolerance and settle window are config defaults; tune on founder-household data in week one of M4.
