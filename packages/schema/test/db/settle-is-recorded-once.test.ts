// settled_at fires on the TRANSITION, once, EXECUTED.
//
// WHY A DATABASE TEST. The logic is a CASE inside an ON CONFLICT DO UPDATE that
// compares the STORED row against the EXCLUDED one, and neither half of that
// comparison exists outside Postgres. A recorder would capture the statement
// text and assert nothing about which branch Postgres takes, which is three
// findings in one week in this repository.
//
// IT IMPORTS applyAddedAndModified rather than restating its SQL, so the test
// cannot end up agreeing with a copy of the upsert instead of the upsert.
//
// WHAT IT GUARDS. Plaid Sandbox cannot construct a pending-to-posted
// transition: 0 pending rows across 48 default-user transactions and across
// every user_custom shape tried on 17 Aug 2026. So invariant 8 was rewritten to
// claim only what Sandbox proves, and this transition was left as a gap. This
// is the first thing that can exercise it, against a real database, with a
// fixture we construct rather than one Plaid has to supply.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { applyAddedAndModified } from "../../../../services/sync/src/apply-streams.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-2000-7000-8000-00000000face";
const ITEM = "01998888-2001-7000-8000-00000000face";
const ACCOUNT = "01998888-2002-7000-8000-00000000face";
const PLAID_ACCOUNT = "acct-settle-fixture";

function txn(id: string, pending: boolean) {
  return { transaction_id: id, account_id: PLAID_ACCOUNT, date: "2026-08-20", amount: 42.5, pending };
}

async function apply(rows: ReturnType<typeof txn>[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    await applyAddedAndModified(tx as never, HOUSEHOLD, rows as never);
  });
}

async function read(id: string) {
  const [row] = await sql<{ pending: boolean; settled_at: string | null }[]>`
    select pending, (settled_at)::text as settled_at
      from transactions where plaid_transaction_id = ${id} and household_id = ${HOUSEHOLD}
  `;
  return row;
}

beforeAll(async () => {
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'settle fixture')
            on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id)
            values (${ITEM}, ${HOUSEHOLD}, 'item-settle-fixture') on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, subtype)
            values (${ACCOUNT}, ${HOUSEHOLD}, ${ITEM}, ${PLAID_ACCOUNT}, 'Fixture Card', 'credit', 'credit card')
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from transactions where household_id = ${HOUSEHOLD}`;
  await sql`delete from financial_accounts where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("settled_at records the transition and not the state", () => {
  it("is NULL while the row is still pending", async () => {
    await apply([txn("settle-a", true)]);
    const row = await read("settle-a");
    expect(row.pending).toBe(true);
    expect(row.settled_at, "a pending row cannot have settled").toBeNull();
  });

  it("is SET when a pending row arrives posted", async () => {
    await apply([txn("settle-a", false)]);
    const row = await read("settle-a");
    expect(row.pending).toBe(false);
    expect(row.settled_at, "the transition was not recorded").not.toBeNull();
  });

  it("does NOT MOVE on a later modify of the same posted row", async () => {
    // Set once. A later restatement, which Amex delivered 161 of on its second
    // sync, must not rewrite an observation to the moment of the restatement.
    const before = (await read("settle-a")).settled_at;
    await apply([txn("settle-a", false)]);
    expect((await read("settle-a")).settled_at).toBe(before);
  });

  it("STAYS NULL for a row that was never seen pending", async () => {
    // THE ASSERTION THAT MAKES THE COLUMN MEAN A TRANSITION. Without it, a
    // column set on every posted row would pass the two tests above and count
    // ROWS rather than TRANSITIONS, and the criterion is about the transition.
    await apply([txn("settle-b", false)]);
    const row = await read("settle-b");
    expect(row.pending).toBe(false);
    expect(row.settled_at, "a row first seen posted has no observed settle").toBeNull();
  });

  it("does not set it when a posted row goes back to pending", async () => {
    // The reverse transition is not a settle. Plaid should not do this, and a
    // CASE keyed only on `excluded.pending is false` would be silent about it
    // while this fixture is the only thing that would notice.
    await apply([txn("settle-b", true)]);
    expect((await read("settle-b")).settled_at).toBeNull();
  });
});
