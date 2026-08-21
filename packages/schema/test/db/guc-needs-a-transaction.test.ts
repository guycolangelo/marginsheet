// set_config's third argument is is_local, and what that costs when it is wrong.
//
// THIS TEST EXISTS TO MAKE A CLAIM CHECKABLE RATHER THAN ASSERTED. On 20 Aug
// 2026 three call sites set the household GUC outside an explicit transaction.
// The reasoning for why that breaks is easy to state and easy to get wrong, so
// it is demonstrated here against a real database instead of argued in a
// comment.
//
// THE MECHANISM. is_local true means the setting reverts at the end of the
// current transaction. Outside an explicit transaction EVERY STATEMENT IS ITS
// OWN, so the GUC is gone before the next query runs.
//
// WHY NOTHING ERRORS, WHICH IS THE WHOLE PROBLEM. household_isolation reads
// current_setting('marginsheet.household_id', true), whose second argument
// means "return NULL rather than raise if unset". So the policy evaluates
// household_id = NULL, which is NULL, which matches no row. AN UNSET GUC IS A
// VALID STATE THAT THE POLICY HANDLES BY RETURNING NOTHING. A statement that
// sets a value and a statement that reads it are each correct; the value simply
// does not survive between them, and the result is an empty list that looks
// exactly like a household with nothing connected.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-0100-7000-8000-00000000feed";
const ITEM = "01998888-0101-7000-8000-00000000feed";
const ACCOUNT = "01998888-0102-7000-8000-00000000feed";

beforeAll(async () => {
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'guc fixture') on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id) values (${ITEM}, ${HOUSEHOLD}, 'item-guc-fixture') on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type)
            values (${ACCOUNT}, ${HOUSEHOLD}, ${ITEM}, 'acct-guc-fixture', 'GUC Checking', 'depository')
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from financial_accounts where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("the household GUC does not survive outside a transaction", () => {
  it("returns the row when the setting and the read share a transaction", async () => {
    // THE POSITIVE CASE COMES FIRST AND IT IS NOT DECORATION. Without it, the
    // negative case below proves only that the query returns nothing, which a
    // typo in the fixture would also produce. Two cases differing in exactly
    // one thing is what makes either of them mean anything.
    await sql`set role marginsheet_app`;
    let rows;
    try {
      rows = await sql.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
        return tx<{ id: string }[]>`select id from financial_accounts where household_id = ${HOUSEHOLD}`;
      });
    } finally {
      await sql`reset role`;
    }
    expect(rows, "the app role cannot see its own household inside a transaction").toHaveLength(1);
  });

  it("returns nothing, and raises nothing, when they do not", async () => {
    await sql`set role marginsheet_app`;
    let rows;
    try {
      await sql`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
      // Same query, same household, same role. The only difference is that the
      // setting above ended with its own statement.
      rows = await sql<{ id: string }[]>`select id from financial_accounts where household_id = ${HOUSEHOLD}`;
    } finally {
      await sql`reset role`;
    }
    expect(
      rows,
      "the GUC survived outside a transaction, which would mean is_local no longer behaves as this repo assumes everywhere",
    ).toHaveLength(0);
  });
});
