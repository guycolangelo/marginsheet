// The readout's four statements, in a module so a test can run THE SAME ONES.
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
  connected_first_account_at: string | null;
}

export interface Readout {
  accounts: AccountRow[];
  byType: TypeRow[];
  items: ItemRow[];
  household: HouseholdRow | null;
  cursors: Array<{ itemId: string; equal: boolean; inFlightPresent: boolean; lastCompletedPresent: boolean }>;
}

/** Reads everything the readout reports from OUR tables. Sets the household
 *  GUC first, because every policy on this path reads it. */
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

  const households = await sql<HouseholdRow[]>`
    select (first_sync_completed_at)::text as first_sync_completed_at,
           (connected_first_account_at)::text as connected_first_account_at
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
