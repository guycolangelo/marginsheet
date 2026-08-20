// The readout's four statements, in a module so a test can run THE SAME ONES.
//
// IT LIVES IN THE SYNC WORKER, AND THAT IS THE RULING RATHER THAN A DETAIL
// (Guy, 20 Aug 2026). The first version ran in api and threw "permission denied
// for table plaid_items". The message misleads: marginsheet_app HAS plaid_items,
// as eleven enumerated columns from 0002 plus last_completed_cursor from 0025.
// What it does not have is last_cursor_at, which migration 0027 added and
// granted to nobody. 0002's comment promised exactly that: "a column added
// later is not silently readable by this role". THE ENUMERATION WORKED AND THE
// STATEMENT REACHED PAST IT.
//
// THE FIX IS NOT A GRANT. This reads plaid_items, financial_accounts,
// transactions and institutions and calls Plaid, which is the sync Worker's
// shape and not api's. Moving it widens nothing; granting api the table to fix
// a DIAGNOSTIC would be the worst available reason to touch a boundary that
// took a day to establish. api proxies over the service binding instead.
//
// AND IT IS NOW COVERED BY sync-worker-reach.test.ts, which derives every
// column the sync Worker's SQL touches and compares it against what
// marginsheet_sync actually holds. The class that produced this failure is
// checked in CI for this Worker, which is why the statements belong here and
// not in the one Worker where nothing checks them.
//
// WHY THEY ARE NOT INLINE IN index.ts ANY MORE. The readout shipped on 20 Aug
// 2026, its typecheck passed, 230 unit tests passed, and the Ledger readout
// button returned `{}`. NONE OF THOSE TESTS EVER RAN THESE STATEMENTS AGAINST A
// DATABASE: they were four SQL literals nothing executed, so a syntax error or
// a missing privilege was invisible until a person clicked a button in
// production.
//
// THAT IS THE THIRD TIME TODAY. last_cursor_at was a column no migration
// created; households was a table no grant covered; this is a statement nothing
// ran. All three passed their own suites, and all three surfaced on a real run,
// because a recorder or a typecheck proves a statement was CONSTRUCTED and
// proves nothing about whether it can EXECUTE.
//
// A TEST THAT COPIED THESE QUERIES WOULD DRIFT FROM THEM, which is the other
// half of why this module exists: two hand-written statements of one fact drift
// by default, so the test imports this function rather than restating its SQL.

/** The narrow slice of postgres.js this module needs. */
export type Sql = {
  <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export interface AccountRow {
  plaid_account_id: string; name: string | null; mask: string | null;
  type: string | null; subtype: string | null; institution: string | null;
  held: number; oldest: string | null; newest: string | null;
  oldest_authorized: string | null; pending: number; removed: number;
}
export interface TypeRow { type: string | null; accounts: number; held: number; oldest: string | null }
export interface ItemRow {
  item_id: string; sync_status: string | null; status: string | null;
  sync_cursor: string | null; last_completed_cursor: string | null;
  last_cursor_at: string | null; last_successful_sync: string | null;
}
export interface HouseholdRow {
  first_sync_completed_at: string | null;
}

export interface Readout {
  accounts: AccountRow[];
  byType: TypeRow[];
  items: ItemRow[];
  household: HouseholdRow | null;
  cursors: Array<{ itemId: string; equal: boolean; inFlightPresent: boolean; lastCompletedPresent: boolean }>;
}

/** Reads everything the readout reports from OUR tables.
 *
 *  IT TAKES A TRANSACTION, NOT A CONNECTION, AND THAT IS LOAD-BEARING.
 *  set_config's third argument is is_local: the setting reverts at the end of
 *  the current transaction, and outside an explicit one every statement IS its
 *  own transaction, so the GUC would be gone before the next query ran. Passing
 *  a connection here would leave every policy reading an unset household.
 *
 *  The queries do not DEPEND on that, because each names the household in its
 *  own WHERE clause, which is the 19 Aug rule that a statement should be
 *  correct even when the policy is wrong. The GUC is for the policies that read
 *  it, and it should be right for the same reason. */
export async function readLedger(sql: Sql, householdId: string): Promise<Readout> {
  await sql`select set_config('marginsheet.household_id', ${householdId}, true)`;

  // The aggregates are parenthesised before the cast. `count(x) filter (where
  // p)::int` is not the same expression, and getting that wrong is exactly the
  // kind of thing a typecheck cannot see and a database says instantly.
  const accounts = await sql<AccountRow[]>`
    select fa.plaid_account_id, fa.name, fa.mask, fa.type, fa.subtype,
           i.name as institution,
           (count(t.id))::int as held,
           (min(t.date))::text as oldest,
           (max(t.date))::text as newest,
           (min(t.authorized_date))::text as oldest_authorized,
           (count(t.id) filter (where t.pending))::int as pending,
           (count(t.id) filter (where t.removed))::int as removed
      from financial_accounts fa
      join plaid_items pi on pi.id = fa.plaid_item_id and pi.household_id = fa.household_id
      left join institutions i on i.id = pi.institution_id
      left join transactions t on t.account_id = fa.id and t.household_id = fa.household_id
     where fa.household_id = ${householdId}
     group by fa.plaid_account_id, fa.name, fa.mask, fa.type, fa.subtype, i.name
     order by i.name nulls last, fa.type, fa.name
  `;

  const byType = await sql<TypeRow[]>`
    select fa.type,
           (count(distinct fa.id))::int as accounts,
           (count(t.id))::int as held,
           (min(t.date))::text as oldest
      from financial_accounts fa
      left join transactions t on t.account_id = fa.id and t.household_id = fa.household_id
     where fa.household_id = ${householdId}
     group by fa.type
     order by fa.type
  `;

  const items = await sql<ItemRow[]>`
    select item_id, sync_status, status, sync_cursor, last_completed_cursor,
           (last_cursor_at)::text as last_cursor_at,
           (last_successful_sync)::text as last_successful_sync
      from plaid_items where household_id = ${householdId} order by created_at
  `;

  // ONLY first_sync_completed_at. Migration 0028 granted marginsheet_sync two
  // columns of households by name, and connected_first_account_at is not one of
  // them. Reading it here would mean widening that grant for a diagnostic,
  // which is the thing the 0028 ruling exists to refuse.
  const households = await sql<HouseholdRow[]>`
    select (first_sync_completed_at)::text as first_sync_completed_at
      from households where id = ${householdId}
  `;

  // THE CURSORS ARE REPORTED AS A COMPARISON, not as two opaque strings. Equal
  // after a clean run; unequal means the pagination stopped in flight. A reader
  // should not have to diff two base64 blobs by eye to learn which happened.
  return {
    accounts,
    byType,
    items,
    household: households[0] ?? null,
    cursors: items.map((i) => ({
      itemId: i.item_id,
      equal: i.sync_cursor === i.last_completed_cursor,
      inFlightPresent: Boolean(i.sync_cursor),
      lastCompletedPresent: Boolean(i.last_completed_cursor),
    })),
  };
}
