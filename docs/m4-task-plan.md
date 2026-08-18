# M4, The Plaid Pipeline
## APPROVED 17 August 2026. Tasks 4.1 through 4.9, as drafted, with the spike findings folded in.
## Governing doc: `plaid-pipeline-spec.md`. Schema from M1 migration 0002. Token custody from `data-model-spec` §2.

---

## The approval, and what it approved

**4.1 through 4.9 as drafted**, carrying the four spike findings:

1. **The grant narrows to eight tables**, enumerated rather than granted-and-subtracted, with a negative control attempting three forbidden tables from different sections of the schema.
2. **The chain lock**, whose planted failure removes the lock and leaves the object, because a mutation that deletes the Durable Object reddens the test and proves nothing.
3. **Two cursors**, with `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` treated as control flow and never as an error.
4. **Invariants 2 and 8 claiming only what the spikes proved.**

### The sequencing instruction that sits on top of the plan (Guy, 17 Aug 2026)

**Connect the founder household's real institutions EARLY in M4, not at the end.**

The plan as drafted put real institutions at invariant 9, which is M9, and that ordering was wrong for one specific reason. **Pending to posted is unconstructible in Sandbox and it is the normal daily behaviour of every card transaction.** Categorization-spec §10 turns on it. So real banks are not the final validation of M4, they are the **only place §10 is exercised at all**.

The argument in Guy's words, recorded because it is the reason and not a preference: *finding that our filing logic mishandles a settling transaction in week one of M4 is a fix; finding it at invariant 9 with the module otherwise done is a rewrite.*

**This amends ruling 2b.** Production Plaid credentials land **earlier** than the Postmark-style sequence implied. The revised order:

1. **Sandbox green for what Sandbox can prove.** `ITEM_LOGIN_REQUIRED`, cursor resume in the quiet case, exchange idempotency, the DO lock, `provider_events`. That is 4.1 through 4.5.
2. **Then the real connection**, on the founder household's own institutions, Capital One included.
3. **Then the rest of the module built against both**, so 4.6 through 4.9 are written while a real settling transaction is available to test against.

The Postmark reasoning still holds and is not being discarded: **a live credential against an unproven path is the wrong order.** What changed is where "unproven" ends. The path is proven far enough at the end of 4.5 to carry a real Item, and waiting past that point buys nothing while costing the only signal Sandbox cannot give.

**What this does not change.** Invariant 9 stays owed: a full backfill and incremental sync across every founder institution, as M9's precondition. Connecting early exercises §10 during the build. It does not discharge the invariant.

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

**RULED 17 Aug 2026: the promise-chain lock**, with `blockConcurrencyWhile` reserved for the object's own initialisation. And **the spec is amended rather than quietly built around**: `plaid-pipeline-spec.md` §3 now records what a Durable Object actually provides (single-threaded execution, not mutual exclusion), why the chain is the fix, and that the DO is the right HOME for the lock without being one. The next person reading "the DO owns sync execution" must not infer a lock from it.

#### Invariant 1's test, and the direction its planted failure has to break

Two requirements, both ruled 17 Aug 2026.

**The test constructs the collision rather than hoping for one.** Two webhooks fired at genuinely the same moment against one household, asserting exactly one sync ran. Fired in sequence, or relying on timing, it passes against a completely unlocked handler most of the time. That is the ninth finding in a new costume: a fixture that cannot express the failure case, so the assertion is honest and the coverage is degenerate.

**The planted failure removes the LOCK, not the DO.** Deleting the Durable Object binding reddens the test and proves nothing, because a missing DO breaks loudly and immediately for everyone, exactly like `USING (false)` on the two-member policy. The mutation that means something leaves the object, the routing and the coordination state intact and removes only the chain await, which is the failure that ships silently and only bites under concurrency. **A test that only reddens when the DO is gone is proving the wrong thing.**

| Entry | Mutation | Must go red |
|---|---|---|
| `do-sync-lock` | remove the `await` on the previous request's promise, leaving the DO and its routing intact | the constructed-collision test, because two syncs now run |

### 1b-bis. Whether a DO can be driven in the test harness

**Not by the current suite, and that is structural.** The existing tests run in Node and talk TCP to Neon; workerd cannot. Driving a DO in-process needs `@cloudflare/vitest-pool-workers`, which is not installed and would be a second vitest project rather than a setting.

**RULED 17 Aug 2026: drive the DO over HTTP against `wrangler dev`**, the way this spike did. No new dependency, and the spike has already proven it works. `@cloudflare/vitest-pool-workers` as a second vitest project stays unadopted.

The consequence worth naming: the collision test is an integration test against a running `wrangler dev`, not a unit test, so 4.5 owns starting and tearing that process down in CI. That is the cost of the ruling and it is smaller than a second test runner.

### 1c. Plaid's cursor semantics (SPIKE COMPLETE, 17 Aug 2026)

Invariant 2 requires a mid-sync crash to resume from the persisted cursor *"with no gap and no replay."* That is a claim about **Plaid**, not about our code, and it had never been executed. Run against Sandbox with a 48 transaction Item:

**In the quiet case the invariant holds exactly.** One page of 16, simulated crash, resume from the persisted cursor: 32 more, `overlap 0`, `missing 0`, `extra 0`. Union equals the reference drain. The cursor is also **idempotent**: presenting the same persisted cursor a second time returns the identical set, which matters because a worker that crashes after persisting and before finishing shows Plaid the same bookmark twice. A fully drained cursor synced again returns nothing and **does not move**.

**And the quiet case is not the interesting one.**

#### The finding: a cursor can be REFUSED mid-pagination

```
400 TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION
Underlying transaction data changed since last page was fetched.
Please restart pagination from last update.
```

**An intermediate cursor is not a durable resume point.** If the underlying data changes while a pagination is in flight, Plaid rejects the mid-pagination cursor and requires restarting from the last COMPLETED sync. That is not an exotic case: it is precisely what the spec's own state machine describes when it says *"queued if a webhook lands mid-sync"*. The arrow is already drawn; what was missing is that Plaid can invalidate the bookmark underneath it.

So "persist after every page" is still right, and it is **not sufficient on its own**. The pipeline needs two cursors, not one:

- **The in-flight cursor**, persisted after every page, used to resume a crash.
- **The last-completed-sync cursor**, which is the only cursor guaranteed to still be accepted after a mutation, and the fallback the error message points at.

#### It is a control-flow branch, not an error, and that distinction is load-bearing

`TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` is a **normal branch of the sync state machine**. It is not an exception, not a failure, and not something to log and re-raise.

**Why the distinction is worth this much space** (ruled 17 Aug 2026): the wrong shape is not merely inelegant, it is a specific bug that somebody writes later while believing they are fixing something. Classified as an error, this becomes an Item parked in `error`, the watchdog sweeps it back to `queued`, and it fails again identically. The obvious remedy for a sync that keeps failing is **a retry**, and a retry of the in-flight cursor is either refused again or, worse, succeeds against a cursor whose position no longer means what the caller thinks it does. **A retry here replays.** That is duplicate transactions in a household's ledger, arriving through a change that looked like reliability work and had a green suite behind it.

So it is written as a branch, its register entry proves the branch, and this paragraph exists so the next person reaching for a retry reads why not.

**This is why the spike existed.** Built from the spec as written, 4.4 would have persisted one cursor, resumed from it, and **passed every quiet test.** It would then have lost or duplicated transactions the first time a webhook landed mid-pagination in production, which is the ordinary case rather than the rare one.

#### What could not be settled, and why

**Deliberate reproduction of the mutation error is unresolved.** It was observed by accident on the first run, against an Item still generating transactions. Reproducing it on demand needs the ability to change an Item's transactions while holding an open pagination, and **Sandbox provides no such lever**: `/sandbox/transactions/create` returns `200` and does nothing on a default-user Item (proven by marker description, not by counting), and returns `400` on a `user_custom` Item. An endpoint that reports success and changes nothing is the same shape as a control that cannot fail, and a test built on it would be worthless.

The natural race was then measured over five runs against freshly created Items paginated one row at a time while Sandbox was still generating: **reproduced 3 times out of 5.**

**Flaky, therefore not a fixture.** A test that goes red 60% of the time when the code is correct is worse than an absent one, because it teaches people to re-run rather than to look, and after a fortnight nobody reads it at all.

So the branch is split the same way as pending to posted, and for the same reason:

- **Our handler is tested against a synthesised 400** carrying `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, asserting the sync falls back to the last-completed-sync cursor and completes rather than parking the Item in `error`. That is a real test of a real branch.
- **That Plaid actually emits it in the shape we assume** is not proven by that test, and the test must not be described as though it were. It was observed live on three of five runs, which is why the branch exists at all.

Recorded as an open item with an owner rather than dressed up as coverage.

#### A note on method

The first run of this spike reported `noGap: true, noReplay: true` **against two empty sets**. Sandbox had not finished generating, the helper waited for a `200` rather than for transactions, and every assertion passed vacuously. That is the ninth finding, produced by the spike written to avoid it, inside an hour of it being named in this plan. The helper now waits for a minimum count and the spike aborts rather than reporting on a fixture too small to distinguish passing from failing.

### 1d. Whether Sandbox can produce the error states

Invariant 8 lists the fixtures: `ITEM_LOGIN_REQUIRED`, item error, removed transactions, pending→posted, reversal. Sandbox has `/sandbox/item/reset_login` and `/sandbox/item/fire_webhook`, and the rest are less certain.

**This is the ninth finding waiting to happen.** If a fixture cannot construct an error state, the test for that error state is honest and vacuous, exactly like every isolation test before a household had two members. So the spike enumerates which states Sandbox can actually produce. **Any it cannot becomes a named gap with an owner on the open-items list, never a test written against a fixture that cannot fail** (ruled 17 Aug 2026).

#### The inventory (SPIKE COMPLETE, 17 Aug 2026)

**One of the five is constructible. Invariant 8 as written cannot be met.**

| Invariant 8 fixture | Constructible | Evidence |
|---|---|---|
| `ITEM_LOGIN_REQUIRED` | **YES** | `/sandbox/item/reset_login`, then `/transactions/sync` returns `ITEM_LOGIN_REQUIRED` and `/item/get` carries it in `item.error` |
| item error (`ITEM_ERROR`) | **NO** | `webhook_type has no code ERROR`. Sandbox will not fire it |
| removed transactions | **NO** | `TRANSACTIONS_REMOVED` is not a fireable code, and the `removed` stream was empty in every run against every fixture shape |
| pending to posted | **NO** | 48 transactions from the default user, **0 pending**. A `user_custom` transaction with no `date_posted` did not come back `pending` either |
| reversal | **NO** as an event | A negative amount is expressible as seed data. A Plaid reversal is not constructible |

Two mechanics worth recording, because both cost time to establish:

**Firing any webhook requires `options.webhook` on the Item.** Without it every fire returns `SANDBOX_WEBHOOK_INVALID`, which reads like an unsupported code and is not. With a webhook configured, these fire: `TRANSACTIONS:SYNC_UPDATES_AVAILABLE`, `TRANSACTIONS:DEFAULT_UPDATE`, `TRANSACTIONS:RECURRING_TRANSACTIONS_UPDATE`, `ITEM:PENDING_DISCONNECT`, `ITEM:USER_PERMISSION_REVOKED`, `ITEM:LOGIN_REPAIRED`.

**`HISTORICAL_UPDATE` is not fireable**, and spec §4 gives it real work: it *"marks backfill-complete for the intro trigger"*. That trigger is M13's, it has a 30 minute fallback, and **the webhook half of it cannot be exercised in Sandbox at all.**

#### What this does to invariant 8

Invariant 8 says these fixtures are *"all green in CI"*. Four of the five cannot be constructed, so it is not an invariant, it is a wish. Rewriting it to claim less is the honest move, and the four become named gaps.

**The one that should worry us most is pending to posted**, because unlike the other three it is not an error path. It is the **normal daily behaviour of every card transaction in the product**, categorization-spec §10 turns on it, and Sandbox cannot produce it. It will first be exercised against the founder household's real Items, which is invariant 9, which is M9. A silent double-count on the pending-to-posted transition is exactly the class of bug that reaches a household's Kept figure before anyone sees it.

**Recommendation for the register:** the pending-to-posted transition gets a test against a **hand-built fixture of our own transaction rows**, not against Plaid. It proves our reconciliation and filing logic handles the transition; it does not prove Plaid's shape is what we assumed. Those are two different claims and the test must only make the first, or it becomes the ninth finding again.

---

## 2. Two rulings, both made

### 2a. Where sync runs: a third Worker (RULED)

The spec says *"decrypted only inside the sync worker"*, and there is no sync worker. Today there are two: `api` and `conversation`. Three options:

- **A third Worker**, `marginsheet-sync`, connecting as `marginsheet_sync`. Cleanest custody boundary: the role, the key and the decryption live in one deployable that no household request reaches. Costs a third deploy target, a third set of secrets, and a third thing the deploy pipeline must verify.
- **A queue consumer inside `api`** with its own binding and connection string. Fewer moving parts; weaker boundary, because the same deployable holds both the household-facing routes and the decryption key.
- **The Durable Object itself does the sync**, since it already owns serialisation.

**Ruled: the third Worker.** The custody rules are written as though a separate sync worker exists, and putting the decryption key in the deployable that serves household requests would make the role split cosmetic, which is the thing M3 spent itself removing.

Guy's addition, which is the stronger half of the reasoning: **it makes the token-reading surface a deployable with no public routes at all.** That is a better boundary than a code path inside one that has them, because it cannot be reached by a request that takes a wrong turn.

### 2b. Production Plaid credentials: Sandbox green, then paste, then one real connection (RULED, THEN RESEQUENCED)

The same sequence as Postmark, for the same reason: **a live credential against an unproven path is the wrong order.**

**Resequenced 17 Aug 2026: the real connection happens after 4.5, not at the end of the module.** Sandbox cannot construct pending to posted, so the founder household's real institutions are the only place categorization-spec §10 is ever exercised, and discovering a mishandled settling transaction with M4 otherwise finished is a rewrite rather than a fix. See the approval block at the top of this plan for the full ordering.

---

## 3. The controls M4 ships, and how each is proven

Every one gets a register entry and a planted failure, per 3.6. Named here so the register is designed rather than retrofitted.

| Control | Proven by attempting |
|---|---|
| `provider_events` check-and-insert | a webhook retry storm produces **one** sync and zero duplicate transactions (invariant 1) |
| The DO's promise-chain lock | two concurrent webhooks for one household, **fired simultaneously**; the second must wait, not run. Planted failure removes the chain await, never the DO |
| Cursor persistence | a crash mid-sync, then resume: no gap, no replay (invariant 2) |
| **Cursor fallback on mutation** | a synthesised `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` mid-pagination: the sync restarts from the last-completed cursor and finishes, rather than parking the Item in `error` for the watchdog to sweep and re-break || **Reconciliation blocking** | induced drift beyond tolerance **blocks** that account's numbers and opens an investigation item; drift inside the settle window does not (invariant 3) |
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

**Invariant 7 needs both halves, and the behavioural half was pointed at the wrong thing until 18 Aug 2026.** A static scan catches the token being logged in code somebody writes. A behavioural probe catches it arriving somewhere through a path nobody wrote deliberately, which is how it would actually happen.

The plan said the question was whether Sentry scrubbing survives a Plaid error object carrying a token in a nested field. **Seven error classes captured from Sandbox say Plaid produces no such shape**: an identical seven-key envelope every time, no nesting, no request echo, and no credential even in the error whose subject is a bad secret. A scrubber aimed there passes forever and proves nothing.

**Amended: the token is in the REQUEST, not the response**, so the probe points at our own envelope. A retry wrapper attaching the failed request, a debug line logging `init`, an error whose serialised form carries the body. Prior art rather than hypothesis: the `postgres` driver printed a password in full into a transcript on 17 Aug, same class, already observed here.

---

## 4. Sub-tasks

- **4.0** The spike: Durable Objects, cursor semantics, Sandbox fixture inventory. Findings before design.
- **4.1** `marginsheet_sync`: the provisioning path that does not exist, and the grant narrowed from 39 tables to the 8 the pipeline needs. Enumerated, never granted-and-subtracted. The negative control attempts `messages`, `known_context` and `decision_journal`, three sections apart, because one refusal proves a boundary exists and three prove it is not a single lucky revoke.
- **4.2** Token custody: encrypt, decrypt in the sync path only, and both halves of invariant 7.
- **4.3** Link and exchange, with zombie prevention and reconnect.
- **4.4** `/transactions/sync` with **two** persisted cursors (in-flight, and last-completed-sync) and the coordination state machine. `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` is handled as a control-flow branch that falls back to the last-completed cursor, never as an error that parks the Item.
- **4.5** The DO's promise-chain lock and the webhook path through `provider_events`. Tested over HTTP against `wrangler dev`, with the collision constructed rather than hoped for.
- **4.5b** **The founder household's real institutions connect here**, on production credentials, Capital One included. This is not a validation step at the end of the module, it is the point at which pending to posted becomes observable at all. Everything after this is built with a real settling transaction available to test against.
- **4.6** Balances, snapshots, and the reconciliation invariant that blocks.
- **4.7** Recurring → `commitments` at `plaid_recurring` authority.
- **4.8** Item lifecycle: removal verified at Plaid, resync, and the no-Item-survives-cancellation rule.
- **4.9** Register entries and planted failures for every control above.

---

## 5. What M4 will not cover, stated now

- **Invariant 9 is not DISCHARGED in M4, but it is no longer untouched.** Real institutions now connect at 4.5b rather than at the end, because pending to posted is unconstructible in Sandbox and §10 needs somewhere to be exercised. What that buys is a real settling transaction to build 4.6 through 4.9 against. What it does not buy is the invariant: a full backfill and incremental sync across **every** founder institution, as M9's migration precondition, stays owed with M9 as owner.
- **Categorization is M5.** M4 delivers transactions with `pending`/`posted` semantics and the removed stream; what they mean is the next module's.
- **The Cash Flow engine is M6b.** M4 produces balance snapshots and the `as_of` those depend on, and computes nothing from them.
- **Reauth nudges stay an app banner.** Spec §8 open item 1: whether it earns a message class is a canon decision, not M4's.

---

## 6. The verification test, applied

M3 shipped ten controls that could not fail, and every one was found by trying to use the thing. M4's exposure is larger, because it is the first module that calls a paid third party and the first that decrypts anything.

The two I would watch hardest: **the sync role, which has had privileges and no connections for two weeks**, and **the Sandbox fixtures, which decide whether invariant 8's tests can express their own failure cases.** Both are shapes this build has already been caught by once.
