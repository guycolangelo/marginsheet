// The household-state-changed signal: the seven kinds, the gate, and the write.
//
// THE CONTRACT LIVES HERE RATHER THAN INLINE IN run-sync, because it is now
// written from two places (a completed sync, and the watchdog's sweep) and a
// contract restated in two callers is two statements of one fact.
//
// WHAT WENT WRONG BEFORE, recorded because the shape recurs. The gate was
// didChange(outcome), a pure function of the TRANSACTION stream, so a sync that
// refreshed balances, wrote snapshots, fetched liabilities and moved an Item's
// status with no new transactions FIRED NOTHING AT ALL. The spec's rule is "a
// sync that changed nothing does not fire"; the implementation was "a sync
// whose transactions did not change does not fire", and those are the same
// sentence only for the input it was written against.
//
// THE FIX IS TO WIDEN THE INPUT, NEVER TO LOOSEN THE GATE. Keying
// balances_updated on accounts REFRESHED would have fired on every sync, since
// Plaid returns balances on every page of every sync: that does not widen
// anything, it deletes the gate, and the gate is what the spec is protecting.
// A watcher waking for nothing is how a watcher becomes noise.

import type { Tx } from "./apply-streams.js";

/** Every kind plaid-pipeline-spec section 4 names, and nothing else.
 *
 *  Migration 0024's changed_kinds CHECK carries the same list. That is not a
 *  duplicate statement to be derived away: this one decides what we write and
 *  the constraint decides what the database will hold, and an unrecognised kind
 *  should be refused at both ends. */
export const SIGNAL_KINDS = [
  "transactions_added",
  "transactions_modified",
  "transactions_removed",
  "balances_updated",
  "item_status_changed",
  "recurring_updated",
  "liabilities_updated",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** What a sync actually did, which is what the gate reads.
 *
 *  recurring_updated has no field, deliberately: NOTHING FETCHES RECURRING.
 *  A detector for an absent fetch is the announcer error inverted, wiring a
 *  producer whose subject does not exist rather than a consumer, and it would
 *  be a field that can only ever read zero. It belongs to the recurring ruling. */
export interface SyncChanges {
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  /** Accounts whose balance MOVED, never accounts refreshed. */
  balancesChanged: number;
  /** Accounts whose liability detail MOVED, never accounts reported. */
  liabilitiesChanged: number;
  itemStatusChanged: boolean;
}

/** The kinds this run changed. Empty means nothing happened worth waking for. */
export function changedKinds(c: SyncChanges): SignalKind[] {
  const kinds: SignalKind[] = [];
  if (c.transactionsAdded > 0) kinds.push("transactions_added");
  if (c.transactionsModified > 0) kinds.push("transactions_modified");
  if (c.transactionsRemoved > 0) kinds.push("transactions_removed");
  if (c.balancesChanged > 0) kinds.push("balances_updated");
  if (c.liabilitiesChanged > 0) kinds.push("liabilities_updated");
  if (c.itemStatusChanged) kinds.push("item_status_changed");
  return kinds;
}

/** Counts KEYED BY THE KIND NAME, so `counts[kind]` resolves.
 *
 *  The first version wrote { added, modified, removed } beside a `changed`
 *  array holding `transactions_added`, so the obvious consumer read
 *  counts[kind] and got undefined for every kind. Nothing broke, because
 *  nothing reads it yet, AND IT WOULD HAVE BROKEN SILENTLY AT M13 IN THE
 *  DIRECTION THAT LOOKS LIKE ZERO, which is the worst direction available for a
 *  number a watcher uses to decide whether something is material.
 *
 *  Only kinds that fired appear. A kind with a zero count is not in `changed`,
 *  so a zero here would be a count of something that did not happen. */
export function countsByKind(c: SyncChanges): Record<string, number> {
  const counts: Record<string, number> = {};
  if (c.transactionsAdded > 0) counts.transactions_added = c.transactionsAdded;
  if (c.transactionsModified > 0) counts.transactions_modified = c.transactionsModified;
  if (c.transactionsRemoved > 0) counts.transactions_removed = c.transactionsRemoved;
  if (c.balancesChanged > 0) counts.balances_updated = c.balancesChanged;
  if (c.liabilitiesChanged > 0) counts.liabilities_updated = c.liabilitiesChanged;
  // ONE ITEM, NOT WHICH STATUS. A status name is a fact about the household's
  // connection, and the consumer reads the row under RLS to learn it. None of
  // the column privileges, none of the policies and not household_isolation
  // travels with a message.
  if (c.itemStatusChanged) counts.item_status_changed = 1;
  return counts;
}

/** Writes the signal, or returns null when nothing changed.
 *
 *  THE GATE DECIDES NOT TO WRITE; 0024's changed_not_empty CHECK MAKES WRITING
 *  NOTHING IMPOSSIBLE. Those are not copies of each other: one is a decision
 *  taken here with the counts in hand, the other is a property the database
 *  holds whatever any caller believes. A future bug that fires on nothing is
 *  refused by Postgres rather than storing a signal that means nothing. */
export async function writeStateSignal(
  tx: Tx,
  householdId: string,
  itemRowId: string,
  syncRunId: string | null,
  changes: SyncChanges
): Promise<string | null> {
  const kinds = changedKinds(changes);
  if (kinds.length === 0) return null;

  const rows = (await tx`
    insert into household_state_signals
      (household_id, source_plaid_item_id, source_sync_run_id, changed, counts)
    values (
      ${householdId}, ${itemRowId}, ${syncRunId}, ${kinds},
      ${JSON.stringify(countsByKind(changes))}::jsonb
    )
    returning signal_id
  `) as { signal_id: string }[];
  return rows[0].signal_id;
}
