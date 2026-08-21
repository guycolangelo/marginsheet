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

/** One transaction as Plaid reports it, narrowed to what M4 stores.
 *
 *  M4 stores FACTS AND NOTHING DERIVED. category_id, pl_line, review_state,
 *  confidence, `direction` and the transfer fields are M5's, and writing a
 *  guess into them here would be a filing decision made by the pipeline.
 *
 *  THIS COMMENT ONCE CARVED OUT ONE EXCEPTION AND THE EXCEPTION WAS THE DEFECT.
 *  It read: "`direction` is the one judgement call and it is arithmetic rather
 *  than interpretation: Plaid signs outflows positive, so a positive amount is
 *  an expense." The premise is true. The conclusion is a filing. A deposit from
 *  ADP and a deposit from Joint Savings are the SAME FACT and DIFFERENT
 *  FILINGS, and no amount of arithmetic separates them, so 520 internal vault
 *  transfers were stored as income and 56 card credits as income on cards.
 *
 *  The rule stated above would have prevented it. A rule with one exemption is
 *  how this class arrives, and the exemption always has a reason or nobody
 *  would have written it. `flow` is the fact M4 is entitled to write. */
export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  merchant_name?: string | null;
  name?: string | null;
  pending?: boolean;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
  payment_meta?: unknown;
  counterparties?: unknown;
}

/** Plaid signs money LEAVING the account positive, on depository and credit
 *  accounts alike, so this is a FACT and not an interpretation.
 *
 *  It is the whole of what M4 may say about which way the money went. What that
 *  movement MEANS is `direction`, and M5 writes it. */
function flowOf(amount: number): "inflow" | "outflow" {
  return amount > 0 ? "outflow" : "inflow";
}

/** Writes added and modified transactions for ONE household.
 *
 *  ONE STATEMENT FOR BOTH STREAMS, deliberately. `modified` is how a PENDING row
 *  becomes POSTED, which is the transition categorization-spec section 10 turns
 *  on and the one thing Sandbox could never construct. An insert-or-update on
 *  the same conflict target handles both, and splitting them would create two
 *  places for the settle to be got wrong.
 *
 *  THE HOUSEHOLD IS NAMED IN THE STATEMENT, NOT ONLY IN THE POLICY.
 *  plaid_transaction_id is PLAID's namespace and is shared across every
 *  household: two households on one joint account see the same id. Migration
 *  0026 constrains this role to the declared household, and that is the
 *  backstop rather than the mechanism. Both hold independently, which is the
 *  reason the removed-stream predicate landed before the policy did.
 *
 *  ACCOUNT IDS ARE RESOLVED WITHIN THE HOUSEHOLD for the same reason: Plaid's
 *  account id is Plaid's, so the lookup that turns it into ours is scoped.
 *
 *  Returns rows actually written, not rows offered. The two differ when a
 *  transaction names an account this household does not hold, and a caller that
 *  cannot see the difference cannot notice the case. */
export async function applyAddedAndModified(
  tx: Tx,
  householdId: string,
  transactions: PlaidTransaction[]
): Promise<number> {
  if (transactions.length === 0) return 0;
  let written = 0;

  for (const t of transactions) {
    const rows = await tx`
      insert into transactions (
        household_id, account_id, plaid_transaction_id, date, authorized_date,
        amount, iso_currency, merchant_name, original_description, flow,
        account_type, plaid_pfc_primary, plaid_pfc_detailed, pending
      )
      select
        ${householdId}, fa.id, ${t.transaction_id}, ${t.date}::date,
        ${t.authorized_date ?? null}::date, ${Math.abs(t.amount)},
        ${t.iso_currency_code ?? null}, ${t.merchant_name ?? null},
        ${t.name ?? null}, ${flowOf(t.amount)}::money_flow,
        fa.type, ${t.personal_finance_category?.primary ?? null},
        ${t.personal_finance_category?.detailed ?? null}, ${t.pending ?? false}
      from financial_accounts fa
      where fa.household_id = ${householdId}
        and fa.plaid_account_id = ${t.account_id}
      on conflict (plaid_transaction_id) do update
        set date = excluded.date,
            authorized_date = excluded.authorized_date,
            amount = excluded.amount,
            merchant_name = excluded.merchant_name,
            original_description = excluded.original_description,
            flow = excluded.flow,
            plaid_pfc_primary = excluded.plaid_pfc_primary,
            plaid_pfc_detailed = excluded.plaid_pfc_detailed,
            -- THE SETTLE. A modified row arriving with pending=false is a
            -- pending transaction becoming posted, and it must land on the
            -- SAME row rather than creating a second one.
            pending = excluded.pending,
            updated_at = now()
        where transactions.household_id = ${householdId}
      returning id
    `;
    written += rows.length;
  }
  return written;
}

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
