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

/** Flags removed transactions. NEVER deletes. */
export async function applyRemoved(tx: Tx, plaidTransactionIds: string[]): Promise<number> {
  if (plaidTransactionIds.length === 0) return 0;
  // UPDATE, and there is no code path here that deletes. The spec's phrase is
  // "flag, never delete", and a DELETE would also make the removed stream
  // irreversible: Plaid can report a transaction removed and later report it
  // again, and a flag can be cleared where a deleted row cannot be recovered.
  await tx`
    update transactions
       set removed = true, updated_at = now()
     where plaid_transaction_id = any(${plaidTransactionIds})
  `;
  return plaidTransactionIds.length;
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
