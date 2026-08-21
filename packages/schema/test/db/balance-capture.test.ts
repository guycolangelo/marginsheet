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
// AND IT NAMES THE HOUSEHOLD. plaid_account_id is Plaid's namespace, shared
// across every household, so two households linking the same bank see the same
// value. A write keyed on it without the household reaches another household's
// row, which is the shape of all four cross-household findings of 19 Aug.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { applyBalances, type Tx } from "../../../../services/sync/src/apply-balances.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const A = "01998888-0200-7000-8000-00000000ba1a";
const A_ITEM = "01998888-0201-7000-8000-00000000ba1a";
const A_ACCT = "01998888-0202-7000-8000-00000000ba1a";
const B = "01998888-0300-7000-8000-00000000ba1b";
const B_ITEM = "01998888-0301-7000-8000-00000000ba1b";
const B_ACCT = "01998888-0302-7000-8000-00000000ba1b";

// THE SAME PLAID ACCOUNT ID IN TWO HOUSEHOLDS is the fixture the isolation
// assertion needs, and it is the shape that actually occurs: two people linking
// the same joint account at the same bank.
const SHARED_PLAID_ACCOUNT = "plaid-acct-shared-fixture";

beforeAll(async () => {
  for (const [h, item, acct, itemId] of [
    [A, A_ITEM, A_ACCT, "item-balance-a"],
    [B, B_ITEM, B_ACCT, "item-balance-b"],
  ] as const) {
    await sql`insert into households (id, name) values (${h}, 'balance fixture') on conflict (id) do nothing`;
    await sql`insert into plaid_items (id, household_id, item_id) values (${item}, ${h}, ${itemId}) on conflict (id) do nothing`;
    await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, current_balance, available_balance)
              values (${acct}, ${h}, ${item}, ${SHARED_PLAID_ACCOUNT}, 'Shared', 'depository', 1.00, 1.00)
              on conflict (id) do nothing`;
  }
});

afterAll(async () => {
  for (const h of [A, B]) {
    await sql`delete from account_balance_snapshots where household_id = ${h}`;
    await sql`delete from financial_accounts where household_id = ${h}`;
    await sql`delete from plaid_items where household_id = ${h}`;
    await sql`delete from households where id = ${h}`;
  }
  await sql.end();
});

const page = (current: number, available: number) => [
  { account_id: SHARED_PLAID_ACCOUNT, balances: { current, available, limit: null, iso_currency_code: "USD" } },
];

describe("balance capture", () => {
  it("writes the balance and one snapshot, as marginsheet_sync", async () => {
    const result = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${A}, true)`;
      await tx`set local role marginsheet_sync`;
      return applyBalances(tx as unknown as Tx, A, page(500.25, 480.25));
    });
    expect(result, "the account was not found or not writable").toEqual({ accounts: 1, snapshots: 1 });

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

  it("leaves the other household's account alone, though the Plaid id is identical", async () => {
    // Both accounts carry the SAME plaid_account_id, which is what Plaid does
    // when two households link the same joint account. Without the household
    // predicate this write reaches both rows.
    const [other] = await sql<{ current_balance: string }[]>`
      select current_balance::text from financial_accounts where id = ${B_ACCT}
    `;
    expect(
      other.current_balance,
      "household B's balance moved, so the write is keyed on Plaid's namespace without naming the household",
    ).toBe("1.00");

    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from account_balance_snapshots where household_id = ${B}
    `;
    expect(count.n, "a snapshot was written against the other household's account").toBe(0);
  });
});
