// The three states an empty liability row would otherwise collapse into.
//
// A card with no liability detail and a card the institution will not report on
// are DIFFERENT STATES, and Cash Flow needs to know which (Guy, 21 Aug 2026).
// Under 'reported', a null statement balance is a card with nothing owed. Under
// 'not_reported' and 'unsupported' it is a figure we do not have, and a surface
// rendering those the same has told a household its committed outflow is zero
// when it does not know.
//
// EVERY BRANCH IS A SQL STATEMENT and a recorder proves a statement was
// constructed and nothing about whether it executes. It imports fetchLiabilities
// rather than restating its SQL, and stubs only the Plaid call, so the writes
// are real against a real schema.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-4000-7000-8000-000000001ab0";
const ITEM = "01998888-4001-7000-8000-000000001ab0";
const CARD_A = "01998888-4002-7000-8000-000000001ab0";
const CARD_B = "01998888-4003-7000-8000-000000001ab0";

type Fetch = typeof import("../../../../services/sync/src/fetch-liabilities.js")["fetchLiabilities"];
type Outcome = Awaited<ReturnType<Fetch>>;
let fetchLiabilities: Fetch;
const plaid = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../../../../services/sync/src/plaid-client.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, callPlaid: (...a: unknown[]) => plaid.call(...a) };
});

async function run(enabledAt: string | null): Promise<Outcome> {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    return fetchLiabilities(
      tx as never, HOUSEHOLD,
      { id: ITEM, itemId: "item-liab", accessToken: "tok", enabledAt },
      { clientId: "x", secret: "y" } as never
    );
  }) as unknown as Promise<Outcome>;
}

async function coverage(id: string): Promise<string> {
  const [r] = await sql<{ c: string }[]>`select liability_coverage::text as c from financial_accounts where id = ${id}`;
  return r.c;
}

beforeAll(async () => {
  ({ fetchLiabilities } = await import("../../../../services/sync/src/fetch-liabilities.js"));
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'liab fixture') on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id) values (${ITEM}, ${HOUSEHOLD}, 'item-liab') on conflict (id) do nothing`;
  // TWO CARDS, DELIBERATELY. One reported and one not is the only fixture that
  // can tell 'not_reported' from a blanket state applied to everything.
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, subtype)
            values (${CARD_A}, ${HOUSEHOLD}, ${ITEM}, 'plaid-card-a', 'Card A', 'credit', 'credit card'),
                   (${CARD_B}, ${HOUSEHOLD}, ${ITEM}, 'plaid-card-b', 'Card B', 'credit', 'credit card')
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from liability_details where household_id = ${HOUSEHOLD}`;
  await sql`delete from financial_accounts where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("liability coverage says WHY a committed outflow is missing", () => {
  it("makes NO CALL and starts no billing when the Item is not enabled", async () => {
    plaid.call.mockReset();
    const r = await run(null);
    expect(plaid.call, "a disabled Item must not reach Plaid; that call starts a monthly charge").not.toHaveBeenCalled();
    expect(r.fetched).toBe(false);
    expect(await coverage(CARD_A)).toBe("unknown");
  });

  it("marks EVERY card unsupported when the institution refuses the Item", async () => {
    plaid.call.mockReset();
    const { PlaidError } = await import("../../../../services/sync/src/plaid-client.js");
    // The REAL error class, constructed the way callPlaid constructs it, so the
    // test exercises the same errorCode the classifier reads. A hand-rolled
    // object with an errorCode property would pass while proving nothing about
    // what Plaid's own errors carry, which is the cast finding one level over.
    plaid.call.mockRejectedValue(
      new PlaidError("/liabilities/get", 400, { error_code: "PRODUCTS_NOT_SUPPORTED" })
    );
    const r = await run("2026-08-21T00:00:00Z");
    expect(r.unsupported).toBe(true);
    expect(await coverage(CARD_A)).toBe("unsupported");
    expect(await coverage(CARD_B)).toBe("unsupported");
  });

  it("distinguishes REPORTED from NOT_REPORTED within one successful call", async () => {
    // THE ASSERTION THAT MAKES THE COLUMN WORTH HAVING. A blanket state would
    // pass the two tests above and fail here, and a household would be told its
    // second card owes nothing when the institution simply said nothing.
    plaid.call.mockReset();
    plaid.call.mockResolvedValue({
      liabilities: { credit: [{
        account_id: "plaid-card-a", last_statement_balance: 412.10,
        next_payment_due_date: "2026-09-15", minimum_payment_amount: 35,
        aprs: [{ apr_type: "purchase_apr", apr_percentage: 24.99 }],
      }] },
    });
    const r = await run("2026-08-21T00:00:00Z");
    expect(r.accountsReported).toBe(1);
    expect(r.accountsNotReported).toBe(1);
    expect(await coverage(CARD_A)).toBe("reported");
    expect(await coverage(CARD_B)).toBe("not_reported");

    const [d] = await sql<{ bal: string; due: string; apr: string }[]>`
      select last_statement_balance::text as bal, next_payment_due_date::text as due,
             purchase_apr::text as apr
        from liability_details where account_id = ${CARD_A}`;
    expect(d.bal).toBe("412.10");
    expect(d.due).toBe("2026-09-15");
    expect(d.apr).toBe("24.990");
  });

  it("UPSERTS rather than accumulating rows for one account", async () => {
    // 0002 created a plain index on account_id and no unique constraint, so
    // nothing stopped a second row and the upsert had no conflict target to
    // name. Found by writing the first statement that inserts here, which is
    // the only thing that could find it: a table nothing writes cannot
    // demonstrate a missing constraint.
    plaid.call.mockResolvedValue({
      liabilities: { credit: [{ account_id: "plaid-card-a", last_statement_balance: 999.99, next_payment_due_date: "2026-10-15" }] },
    });
    await run("2026-08-21T00:00:00Z");
    const [c] = await sql<{ n: number }[]>`select count(*)::int as n from liability_details where account_id = ${CARD_A}`;
    expect(c.n, "a second row for one account").toBe(1);
    const [d] = await sql<{ bal: string }[]>`select last_statement_balance::text as bal from liability_details where account_id = ${CARD_A}`;
    expect(d.bal).toBe("999.99");
  });

  it("moves a card BACK to not_reported when it stops being reported", async () => {
    // Stale coverage would be worse than none: a card that dropped out of the
    // response keeping 'reported' means Cash Flow reads its last statement
    // balance as current when the institution has stopped saying so.
    //
    // IT ESTABLISHES 'reported' ITSELF RATHER THAN INHERITING IT, and that is
    // load-bearing rather than tidiness. The register names this test, and the
    // planted-failure harness runs a named test ALONE via -t. Inheriting the
    // reported state from the test above, run by itself CARD_A was still
    // 'unknown', and the planted mutation -- narrowing the sweep to cards not
    // already marked reported -- CHANGED NOTHING for an unknown card. The
    // harness correctly reported the control as insensitive: the fixture could
    // not construct the state the defect needs.
    //
    // The two calls are the whole point: reported first, absent second.
    plaid.call.mockReset();
    plaid.call.mockResolvedValue({
      liabilities: { credit: [{
        account_id: "plaid-card-a", last_statement_balance: 412.10,
        next_payment_due_date: "2026-09-15", minimum_payment_amount: 35,
      }] },
    });
    await run("2026-08-21T00:00:00Z");
    expect(await coverage(CARD_A), "the fixture must reach 'reported' before demotion can be tested").toBe("reported");

    plaid.call.mockReset();
    plaid.call.mockResolvedValue({ liabilities: { credit: [] } });
    await run("2026-08-21T00:00:00Z");
    expect(await coverage(CARD_A)).toBe("not_reported");
  });
});
