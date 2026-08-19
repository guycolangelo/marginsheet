// Applying the added, modified and removed streams (M4 task 4.4.4).
//
// TWO RULES, BOTH OF WHICH FAIL SILENTLY IF BROKEN.
//
// REMOVED FLAGS, NEVER DELETES. plaid-pipeline-spec section 4 says so and the
// reason is the books: a household's history survives a bank disconnection, a
// re-categorisation, and Plaid deciding a transaction it once reported no
// longer exists. A DELETE here loses a row nobody can reconstruct, and the
// household would see a month's Kept figure change with no record of why.
//
// first_sync_completed_at IS SET ONCE. It feeds the M13 intro trigger and the
// day-3-to-5 census scheduling, so moving it re-arms things that already fired.
// The household would be introduced to MyKeeper twice. The guard is a WHERE
// clause rather than a read-then-write, because a read-then-write races with
// two syncs finishing together and the whole point of this field is that it
// happens once.

export interface StreamCounts {
  added: number;
  modified: number;
  removed: number;
}

/** Minimal tagged-template shape, so callers own the transaction. */
export type Tx = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/** Flags removed transactions for ONE household. NEVER deletes.
 *
 * THE HOUSEHOLD IS A PARAMETER BECAUSE THE STATEMENT MUST BE CORRECT WITHOUT
 * ROW-LEVEL SECURITY, and on this path there is none. `sync_worker_access` is
 * `USING (true) WITH CHECK (true)` for `marginsheet_sync` (migration 0008), so
 * the household GUC constrains nothing here and never did.
 *
 * CONFIRMED, NOT SUSPECTED. On 19 Aug 2026 this statement, issued as household
 * A with A's GUC set and read back inside the transaction, flagged household
 * B's transaction `removed` and threw nothing:
 *
 *   household A flagged household B's transaction as removed. threw=nothing.
 *
 * WHY THIS ONE MATTERS MOST OF THE FOUR. `plaid_transaction_id` is Plaid's, it
 * is globally unique in our schema, and two households sharing a bank login see
 * the same account. The other three findings corrupt a CONNECTION, which is
 * eventually visible as a broken sync. THIS WRITES TO THE LEDGER: `removed`
 * decides what a household is told they spent, so a false flag is wrong data in
 * a close, arriving through an ordinary removed-stream batch, with no error
 * anywhere.
 *
 * Returns the number of rows ACTUALLY FLAGGED, not the number of ids offered.
 * Those differ exactly when an id belongs to somebody else, and the caller
 * should be able to tell.
 */
export async function applyRemoved(
  tx: Tx,
  householdId: string,
  plaidTransactionIds: string[]
): Promise<number> {
  if (plaidTransactionIds.length === 0) return 0;
  // UPDATE, and there is no code path here that deletes. The spec's phrase is
  // "flag, never delete", and a DELETE would also make the removed stream
  // irreversible: Plaid can report a transaction removed and later report it
  // again, and a flag can be cleared where a deleted row cannot be recovered.
  const rows = await tx`
    update transactions
       set removed = true, updated_at = now()
     where household_id = ${householdId}
       and plaid_transaction_id = any(${plaidTransactionIds})
    returning id
  `;
  return rows.length;
}

/** Sets first_sync_completed_at, ONCE, for this household.
 *
 * Returns whether this call was the one that set it. */
export async function markFirstSyncCompleted(tx: Tx, householdId: string): Promise<boolean> {
  // THE GUARD IS IN THE WHERE CLAUSE. A read-then-write would race: two Items
  // finishing their first sync at the same moment both read NULL and both
  // write, and the second write moves a timestamp that other modules treat as
  // immutable. Here the second UPDATE matches no rows.
  const rows = await tx`
    update households
       set first_sync_completed_at = now(), updated_at = now()
     where id = ${householdId}
       and first_sync_completed_at is null
    returning id
  `;
  return rows.length > 0;
}

/** Whether this sync changed anything, which decides if the signal fires. */
export function didChange(counts: StreamCounts): boolean {
  return counts.added + counts.modified + counts.removed > 0;
}
