# M4, The Plaid Pipeline
## Drafted for Guy's approval, 17 August 2026. Nothing executes until approved.
## Governing doc: `plaid-pipeline-spec.md`. Schema from M1 migration 0002. Token custody from `data-model-spec` §2.

---

## 0. What is already here, and what is not

M1 built the tables and nothing has ever used them: `plaid_items`, `financial_accounts`, `institutions`, `account_balance_snapshots`, `liability_details`, `provider_events`, plus the `sync_status` and `provider_source` enums.

Two things in that inventory deserve naming before anything is built on them.

**`marginsheet_sync` has existed since 0002 and nothing has ever connected as it.** It is the only role permitted to read `access_token_ciphertext`, and the column grant that withholds that column from `marginsheet_app` is proven. What is not proven is that the sync role *works*: that it can connect, that its grants are sufficient for the pipeline, that its RLS policies admit what a sync needs. M3 found the same shape twice, with `mayChangePhone()` and `withinRecentAuthWindow()`. **A role with privileges and no connections is a control nobody has exercised**, and it is load-bearing for every token in the product.

**`provider_events` exists and no handler does.** That is the open item owed to M4 and M7, now covering four providers. M4 builds the Plaid half and the shared check-and-insert the other three will use.

---

## 1. The three things to verify before designing around them

The pattern that has paid for itself all week: confirm behaviour by running it, not by reading about it. Three assumptions sit under M4's design and none has been executed here.

### 1a. Durable Objects, which this codebase has never used

Invariant 1 depends on a per-household lock: *"two webhooks for the same household never run concurrent syncs (replaces Base44's optimistic status checks with an actual lock)."* No Durable Object exists in this repo, no binding is declared, and no migration tag has ever been written.

**What the spike must answer, empirically:** that two concurrent requests to the same DO id genuinely serialise; what happens to the second when the first is mid-await; whether the lock survives a Worker eviction; and how a DO is exercised in `vitest` at all. If DOs cannot be driven in the harness, that is a named gap with a manual verification, not a workaround, and I would rather find it in a spike than in the middle of the sync build.

### 1b. Plaid's cursor semantics

Invariant 2 requires a mid-sync crash to resume from the persisted cursor *"with no gap and no replay."* The spec says persist after every page. **Whether Plaid's cursor actually behaves that way is a claim about Plaid, and Sandbox can settle it**: sync, persist, kill mid-stream, resume, and compare the union against a clean run.

### 1c. Whether Sandbox can produce the error states

Invariant 8 lists the fixtures: `ITEM_LOGIN_REQUIRED`, item error, removed transactions, pending→posted, reversal. Sandbox has `/sandbox/item/reset_login` and `/sandbox/item/fire_webhook`, and the rest are less certain.

**This is the ninth finding waiting to happen.** If a fixture cannot construct an error state, the test for that error state is honest and vacuous, exactly like every isolation test before a household had two members. So the spike enumerates which states Sandbox can actually produce, and any it cannot becomes a named gap rather than a test that quietly proves nothing.

---

## 2. Two rulings I need before building

### 2a. Where does sync run?

The spec says *"decrypted only inside the sync worker"*, and there is no sync worker. Today there are two: `api` and `conversation`. Three options:

- **A third Worker**, `marginsheet-sync`, connecting as `marginsheet_sync`. Cleanest custody boundary: the role, the key and the decryption live in one deployable that no household request reaches. Costs a third deploy target, a third set of secrets, and a third thing the deploy pipeline must verify.
- **A queue consumer inside `api`** with its own binding and connection string. Fewer moving parts; weaker boundary, because the same deployable holds both the household-facing routes and the decryption key.
- **The Durable Object itself does the sync**, since it already owns serialisation.

I recommend the first. The token custody rules in `data-model-spec` §2 are written as though a separate sync worker exists, and the whole point of the column grant is that the role which can read ciphertext is not the role serving requests. Putting the key in `api` would make that split cosmetic.

### 2b. Production Plaid credentials

The deferral ledger says Plaid production lands with M4. Sandbox credentials exist for dev and staging. That is a paste session on your desk, and it should happen **after** the Sandbox work is green, matching the sequence that worked for Postmark: build against Sandbox, prove the flow, then paste production and do one real connection.

---

## 3. The controls M4 ships, and how each is proven

Every one gets a register entry and a planted failure, per 3.6. Named here so the register is designed rather than retrofitted.

| Control | Proven by attempting |
|---|---|
| `provider_events` check-and-insert | a webhook retry storm produces **one** sync and zero duplicate transactions (invariant 1) |
| The DO lock | two concurrent webhooks for one household; the second must wait, not run |
| Cursor persistence | a crash mid-sync, then resume: no gap, no replay (invariant 2) |
| **Reconciliation blocking** | induced drift beyond tolerance **blocks** that account's numbers and opens an investigation item; drift inside the settle window does not (invariant 3) |
| Exchange idempotency | a re-fired exchange creates no second Item; reconnect creates none (invariant 4) |
| Commitment authority | a `plaid_recurring` upsert must not overwrite a census, liability or household-stated row (invariant 5) |
| Item removal | `/item/remove` called on every path, verified by a follow-up `/item/get` **expecting failure** (invariant 6) |
| Token custody | the access token appears in no log, error report or client payload: a static scan plus a behavioural probe (invariant 7) |
| Sandbox error fixtures | each error state actually constructed, or named as a gap (invariant 8) |

**The reconciliation control is the one to judge M4 by.** It is the only new build in a module that is mostly extraction, and it is the first control in the product that **blocks a customer-visible number**. Its planted failure is the interesting one: widen the tolerance to infinity and the drift test must go red.

**Invariant 7 needs both halves.** A static scan catches the token being logged in code somebody writes. A behavioural probe catches it arriving in a Sentry payload through a path nobody wrote deliberately, which is how it would actually happen. M3's Sentry scrubbing exists; whether it survives a Plaid error object carrying a token in a nested field is a question for a test, not for reading.

---

## 4. Sub-tasks

- **4.0** The spike: Durable Objects, cursor semantics, Sandbox fixture inventory. Findings before design.
- **4.1** `marginsheet_sync` proven to connect and to hold exactly the privileges the pipeline needs, and no more.
- **4.2** Token custody: encrypt, decrypt in the sync path only, and both halves of invariant 7.
- **4.3** Link and exchange, with zombie prevention and reconnect.
- **4.4** `/transactions/sync` with cursor persistence and the coordination state machine.
- **4.5** The DO lock and the webhook path through `provider_events`.
- **4.6** Balances, snapshots, and the reconciliation invariant that blocks.
- **4.7** Recurring → `commitments` at `plaid_recurring` authority.
- **4.8** Item lifecycle: removal verified at Plaid, resync, and the no-Item-survives-cancellation rule.
- **4.9** Register entries and planted failures for every control above.

---

## 5. What M4 will not cover, stated now

- **Invariant 9 cannot be met in M4.** The founder household's real institutions completing a full backfill is gated on production credentials and on Guy's own banks, and it is the M9 migration's precondition. It stays an open item with M9 as owner.
- **Categorization is M5.** M4 delivers transactions with `pending`/`posted` semantics and the removed stream; what they mean is the next module's.
- **The Cash Flow engine is M6b.** M4 produces balance snapshots and the `as_of` those depend on, and computes nothing from them.
- **Reauth nudges stay an app banner.** Spec §8 open item 1: whether it earns a message class is a canon decision, not M4's.

---

## 6. The verification test, applied

M3 shipped ten controls that could not fail, and every one was found by trying to use the thing. M4's exposure is larger, because it is the first module that calls a paid third party and the first that decrypts anything.

The two I would watch hardest: **the sync role, which has had privileges and no connections for two weeks**, and **the Sandbox fixtures, which decide whether invariant 8's tests can express their own failure cases.** Both are shapes this build has already been caught by once.
