# M4: the household-state signal fires on three of its seven kinds

## APPROVED 22 August 2026 with rulings, and built the same day. Ruled ahead of 4d because M4 owns run-sync and the four missing kinds are the subsystems M4 built this session.

**Ruling 1: mint the sync run identity.** `gen_random_uuid()` in a NOT NULL column commented as traceability is a fabricated answer shaped like a real one, and at M13 it would be believed **because it is join-shaped**. `sync_runs` is the thirteenth table on the role, per 0023's process.

**Ruling 2: fix the counts keys now.** A mismatch that reads as zero at M13 is the looks-like-its-failure-case direction. Keys match contract kind names exactly, asserted in the fixture rather than by convention.

**Scope exception: the sweep's `item_status_changed` comes in.** A sync that failed to finish is exactly what a watcher wants. `reconnect-complete` and `disconnect` stay owed: repair events, lower value, different files.

**The defect discovered at M13 presents as a watcher that never fires**, which is the worst available distance between cause and symptom.

---

## 0. The finding, restated so the plan is checkable against it

`plaid-pipeline-spec` section 4 rules **seven** change kinds. `run-sync.ts` writes **three**, and migration 0024's `changed_kinds` CHECK constraint already enumerates all seven, so **the table has been ready since 4.4 and only the writer is partial.**

**The gate is the larger half.** The whole insert sits behind `didChange(outcome)`, which is `counts.added + counts.modified + counts.removed > 0` -- a pure function of the transaction stream. So a sync that refreshed balances, wrote snapshots, fetched liabilities and moved an Item's status, with no new transactions, **fires nothing at all.**

The spec's rule is *"a sync that changed nothing does not fire."* The implementation is *"a sync whose TRANSACTIONS did not change does not fire."* **Those are the same sentence only for the input it was written against.**

---

## 1. THE CRUX, AND IT IS NOT WIRING: EVERY SUBSYSTEM REPORTS WORK DONE, NOT CHANGE MADE

This is the part that makes the task a design decision rather than four `if` statements, and it is why the naive version is worse than the defect.

| Reporter | Returns | Means |
|---|---|---|
| `applyBalances` | `accounts`, `accountIds` | rows the UPDATE **touched** |
| `fetchLiabilities` | `accountsReported` | accounts Plaid **returned** |

**Neither can answer "did anything change."** `applyBalances` issues `set current_balance = ${current}` with no predicate on the old value, so `returning id` yields a row whether or not the figure moved. Plaid returns balances on **every page of every sync**, for every account.

**So `balances_updated` fired on `accountsRefreshed > 0` would fire on EVERY SYNC.** That does not widen the input, it **deletes the gate** -- and the gate is the thing the spec is protecting: *a watcher waking for nothing is how a watcher becomes noise.* The naive fix converts a signal that misses changes into a signal that means nothing.

**The requirement therefore stands as ruled: widen the input, do not loosen the gate.** Each new kind needs a detector that observes a **difference**, which means the write itself has to report one.

### The mechanism, and it is cheap

Add an `is distinct from` predicate to the existing UPDATE so `returning id` yields **only genuinely changed rows**:

```sql
update financial_accounts
   set current_balance = ${current}, ...
 where household_id = ${householdId}
   and plaid_account_id = ${account.account_id}
   and (current_balance is distinct from ${current}
     or available_balance is distinct from ${available}
     or credit_limit    is distinct from ${limit})
returning id
```

`is distinct from` rather than `<>` because these columns are nullable and `null <> null` is null, which would report every null-balance account as unchanged forever.

### AND IT COLLIDES WITH AMENDMENT 14, WHICH IS THE PART TO GET RIGHT

**`accountIds` currently means REFRESHED, and reconciliation depends on that meaning.** Amendment 14 scopes reconciliation to accounts whose balance was read on this sync; an account Plaid did not return has no new observation to make.

**Narrowing that same set to CHANGED would silently break it.** An account whose balance is identical to last sync was still *read*, still has a fresh observation, and must still be reconciled -- and it is exactly the account where drift would be most suspicious.

**These are two facts and they need two sets**, which is this file's one-value-two-facts rule arriving before the value exists rather than after:

- `refreshedAccountIds` -- read this sync. **Reconciliation's input. Unchanged.**
- `changedAccountIds` -- moved this sync. **The signal's input. New.**

The UPDATE above returns the second. The first needs a `returning id` that is **not** narrowed, so the statement is split or the predicate moves into a `case`. **Recommendation: keep one UPDATE without the predicate, and compare old to new by selecting the row first**, because a single statement that must report two different populations is the conflation restated. Costs one extra read per account per page; the alternative costs the reconciliation invariant.

---

## 2. THE SEVEN KINDS

| Kind | Written today | Detector | Where it becomes known | Payload |
|---|---|---|---|---|
| `transactions_added` | **yes** | `outcome.added > 0` | after the stream loop | count |
| `transactions_modified` | **yes** | `outcome.modified > 0` | after the stream loop | count |
| `transactions_removed` | **yes** | `outcome.removed > 0` | after the stream loop | count |
| `balances_updated` | no | accounts whose balance **moved**, per section 1 | `applyBalances`, per page, accumulated | count of accounts |
| `liabilities_updated` | no | accounts whose liability detail **moved** | `fetchLiabilities` | count of accounts |
| `item_status_changed` | no | `onSyncComplete(item.sync_status) !== item.sync_status` | the status UPDATE, already computed | count 1, **no status name** |
| `recurring_updated` | no | **nothing fetches recurring** | -- | **out of scope, see below** |

### `recurring_updated` is NOT in this task, deliberately

Nothing in the repository calls Plaid's recurring endpoints. **Building a detector for a fetch that does not exist is the announcer error inverted**: wiring a producer whose subject is absent, rather than a consumer. It belongs to the recurring ruling, and this plan recommends it stay there and be named in the open item rather than stubbed here.

### `item_status_changed` scope, which is a real choice

`run-sync`'s own transition is in scope and cheap: both values are already in hand three lines above the insert.

**Three OTHER writers move `sync_status` and are each their own transaction:** the watchdog's sweep (`swept`), `reconnect-complete` (`healthy`), and disconnect. **The sweep in particular is a household-visible state change the watcher would want** -- a sync that failed to finish. Firing from those means each opens its own signal write, which is a larger change than this task.

**Recommendation: run-sync's transition now, the other three recorded as owed**, with the reason stated rather than left to look like an oversight.

### What the payload carries, in all cases

**Counts only.** No amounts, no balances, no account names, no status strings. `item_status_changed` carries a count and **not which status**, because a status name is a fact about the household's connection that the row itself holds and the consumer reads under RLS. The boundary argument from 0024's header is unchanged: **none of the column privileges, policies or `household_isolation` travels with a message.**

---

## 3. THE GATE'S REPLACEMENT

`didChange(counts: StreamCounts)` is replaced by a function over **what the sync did**, not over one stream:

```ts
interface SyncChanges {
  added: number; modified: number; removed: number;
  balancesChanged: number;
  liabilitiesChanged: number;
  itemStatusChanged: boolean;
}
export function changedKinds(c: SyncChanges): string[]
```

**Fire if and only if `changedKinds(c)` is non-empty.** The spec's rule survives intact: a sync that truly changed nothing produces an empty array and writes no row.

**And the database agrees with the gate rather than restating it.** 0024's `changed_not_empty` CHECK already refuses an empty array, so a future bug that fires on nothing is **refused by Postgres** rather than writing a meaningless signal. Two mechanisms, and the second is not a copy of the first: the gate decides not to write, the constraint makes writing-nothing impossible.

`didChange` itself is deleted rather than left beside its replacement, so there is no second gate for a caller to reach for.

---

## 4. FIXTURE REQUIREMENT, ASSERTED BEFORE ANYTHING IS BUILT

**THE CASE IS THE NO-NEW-TRANSACTIONS-BUT-BALANCES-CHANGED SYNC.** It is the one that fires nothing today and must fire after, and **a fixture of transaction-bearing syncs cannot fail** -- it would pass against the current code, which is the degenerate-coverage rule exactly.

Four fixtures, and the first two are the ones that mean anything:

1. **Balances moved, zero transactions.** Must fire, `changed = ['balances_updated']`. **Red against today's code.**
2. **Nothing moved at all**: same balances, zero transactions, same status. **Must fire nothing.** This is the fixture that catches the naive fix, and it is the one that would pass if `balances_updated` were keyed on rows touched -- so it must be shown to fail against that mutation specifically.
3. Liabilities moved, nothing else.
4. Status moved, nothing else.

**Minimal-mutation proof on fixture 1:** revert the balance detector alone and confirm the pass disappears. **Planted failure on fixture 2:** key `balances_updated` on `accountsRefreshed > 0` and require fixture 2 to redden -- that is the plausible-and-wrong mutation, since it reads as the obvious implementation and is what a reasonable engineer would write first.

**Fixtures 1 and 2 must be database tests, not recorder tests.** A recorder proves the statement was constructed; `is distinct from` semantics against nullable columns is precisely the kind of claim only Postgres can settle.

---

## 5. THE THREE WRITTEN KINDS' PAYLOADS, CHECKED WHILE IN THERE

Asked because partial writes have been wrong in shape before. **Two mismatches, one cosmetic and one not.**

**(a) The counts keys do not match the kind names.** `changed` holds `transactions_added`; `counts` holds `{ added, modified, removed }`. A consumer doing the obvious `counts[kind]` gets `undefined` for every kind. Nothing breaks today because nothing reads it, and it will break silently at M13 in the direction that looks like zero. **Recommend keying counts by kind name**, so `counts['transactions_added']` resolves and the two columns describe each other.

**(b) `source_sync_run_id` is `gen_random_uuid()` and traces to nothing.** The column is `NOT NULL`, its comment says *"which Item and which sync run produced this"*, and **there is no sync run identity anywhere in this system.** A fresh random uuid per signal cannot be joined to any row, any log line, or any other signal from the same sync.

**It is a field whose normal case is indistinguishable from its failure case**, and worse, it looks like a foreign key. A reader at M13 correlating signals by sync run gets one group per signal and no error. **Options, and this one needs a ruling rather than a recommendation:** mint a real run id at the top of `runSync` and thread it (small, and makes multi-Item syncs correlatable), or drop the column and stop claiming traceability the system cannot provide. **I lean to the first**, because the sweep already has `sweep_runs` and a sync with no identity is a gap in more places than this.

---

## 6. WHAT THIS PLAN DOES NOT DO

- **No announcer.** Ruled 22 Aug; the consumer is M13's watcher and the in-database outbox is the spec's resting position.
- **No recurring detector.** No fetch exists.
- **No signal from the sweep, reconnect-complete or disconnect.** Recorded as owed, with the reason.
- **No change to reconciliation's input.** `refreshedAccountIds` keeps its meaning; the changed set is a second value beside it, never a narrowing of it.


---

## 7. WHAT THE BUILD CHANGED FROM THE PLAN, AND WHAT IT FOUND

**The marker and the run are unified in one transaction, and the tables stay separate.** The question was asked rather than assumed. `plaid_items.sync_status` plus `sync_started_at` is the Item's **current state**: one row, overwritten, read by the watchdog on a timer. `sync_runs` is **history**: one row per run, never overwritten. Folding them makes the watchdog scan an unbounded history for open rows instead of reading a column on the row it already holds, which is a worse query for the one thing that runs on a schedule. **So they are separate, both are written in the marker's single committed transaction, and `sync-run-agrees-with-the-marker` reconciles them** rather than leaving two hand-written statements of one fact to drift.

**`outcome` was added, because `completed_at` alone conflates two facts.** A run that finished and a run the watchdog gave up on both have an end time, and they are opposite events. The sweep closes the run it abandons as `'swept'`, **and only after the Item's status update has been shown to land** -- closing it first would label a run abandoned that had in fact finished cleanly in the window the status predicate exists to lose safely.

**`source_sync_run_id` became nullable, with a foreign key.** NULL means no run was recorded, which is strictly more honest than a random uuid asserting a run that never existed. The foreign key is what makes the column's claim checkable rather than merely intended.

### AND THE BUILD FOUND A LIVE PRODUCTION DEFECT IN THE SWEEP

**The watchdog swept nothing from the moment its cron went live.** `sync_worker_write` on `plaid_items` reads `current_setting`, and the scheduled handler opens its transaction with no household declared -- correctly, since a sweep spans every household. The UPDATE evaluated against NULL, matched no rows, and raised nothing. It reported `items_swept: 0`, **which its own migration documents as the normal case**, so total failure and perfect health rendered identically.

**Two scans were pointed at this and neither could see it.** `every-write-declares-a-household` accepts a statement naming `household_id`, and this one does; the GUC presence scan wants a file that both opens a connection and holds a write, and here `index.ts` opens while `sweep.ts` writes. **A scan that tests a property of a FILE cannot see an obligation that belongs to a PATH.**

**And the fixture supplied what production omitted.** `sweep.test.ts` set the GUC itself before calling the sweep, so it proved the function works *when given a declared transaction* while nothing proved the real caller gives it one. It now calls the sweep exactly as the scheduled handler does. The control gap that let this through is recorded as its own open item, because correcting the scan's `||` to `&&` flags every helper that legitimately receives a `tx`, and that is a design change rather than a fix.
