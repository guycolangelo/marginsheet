// The readout's statements, EXECUTED, as the role that runs them.
//
// WHY THIS EXISTS. The ledger readout shipped on 20 Aug 2026 with a green
// typecheck and 230 passing unit tests, and the button returned an empty
// object. Not one of those tests ever ran its four SQL statements against a
// database: they were literals in a route handler, so a syntax error, a
// missing privilege or an RLS predicate that matched nothing was invisible
// until a person clicked a button in production.
//
// THE THIRD INSTANCE OF ONE SHAPE TODAY. last_cursor_at was a column no
// migration created. households was a table no grant covered. This was a
// statement nothing ran. All three passed their own suites; all three surfaced
// on a real run. A typecheck proves a statement was CONSTRUCTED and proves
// nothing about whether it can EXECUTE.
//
// IT IMPORTS readLedger RATHER THAN RESTATING ITS SQL. A test carrying its own
// copy of the queries drifts from them by default, and then both sides are
// green while disagreeing, which is the failure this file is named after.
//
// IT RUNS AS marginsheet_sync, not as the owner, and the role matters as much
// as the execution. The first version ran these statements in api and threw
// "permission denied for table plaid_items": marginsheet_app holds that table
// as an enumerated column list, and last_cursor_at was added by 0027 and
// granted to nobody. An owner connection passes through every grant and every
// policy, so it would have reported that statement as perfectly healthy.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { readLedger, type Sql } from "../../../../services/sync/src/ledger-readout-sql.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-0000-7000-8000-00000000fead";
const ITEM = "01998888-0001-7000-8000-00000000fead";
const ACCOUNT = "01998888-0002-7000-8000-00000000fead";

beforeAll(async () => {
  // Seeded as the OWNER, deliberately: this fixture is about whether the app
  // role can READ, and seeding through the same role would fold the write path
  // into a test about reads.
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'readout fixture')
            on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id)
            values (${ITEM}, ${HOUSEHOLD}, 'item-readout-fixture')
            on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, subtype, mask)
            values (${ACCOUNT}, ${HOUSEHOLD}, ${ITEM}, 'acct-readout-fixture', 'Fixture Checking', 'depository', 'checking', '4321')
            on conflict (id) do nothing`;
  // TWO ROWS WITH DIFFERENT DATES AND ONE PENDING, so the aggregates have
  // something to distinguish. min and max over a single row are equal, and a
  // pending filter over zero pending rows returns 0 whether or not the filter
  // works: a fixture that cannot tell a pass from a failure is the ninth
  // finding, and it applies to this fixture as much as to any other.
  await sql`insert into transactions (household_id, account_id, date, authorized_date, amount, direction, pending, original_description)
            values (${HOUSEHOLD}, ${ACCOUNT}, date '2026-05-01', date '2026-04-30', 12.34, 'expense', false, 'older'),
                   (${HOUSEHOLD}, ${ACCOUNT}, date '2026-08-19', date '2026-08-18', 56.78, 'expense', true,  'newer')
            on conflict do nothing`;
});

afterAll(async () => {
  await sql`delete from transactions where household_id = ${HOUSEHOLD}`;
  await sql`delete from financial_accounts where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

// WHAT THIS DOES NOT PROVE, said plainly. sync_worker_access is USING (true)
// for marginsheet_sync, so row-level security is not what returns these rows
// and this test does not exercise it. It proves the statements PARSE, that the
// role is permitted every column they name, and that the results are shaped as
// the readout claims. That is the whole of it, and it is what broke.
describe("the ledger readout's statements execute as marginsheet_sync", () => {
  it("runs every statement and returns the seeded rows", async () => {
    // No try/catch. A thrown statement IS the finding, and swallowing it is how
    // cross-household-upsert.test.ts proved nothing for two weeks: when a test
    // tolerates an exception, the exception is part of the fixture.
    await sql`set role marginsheet_sync`;

    // WHO AM I, AND WHAT CAN I ACTUALLY READ, ASKED IN THE FAILING CONTEXT.
    // The harness probe reported this grant as present on this database minutes
    // before this test ran, and the test still failed with permission denied.
    // Two true-looking facts that cannot both describe the same query, so the
    // question moves inside the transaction rather than being asked from
    // outside it: an assumption that `set role` took effect is exactly the kind
    // of join nobody checks.
    const [ctx] = await sql<{ role: string; session: string; readable: boolean }[]>`
      select current_user as role, session_user as session,
             has_column_privilege('households', 'first_sync_completed_at', 'SELECT') as readable
    `;
    expect(
      { role: ctx.role, readable: ctx.readable },
      `the effective role is not what this test assumes. session_user=${ctx.session}`,
    ).toEqual({ role: "marginsheet_sync", readable: true });

    let readout;
    try {
      readout = await sql.begin(async (tx) => readLedger(tx as unknown as Sql, HOUSEHOLD));
    } finally {
      await sql`reset role`;
    }

    // THE ROW COUNT IS ASSERTED BEFORE ANYTHING IS READ FROM IT. Every
    // aggregate below returns a defensible-looking answer over zero rows, so a
    // readout that silently matched nothing would satisfy the rest of this test
    // perfectly.
    expect(readout.accounts, "the seeded account is not visible to the sync role").toHaveLength(1);

    const account = readout.accounts[0];
    expect(account.held).toBe(2);
    expect(account.oldest).toBe("2026-05-01");
    expect(account.newest).toBe("2026-08-19");
    expect(account.oldest_authorized).toBe("2026-04-30");
    // The filtered aggregates: 1 of the 2 rows is pending, 0 removed. Distinct
    // values, so a filter that silently counted everything would fail.
    expect(account.pending).toBe(1);
    expect(account.removed).toBe(0);
    expect(account.type).toBe("depository");

    expect(readout.byType).toHaveLength(1);
    expect(readout.byType[0].held).toBe(2);
    expect(readout.byType[0].accounts).toBe(1);

    expect(readout.items).toHaveLength(1);
    expect(readout.household, "the household row was not readable").not.toBeNull();

    // Both cursors are null on a fresh Item, so they are equal and neither is
    // present. Asserting the SHAPE rather than a truthy value, because "equal"
    // is true for two nulls and that is exactly the case a reader misreads.
    expect(readout.cursors).toEqual([
      { itemId: "item-readout-fixture", equal: true, inFlightPresent: false, lastCompletedPresent: false },
    ]);
  });
});
