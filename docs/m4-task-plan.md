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

### 1a. Does `marginsheet_sync` work at all (SPIKE COMPLETE, 17 Aug 2026)

**Two findings, and the second is larger than the first.**

**It can log in and it cannot connect.** `0009_app_role_login` granted LOGIN, so `rolcanlogin` is true. But no provisioning path exists: `app-db-url.mts` and `put-app-db-url.sh` handle `marginsheet_app` only, nothing in `scripts/` mentions the sync role, and no sync connection string is inventoried in the custody doc. The role has a privilege it cannot use and no way to get a credential. 4.1 builds that path.

The custody half is clean: `SELECT, UPDATE` on `access_token_ciphertext`, and correctly refused `session`, `user`, `recovery_challenges` and `auth_send_attempts`.

**The grant is far wider than the description.** 39 tables with INSERT, SELECT and UPDATE, including `messages`, `threads`, `handoffs`, `llm_call_logs`, `decision_journal`, `known_context`, `insight_ledger`. The pipeline needs eight. Not exploitable today because nothing connects as the role, which is exactly why it is worth fixing before 4.1 issues the credential: the moment it exists, a compromised sync worker reads every household's conversation history.

**Ruled 17 Aug 2026: narrow it in 4.1.** The custody doc's description is the security claim, and a role that can read every conversation is a different component wearing that sentence. Recorded in CLAUDE.md as a class, because two roles have now been found wider than their documentation and both were found by looking rather than by anything failing.

### 1a-bis. The original question, for the record

**Treated as a spike output, not an assumption to design around** (ruled 17 Aug 2026). Three things, all before anything is built on the role:

1. It **connects**.
2. It **reads `access_token_ciphertext`**, which is the one thing it exists to do and which `marginsheet_app` is refused.
3. It is **refused something it should not have**, so the answer is a boundary rather than a door.

The third is what makes the first two mean anything. A role that connects and can read everything is not the control the column grant describes.

### 1b. Durable Objects (SPIKE COMPLETE, 17 Aug 2026)

**A DURABLE OBJECT IS NOT A LOCK, AND THE SPEC ASSUMES IT IS.**

§3 says *"the household's Durable Object owns sync execution, so two webhooks for the same household never run concurrent syncs (replaces Base44's optimistic status checks with an actual lock)."* Implemented as written, that is false.

Measured against a real DO under `wrangler dev`, three concurrent requests to one object id, counting how many were inside the handler at once:

```
{ "naive": 3, "blocking": 1, "chained": 1 }
```

A plain `fetch` handler **interleaves at every await**. A DO gives single-threaded execution, not mutual exclusion: the moment the handler awaits, another request enters. For a sync that awaits on every Plaid call and every database write, that is concurrency at every step, which is exactly what the spec says the DO prevents. **Routing webhooks through a DO and calling it a lock would have reproduced Base44's race with more machinery.**

Two things do serialise, and both were measured rather than assumed:

- **`blockConcurrencyWhile()`** holds everything, including status reads, and is documented for initialisation. A Plaid sync held under it makes the object unresponsive for the whole sync.
- **An explicit promise-chain lock**, where each request awaits the previous one's completion. Serialises the work while leaving other paths responsive.

**Recommendation: the promise-chain lock**, with `blockConcurrencyWhile` reserved for the object's own initialisation. Invariant 1's test then attempts the violation properly: fire concurrent webhooks for one household and assert only one sync ran, which is a test that would have passed against the naive implementation only by luck of timing.

### 1b-bis. Whether a DO can be driven in the test harness

**Not by the current suite, and that is structural.** The existing tests run in Node and talk TCP to Neon; workerd cannot. Driving a DO in-process needs `@cloudflare/vitest-pool-workers`, which is not installed and would be a second vitest project rather than a setting.

Options for 4.5, needing a ruling when we get there: add the workers pool as a separate project for DO tests only, or drive the DO over HTTP against `wrangler dev` the way this spike did. The spike proves the second works and needs no new dependency.

### 1c. Plaid's cursor semantics### 1c. Plaid's cursor semantics

Invariant 2 requires a mid-sync crash to resume from the persisted cursor *"with no gap and no replay."* The spec says persist after every page. **Whether Plaid's cursor actually behaves that way is a claim about Plaid, and Sandbox can settle it**: sync, persist, kill mid-stream, resume, and compare the union against a clean run.

### 1d. Whether Sandbox can produce the error states

Invariant 8 lists the fixtures: `ITEM_LOGIN_REQUIRED`, item error, removed transactions, pending→posted, reversal. Sandbox has `/sandbox/item/reset_login` and `/sandbox/item/fire_webhook`, and the rest are less certain.

**This is the ninth finding waiting to happen.** If a fixture cannot construct an error state, the test for that error state is honest and vacuous, exactly like every isolation test before a household had two members. So the spike enumerates which states Sandbox can actually produce. **Any it cannot becomes a named gap with an owner on the open-items list, never a test written against a fixture that cannot fail** (ruled 17 Aug 2026).

---

## 2. Two rulings, both made

### 2a. Where sync runs: a third Worker (RULED)

The spec says *"decrypted only inside the sync worker"*, and there is no sync worker. Today there are two: `api` and `conversation`. Three options:

- **A third Worker**, `marginsheet-sync`, connecting as `marginsheet_sync`. Cleanest custody boundary: the role, the key and the decryption live in one deployable that no household request reaches. Costs a third deploy target, a third set of secrets, and a third thing the deploy pipeline must verify.
- **A queue consumer inside `api`** with its own binding and connection string. Fewer moving parts; weaker boundary, because the same deployable holds both the household-facing routes and the decryption key.
- **The Durable Object itself does the sync**, since it already owns serialisation.

**Ruled: the third Worker.** The custody rules are written as though a separate sync worker exists, and putting the decryption key in the deployable that serves household requests would make the role split cosmetic, which is the thing M3 spent itself removing.

Guy's addition, which is the stronger half of the reasoning: **it makes the token-reading surface a deployable with no public routes at all.** That is a better boundary than a code path inside one that has them, because it cannot be reached by a request that takes a wrong turn.

### 2b. Production Plaid credentials: Sandbox green, then paste, then one real connection (RULED)

The same sequence as Postmark, for the same reason: **a live credential against an unproven path is the wrong order.**

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

**The reconciliation control is the one to judge M4 by.** It is the only new build in a module that is mostly extraction, and it is the first control in the product that **blocks a customer-visible number**.

### It is two controls, not one, and the register carries two entries

Ruled 17 Aug 2026. Widening the tolerance to infinity is a correct planted failure and it proves only that the test notices a **disabled tolerance**. The second mutation leaves the tolerance intact and breaks the **blocking**: drift is detected, the investigation item opens, and the number ships anyway.

**That is the failure mode that matters, because it is what Base44 had.** A reconciliation check that reports without blocking looks healthy from every angle: the drift is found, the item exists, somebody could read it. The only thing missing is the part that protects a household from a wrong number.

Applying the register's own test to the pair: if blocking broke, would the detection test notice? **No.** It would still detect, still open the item, still pass. So blocking needs its own entry badly, which is exactly the criterion for keeping one.

| Entry | Mutation | Must go red |
|---|---|---|
| `reconciliation-detects` | tolerance widened to infinity | the drift test, because nothing is ever out of tolerance |
| `reconciliation-blocks` | tolerance intact, the block removed | a test asserting the account's numbers do **not** ship while an investigation item is open |

**Invariant 7 needs both halves.** A static scan catches the token being logged in code somebody writes. A behavioural probe catches it arriving in a Sentry payload through a path nobody wrote deliberately, which is how it would actually happen. M3's Sentry scrubbing exists; whether it survives a Plaid error object carrying a token in a nested field is a question for a test, not for reading.

---

## 4. Sub-tasks

- **4.0** The spike: Durable Objects, cursor semantics, Sandbox fixture inventory. Findings before design.
- **4.1** `marginsheet_sync`: the provisioning path that does not exist, and the grant narrowed from 39 tables to the 8 the pipeline needs. Enumerated, never granted-and-subtracted. The negative control attempts `messages`, `known_context` and `decision_journal`, three sections apart, because one refusal proves a boundary exists and three prove it is not a single lucky revoke.
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
