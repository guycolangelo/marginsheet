// Accounts REFRESHED and accounts CHANGED are two populations, executed.
//
// WHY THIS IS A DATABASE TEST AND NOT A RECORDER TEST. The claim is about IS
// DISTINCT FROM against nullable numerics, and a recorder proves the statement
// was constructed while saying nothing about what Postgres does with it. The
// specific hazard is that `<>` on a nullable column yields NULL rather than
// true, so an account whose balance has been null since it was created would be
// reported as unchanged or as changed depending on which way the null
// propagated, and both readings look plausible in the source.
//
// THE SECOND ASSERTION IS THE ONE THAT DISCRIMINATES. Applying the SAME
// balances twice must refresh both accounts and change neither. Keying the
// signal on the refreshed set -- which is what a reasonable engineer reaches
// for, because applyBalances already returns it and reconciliation already uses
// it -- passes every fixture where a balance actually moved and fails only
// here.
//
// AND THE TWO SETS MUST STAY TWO. Amendment 14 scopes reconciliation to
// accounts whose balance was READ: an account read and unchanged still has a
// fresh observation and is exactly where drift would be most suspicious.
// Narrowing that population to the changed set would delete the invariant for
// every steady account, silently.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { applyBalances } from "../../../../services/sync/src/apply-balances.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-7000-7000-8000-0000000005ee";
const ITEM = "01998888-7001-7000-8000-0000000005ee";
const MOVER = "01998888-7002-7000-8000-0000000005ee";
const STEADY = "01998888-7003-7000-8000-0000000005ee";
// Null since creation, and never given a figure. The account that separates
// IS DISTINCT FROM from <>.
const NEVER_REPORTED = "01998888-7004-7000-8000-0000000005ee";

function account(id: string, current: number | null, available: number | null) {
  return { account_id: id, balances: { current, available, limit: null } };
}

async function apply(accounts: ReturnType<typeof account>[]) {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    return applyBalances(tx as never, HOUSEHOLD, accounts as never);
  }) as never as Promise<Awaited<ReturnType<typeof applyBalances>>>;
}

beforeAll(async () => {
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'balance change fixture')
            on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id)
            values (${ITEM}, ${HOUSEHOLD}, 'item-balance-change') on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type)
            values
              (${MOVER},          ${HOUSEHOLD}, ${ITEM}, 'plaid-acct-mover',  'Mover',  'depository'),
              (${STEADY},         ${HOUSEHOLD}, ${ITEM}, 'plaid-acct-steady', 'Steady', 'depository'),
              (${NEVER_REPORTED}, ${HOUSEHOLD}, ${ITEM}, 'plaid-acct-null',   'Null',   'depository')
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from account_balance_snapshots where household_id = ${HOUSEHOLD}`;
  await sql`delete from financial_accounts where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("applyBalances reports what was read and what moved as two sets", () => {
  it("the first sight of a balance is a change", async () => {
    const r = await apply([account("plaid-acct-mover", 100, 90), account("plaid-acct-steady", 50, 50)]);
    expect(r.accountIds).toHaveLength(2);
    expect(r.changedAccountIds).toHaveLength(2);
  });

  it("THE DISCRIMINATING CASE: the same balances again refresh both and change neither", async () => {
    // Plaid returns balances on EVERY PAGE OF EVERY SYNC, so this is not an
    // edge case, it is the ordinary sync. A signal keyed on the refreshed set
    // fires here, which does not widen the gate's input, it deletes the gate.
    const r = await apply([account("plaid-acct-mover", 100, 90), account("plaid-acct-steady", 50, 50)]);
    expect(r.accountIds, "both accounts were read and reconciliation must still see them").toHaveLength(2);
    expect(r.changedAccountIds, "nothing moved, so nothing may signal").toEqual([]);
  });

  it("reports only the account that moved", async () => {
    const r = await apply([account("plaid-acct-mover", 175, 90), account("plaid-acct-steady", 50, 50)]);
    expect(r.accountIds).toHaveLength(2);
    expect(r.changedAccountIds).toEqual([MOVER]);
  });

  it("null against null is not a change, which <> could not express", async () => {
    // NEVER_REPORTED has been null since it was created. Under `<>` this
    // comparison yields NULL rather than false, so the account would be
    // reported as unchanged only by accident of how the null propagated
    // through the OR. IS DISTINCT FROM answers the question actually asked.
    const r = await apply([account("plaid-acct-null", null, null)]);
    expect(r.accountIds).toEqual([NEVER_REPORTED]);
    expect(r.changedAccountIds).toEqual([]);
  });

  it("null becoming a figure IS a change", async () => {
    const r = await apply([account("plaid-acct-null", 10, null)]);
    expect(r.changedAccountIds).toEqual([NEVER_REPORTED]);
  });

  it("a figure becoming null IS a change", async () => {
    const r = await apply([account("plaid-acct-null", null, null)]);
    expect(r.changedAccountIds).toEqual([NEVER_REPORTED]);
  });
});
