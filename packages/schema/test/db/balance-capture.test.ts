// Balance capture, executed, as the role that runs it.
//
// THREE PROPERTIES, and the middle one is a ruling rather than an implementation
// detail.
//
// It writes at all: until 21 Aug 2026 nothing refreshed a balance after
// connection, and the balances Plaid sends with every sync page were never read.
//
// PER DAY, NOT PER SYNC. account_balance_snapshots is keyed by date and the
// projection reads a SERIES, so a row per sync would make that series depend on
// how often we happened to sync, which is a property of us rather than of the
// household's money. Two writes within a single day must CONVERGE on the later figure
// rather than accumulate, and that is asserted here rather than described.
//
// WHAT THIS FILE DELIBERATELY DOES NOT TEST, AND WHY. It first carried a third
// case: two households holding accounts with the SAME plaid_account_id, to
// prove the household predicate stops a cross-household reach. That control was
// wrong at the premise, and the premise is the part worth recording.
//
// PLAID IDS ARE ITEM-SCOPED. Two households linking the same joint account get
// two Items and therefore two DIFFERENT account ids, which was established the
// same night against production data. The collision the fixture modelled does
// not occur. The schema says so too: financial_accounts_plaid_account_id_unique
// is global, so the fixture could not even be built, and that is what surfaced
// it.
//
// It is the companion question this repo already records, asked too late:
// before asking whether a control can fail, ask whether the thing it guards can
// HAPPEN. A control aimed at an impossible shape passes forever and is
// indistinguishable from one that works.
//
// The predicate itself stays, because a statement keyed on a provider value
// should name the household whatever the provider's id semantics happen to be
// today, and it is covered by every-write-declares-a-household, which scans
// this module statically.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { applyBalances, type Tx } from "../../../../services/sync/src/apply-balances.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const A = "01998888-0200-7000-8000-00000000ba1a";
const A_ITEM = "01998888-0201-7000-8000-00000000ba1a";
const A_ACCT = "01998888-0202-7000-8000-00000000ba1a";
const PLAID_ACCOUNT = "plaid-acct-balance-fixture";

beforeAll(async () => {
  await sql`insert into households (id, name) values (${A}, 'balance fixture') on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id) values (${A_ITEM}, ${A}, 'item-balance-a') on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, current_balance, available_balance)
            values (${A_ACCT}, ${A}, ${A_ITEM}, ${PLAID_ACCOUNT}, 'Fixture', 'depository', 1.00, 1.00)
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from account_balance_snapshots where household_id = ${A}`;
  await sql`delete from financial_accounts where household_id = ${A}`;
  await sql`delete from plaid_items where household_id = ${A}`;
  await sql`delete from households where id = ${A}`;
  await sql.end();
});

const page = (current: number, available: number) => [
  { account_id: PLAID_ACCOUNT, balances: { current, available, limit: null, iso_currency_code: "USD" } },
];

describe("balance capture", () => {
  it("writes the balance and one snapshot, as marginsheet_sync", async () => {
    const result = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${A}, true)`;
      await tx`set local role marginsheet_sync`;
      return applyBalances(tx as unknown as Tx, A, page(500.25, 480.25));
    });
    expect(result.accounts, "the account was not found or not writable").toBe(1);
    expect(result.snapshots).toBe(1);
    // THE IDS ARE THE SET RECONCILIATION IS ALLOWED TO JUDGE, so asserting the
    // count alone would let them come back empty while this still passed. An
    // empty set means nothing gets reconciled and every account reports "not
    // refreshed", which is a silent shutdown of the whole check rather than a
    // failure of it.
    expect(result.accountIds, "the refreshed ids came back empty or wrong").toEqual([A_ACCT]);

    const [row] = await sql<{ current_balance: string; available_balance: string }[]>`
      select current_balance::text, available_balance::text from financial_accounts where id = ${A_ACCT}
    `;
    expect(row.current_balance).toBe("500.25");
    expect(row.available_balance).toBe("480.25");
  });

  it("converges on the later figure within a day rather than accumulating", async () => {
    // THE PER-DAY RULING, EXECUTED. Distinct values so a second row and an
    // overwritten row cannot be confused: accumulating would leave two
    // snapshots, and reading the first would leave 500.25.
    await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${A}, true)`;
      await tx`set local role marginsheet_sync`;
      return applyBalances(tx as unknown as Tx, A, page(612.00, 590.00));
    });

    const snaps = await sql<{ date: string; current_balance: string }[]>`
      select date::text, current_balance::text from account_balance_snapshots
       where account_id = ${A_ACCT} order by date
    `;
    expect(snaps, "a second write on the same day created a second row").toHaveLength(1);
    expect(snaps[0].current_balance, "the snapshot kept the earlier figure").toBe("612.00");
  });

});
