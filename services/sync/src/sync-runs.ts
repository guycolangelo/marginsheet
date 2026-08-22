// A sync run's identity, and the counts that describe it once it is over.
//
// household_state_signals.source_sync_run_id is NOT NULL and its comment
// promises "which sync run produced this". Until now run-sync passed
// gen_random_uuid(), so the column held a value that joins to nothing: not to a
// log line, not to another signal from the same run, not to anything. A
// consumer grouping signals by run gets one group per signal and no error.
//
// THE OPEN ROW IS WRITTEN IN THE MARKER'S TRANSACTION, which commits before the
// work starts. A record of an attempt that lives inside the transaction whose
// failure it records is rolled back by that failure, which is the one
// circumstance it exists for.

import type { Tx } from "./apply-streams.js";

/** What a finished run did. Counts only: no amounts, no balances, no names. */
export interface RunCounts {
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  /** Accounts whose balance was READ. Amendment 14's reconciliation population. */
  accountsRefreshed: number;
  /** Accounts whose balance MOVED. The signal's population, and a different set. */
  balancesChanged: number;
  liabilitiesChanged: number;
  pages: number;
  restarts: number;
}

/** Opens a run and returns its id.
 *
 *  CALLED FROM THE MARKER'S TRANSACTION so the row and the Item's status commit
 *  together. started_at here and plaid_items.sync_started_at are two statements
 *  of one fact; writing them in one transaction is what lets
 *  sync-run-agrees-with-the-marker reconcile them rather than hope. */
export async function openSyncRun(tx: Tx, householdId: string, itemRowId: string): Promise<string> {
  const rows = (await tx`
    insert into sync_runs (household_id, plaid_item_id)
    values (${householdId}, ${itemRowId})
    returning id
  `) as { id: string }[];
  return rows[0].id;
}

/** Closes a run with what it did.
 *
 *  RETURNS ROWS ACTUALLY UPDATED rather than asserting success, so a run id
 *  belonging to another household closes nothing and says so. The predicate
 *  names the household because the statement should be correct even where the
 *  policy is not. */
export async function closeSyncRun(
  tx: Tx,
  householdId: string,
  runId: string,
  c: RunCounts
): Promise<number> {
  const rows = (await tx`
    update sync_runs
       set completed_at = now(),
           outcome = 'completed',
           transactions_added = ${c.transactionsAdded},
           transactions_modified = ${c.transactionsModified},
           transactions_removed = ${c.transactionsRemoved},
           accounts_refreshed = ${c.accountsRefreshed},
           balances_changed = ${c.balancesChanged},
           liabilities_changed = ${c.liabilitiesChanged},
           pages = ${c.pages},
           restarts = ${c.restarts}
     where id = ${runId}
       and household_id = ${householdId}
       and completed_at is null
    returning id
  `) as { id: string }[];
  return rows.length;
}
