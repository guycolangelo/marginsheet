# M4 Task 4.4, `/transactions/sync`
## Drafted for Guy's approval, 18 August 2026. Nothing executes until approved.
## Governing doc: `plaid-pipeline-spec.md` §3 and §4, both as amended. Contract for the signal ruled 18 Aug.

---

## 0. What the spikes already settled, so this plan does not re-argue it

- **Two cursors, not one.** A mid-pagination cursor can be refused. `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` is a **control-flow branch, not an error**, and the fallback is the last-completed-sync cursor. Handled as an error it parks the Item, the watchdog sweeps it, it fails identically, and the obvious remedy is a retry: **a retry of the in-flight cursor replays.**
- **A Durable Object is not a lock.** The chain lock is 4.5 and this task does not assume serialisation exists yet.
- **The signal's contract is ruled.** Thin, no financial data, fires only on change.
- **Pending to posted is unconstructible in Sandbox.** Tested against a hand-built fixture of our own rows, and that test proves our filing logic rather than Plaid's shape.

---

## 1. Transport for the signal: the argument, made rather than inherited

Three options. The third is what I propose, and it is neither of the two the ruling anticipated.

### A queue alone

Cloudflare Queues gives delivery guarantees and no poller, which matters because the conversational spec says the watcher is **event-driven, never polling**.

**Rejected on the boundary argument.** The payload leaves the database, and every protection this module built stops at that edge. Even a thin payload puts `household_id` plus a set of change kinds into a message store, and the thinness is then the only thing protecting it. The ruling's own note applies: the further the payload travels, the more work thinness is doing.

### An outbox alone

A row written in the same transaction as the data change. Atomic by construction, idempotent by unique index on `signal_id` rather than by convention, and it never leaves the boundary. Same shape as `provider_events`.

**Rejected on one point the ruling does not cover**: something has to read it, and a reader on an interval **is polling**, which the conversational spec forbids in terms. An outbox alone trades the boundary problem for the thing the watcher spec exists to rule out.

### An outbox whose notification carries only a row id (PROPOSED)

The signal is written to an outbox table inside the sync transaction. A queue message is then enqueued carrying **`signal_id` and nothing else**.

- **Nothing household-specific crosses the boundary.** Not amounts, not change kinds, not even `household_id`. A `signal_id` is an opaque identifier that grants nothing: the consumer must read the row, as `marginsheet_app`, with the GUC set, subject to every policy. **The boundary argument is fully satisfied rather than mitigated.**
- **No polling.** The queue is the wake-up, so the watcher is event-driven as specified.
- **Idempotency is a unique index**, and the consumer marking a signal handled is a row update inside the same boundary.
- **Atomicity is honest about its one seam.** The outbox row and the data change commit together; the enqueue happens after commit and can fail. That leaves an unclaimed row, not a lost change, and a Cron sweep for unclaimed outbox rows older than a threshold closes it. **That sweep is not polling for changes; it is a repair path for a dropped notification**, which is a different thing and worth stating so it is not later mistaken for the poller we rejected.

**The cost, accepted:** two mechanisms instead of one, and a sweep that must exist or a dropped enqueue is silent. Named because a plan claiming a free win is usually hiding this.

---

## 2. The coordination state machine

`idle → syncing → (queued if a webhook lands mid-sync) → immediate follow-up from the just-persisted cursor → idle`, `error` on failure. Ported.

**Where it interacts with the two cursors, which the ported version could not know:** the follow-up runs from the **last-completed** cursor, not the in-flight one, because a webhook landing mid-sync is exactly the mutation that invalidates the in-flight cursor. The ported design would resume from the position most likely to be refused.

**The watchdog** sweeps `syncing` Items older than a threshold back to `queued`. It must not sweep an Item that is legitimately mid-pagination on a large backfill, so the threshold is measured from **last cursor persistence** rather than from sync start. A first backfill of 20,000 transactions is not stuck.

---

## 3. Invariants and how each is attempted

| Invariant | Attempted by |
|---|---|
| 2, resume with no gap and no replay | crash after page N, resume, compare the union against a clean drain |
| 2's mutation branch | a synthesised 400, asserting fallback to the last-completed cursor and completion, **not** an Item parked in `error` |
| The signal fires only on change | a sync returning an empty page, asserting **no** outbox row |
| The signal carries no financial data | an enumeration of the payload's fields, same shape as `api-never-holds-access-token` |
| The queue message carries only an id | an enumeration, because a `household_id` added there is the boundary breach and nothing else would notice |
| Watchdog threshold | an Item mid-backfill with a recent cursor write is **not** swept |
| `first_sync_completed_at` set once | a second sync, asserting the timestamp did not move |

---

## 4. Sub-tasks

- **4.4.1** The outbox table and the signal writer, in one migration, with the unique index on `signal_id`.
- **4.4.2** `/transactions/sync` with both cursors persisted and the mutation branch as control flow.
- **4.4.3** The coordination state machine and the watchdog, threshold measured from cursor persistence.
- **4.4.4** Added, modified and removed streams; `first_sync_completed_at`.
- **4.4.5** The enqueue, the sweep for unclaimed rows, and the payload enumerations.
- **4.4.6** Register entries. **CLOSED BY INSPECTION, 18 Aug 2026, because they were written alongside each control.** Six entries, all built and all verified through the harness:

  | Entry | What its mutation breaks |
  |---|---|
  | `mutation-branch-does-not-replay` | retries the refused cursor, which replays |
  | `watchdog-measures-progress` | measures from sync start, sweeping healthy backfills |
  | `removed-flags-never-deletes` | deletes instead of flagging |
  | `first-sync-milestone-set-once` | drops the IS NULL guard, re-arming the intro |
  | `sweep-is-blind-to-unannounced-rows` | drops the enqueued_at clause, making it a poller |
  | `counter-sees-unannounced-rows` | inverts it, so its silence means nothing |

  **This is the second module where 4.x.6 shrank to nothing**, and that is the rule working rather than a task being skipped. A batch of mutations at the end is written by somebody reconstructing what the break should be, and **the direction of the break is the part that needs the context the author still has.** Four fixture defects this week were caught by planting at the moment the test was written; none was caught by review.

---

## 5. What 4.4 will not cover

- **No serialisation.** The chain lock is 4.5, so 4.4's tests must not assume two syncs cannot overlap; where that matters they construct the collision and 4.5 makes it pass.
- **No categorization.** Transactions arrive with `pending`/`posted` semantics; what they mean is M5.
- **No watcher.** 4.4 emits the signal. **The consumer is M13, and the time-based half of the watcher's input does not exist at all**, so a green 4.4 is not a working watcher.
- **Pending to posted against real Plaid** is invariant 9, at M9.

---

## 6. The question I would rather ask than infer

**Does the outbox row live in the nine tables `marginsheet_sync` may reach, or a tenth?** It must be written by the sync role, so it needs a grant. Migration 0023 enumerated nine deliberately, and adding a tenth is the exact drift `sync-grant-enumeration` exists to catch: that control will go red, correctly, and the fix is to add the table by name to 0023's successor, to `EXPECTED_TABLES` in `sync-db-url.mts`, and to the register entry's knowledge. **I would rather confirm that is the intended path than quietly widen a boundary three controls are watching.**
