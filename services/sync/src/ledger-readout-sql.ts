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
  /** THE OTHER HALF OF WHAT A LEDGER READOUT SHOULD SAY (Guy, 20 Aug 2026).
   *  A balance and the moment it was last written, because a balance without
   *  its timestamp cannot be told from a stale one, and Cash Flow projects a
   *  13 week path from this number. */
  current_balance: string | null; available_balance: string | null;
  account_updated_at: string | null;
  snapshots: number; newest_snapshot: string | null; oldest_snapshot: string | null;
}
/** One (account type, sign) bucket: how many rows, what direction we stored for
 *  them, and enough real descriptions to tell a payment from a refund. */
export interface DirectionAuditRow {
  type: string | null;
  sign: string;
  stored_direction: string | null;
  rows: number;
  min_amount: string | null;
  max_amount: string | null;
  examples: string[] | null;
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

export interface EventRow {
  source: string; event_type: string | null; event_id: string;
  created_at: string; processed_at: string | null; household_id: string | null;
}

export interface Readout {
  accounts: AccountRow[];
  byType: TypeRow[];
  items: ItemRow[];
  household: HouseholdRow | null;
  /** THE PROVIDER EVENTS, ADDED BEFORE THE WEBHOOK WAS SWITCHED ON.
   *
   *  Asked directly on 21 Aug 2026: how would anyone SEE
   *  WEBHOOK_UPDATE_ACKNOWLEDGED arrive? The answer was nothing showed it. The
   *  readout did not report provider_events, Sentry only sees failures, and a
   *  webhook that verified and recorded correctly would have landed in silence.
   *  THAT IS THE WRONG SHAPE FOR AN ACCEPTANCE CRITERION: an event nobody can
   *  observe cannot be the thing that proves the task is done. */
  events: EventRow[];
  cursors: Array<{ itemId: string; equal: boolean; inFlightPresent: boolean; lastCompletedPresent: boolean }>;
  /** WHICH SIGN IS A CARD CREDIT, ASKED OF OUR OWN ROWS BECAUSE SANDBOX COULD
   *  NOT ANSWER IT. ins_109508 holds 9 credit rows, every one a positive
   *  purchase and no payment, so the case under test is not representable in
   *  its fixture, and injecting one through a custom user would be circular
   *  because the sign would be ours. Chase is connected and a real card payment
   *  either exists here or does not.
   *
   *  IT SETTLES WHICH ROWS TO REPAIR, NOT WHAT THEY BECOME (Guy, 21 Aug 2026).
   *  The sign tells us what Plaid sends. It does not tell us whether a given
   *  card credit is a payment or a refund, and that is the thing `direction`
   *  would be claiming, so the repair writes `undetermined` whatever the sign
   *  turns out to be.
   *
   *  NAMES ARE RETURNED DELIBERATELY. A count cannot separate a payment from a
   *  refund and a description usually can, which is the same reason the Plaid
   *  cross-check reports which row rather than how many. */
  directionAudit: DirectionAuditRow[];
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
export async function readLedger(tx: Sql, householdId: string): Promise<Readout> {
  await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;

  // The aggregates are parenthesised before the cast. `count(x) filter (where
  // p)::int` is not the same expression, and getting that wrong is exactly the
  // kind of thing a typecheck cannot see and a database says instantly.
  const accounts = await tx<AccountRow[]>`
    select fa.plaid_account_id, fa.name, fa.mask, fa.type, fa.subtype,
           i.name as institution,
           fa.current_balance::text as current_balance,
           fa.available_balance::text as available_balance,
           (fa.updated_at)::text as account_updated_at,
           (select count(*)::int from account_balance_snapshots s
             where s.account_id = fa.id and s.household_id = fa.household_id) as snapshots,
           (select (max(s.date))::text from account_balance_snapshots s
             where s.account_id = fa.id and s.household_id = fa.household_id) as newest_snapshot,
           (select (min(s.date))::text from account_balance_snapshots s
             where s.account_id = fa.id and s.household_id = fa.household_id) as oldest_snapshot,
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
     group by fa.id, fa.household_id, fa.plaid_account_id, fa.name, fa.mask, fa.type,
              fa.subtype, i.name, fa.current_balance, fa.available_balance, fa.updated_at
     order by i.name nulls last, fa.type, fa.name
  `;

  const byType = await tx<TypeRow[]>`
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

  const items = await tx<ItemRow[]>`
    select item_id, sync_status, status, sync_cursor, last_completed_cursor,
           (last_cursor_at)::text as last_cursor_at,
           (last_successful_sync)::text as last_successful_sync
      from plaid_items where household_id = ${householdId} order by created_at
  `;

  // ONLY first_sync_completed_at. Migration 0028 granted marginsheet_sync two
  // columns of households by name, and connected_first_account_at is not one of
  // them. Reading it here would mean widening that grant for a diagnostic,
  // which is the thing the 0028 ruling exists to refuse.
  const households = await tx<HouseholdRow[]>`
    select (first_sync_completed_at)::text as first_sync_completed_at
      from households where id = ${householdId}
  `;

  // MOST RECENT FIRST, AND CAPPED. A readout is read by a person, and twenty
  // rows is enough to see the last webhook and whether it was processed.
  // processed_at being null on a recent row is the interesting case: recorded
  // and never acted on.
  const events = await tx<EventRow[]>`
    select source::text, event_type, event_id,
           (created_at)::text as created_at, (processed_at)::text as processed_at,
           (household_id)::text as household_id
      from provider_events
     where household_id = ${householdId} or household_id is null
     order by created_at desc
     limit 20
  `;

  // THE CURSORS ARE REPORTED AS A COMPARISON, not as two opaque strings. Equal
  // after a clean run; unequal means the pagination stopped in flight. A reader
  // should not have to diff two base64 blobs by eye to learn which happened.
  // GROUPED IN THE DATABASE RATHER THAN COUNTED PER SUBJECT. A diagnostic whose
  // cost scales with the number of things examined refuses to answer about the
  // subjects exactly when there are most of them, which is how the per-account
  // cross-check came back silent rather than zero on 20 Aug.
  const directionAudit = await tx<DirectionAuditRow[]>`
    select fa.type,
           case when t.amount > 0 then 'positive'
                when t.amount < 0 then 'negative'
                else 'zero' end as sign,
           t.direction::text as stored_direction,
           (count(*))::int as rows,
           (min(t.amount))::text as min_amount,
           (max(t.amount))::text as max_amount,
           (array_agg(distinct coalesce(t.merchant_name, t.original_description))
              filter (where coalesce(t.merchant_name, t.original_description) is not null)
           )[1:6] as examples
      from transactions t
      join financial_accounts fa
        on fa.id = t.account_id and fa.household_id = t.household_id
     where t.household_id = ${householdId} and not t.removed
     group by fa.type, 2, t.direction
     order by fa.type, 2, t.direction
  `;

  return {
    accounts,
    byType,
    directionAudit,
    items,
    events,
    household: households[0] ?? null,
    cursors: items.map((i) => ({
      itemId: i.item_id,
      equal: i.sync_cursor === i.last_completed_cursor,
      inFlightPresent: Boolean(i.sync_cursor),
      lastCompletedPresent: Boolean(i.last_completed_cursor),
    })),
  };
}
