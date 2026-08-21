// plaid_recurring is the LOWEST authority, and the upsert has to prove it.
//
// commitments_stream_unique keys on (household, merchant_key, direction,
// cadence, account), so every import collides with whatever wrote that stream
// last. A blind DO UPDATE would overwrite a census correction or a household
// statement ON EVERY SYNC, and the correction would evaporate silently: the row
// would still be there, still look right, and carry Plaid's number.
//
// THAT IS THE ONLY THING THIS FILE IS ABOUT. The mapping is arithmetic and a
// recorder could check it; the authority is a WHERE clause on a conflict target
// and it exists nowhere outside Postgres.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-5000-7000-8000-000000005ec0";
const ITEM = "01998888-5001-7000-8000-000000005ec0";
const ACCOUNT = "01998888-5002-7000-8000-000000005ec0";

let importRecurring: typeof import("../../../../services/sync/src/import-recurring.js")["importRecurring"];
const plaid = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../../../../services/sync/src/plaid-client.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, callPlaid: (...a: unknown[]) => plaid.call(...a) };
});

function stream(amount: number, frequency = "MONTHLY") {
  return {
    stream_id: "s1", account_id: "plaid-recur-acct", merchant_name: "Netflix",
    frequency, average_amount: { amount }, predicted_next_date: "2026-09-05", is_active: true,
  };
}

async function run() {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    return importRecurring(
      tx as never, HOUSEHOLD,
      { id: ITEM, itemId: "item-recur", accessToken: "tok" },
      { clientId: "x", secret: "y" } as never
    );
  }) as never as Promise<Awaited<ReturnType<typeof importRecurring>>>;
}

async function stored() {
  const [r] = await sql<{ source: string; amount: string; status: string }[]>`
    select source::text as source, (expected_amount->>'amount') as amount, status::text as status
      from commitments where household_id = ${HOUSEHOLD}`;
  return r;
}

beforeAll(async () => {
  ({ importRecurring } = await import("../../../../services/sync/src/import-recurring.js"));
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'recur fixture') on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id) values (${ITEM}, ${HOUSEHOLD}, 'item-recur') on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, subtype)
            values (${ACCOUNT}, ${HOUSEHOLD}, ${ITEM}, 'plaid-recur-acct', 'Fixture Card', 'credit', 'credit card')
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from commitments where household_id = ${HOUSEHOLD}`;
  await sql`delete from financial_accounts where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("plaid_recurring writes, and defers to anything above it", () => {
  it("writes a stream it has never seen", async () => {
    plaid.call.mockResolvedValue({ outflow_streams: [stream(15.99)], inflow_streams: [] });
    const r = await run();
    expect(r.written).toBe(1);
    expect((await stored()).amount).toBe("15.99");
  });

  it("OVERWRITES ITS OWN earlier value, because a fresher detection is still fresher", async () => {
    plaid.call.mockResolvedValue({ outflow_streams: [stream(17.99)], inflow_streams: [] });
    const r = await run();
    expect(r.written).toBe(1);
    expect(r.deferredToHigherAuthority).toBe(0);
    expect((await stored()).amount).toBe("17.99");
  });

  it("DEFERS to household_stated and leaves the amount alone", async () => {
    // THE ASSERTION THE WHOLE FILE EXISTS FOR. Without the WHERE clause on the
    // conflict target, this row is silently rewritten on every sync: it stays
    // present, stays plausible, and stops being what the household said.
    await sql`update commitments set source = 'household_stated',
                expected_amount = '{"kind":"fixed","amount":9.99}'::jsonb
              where household_id = ${HOUSEHOLD}`;
    plaid.call.mockResolvedValue({ outflow_streams: [stream(24.99)], inflow_streams: [] });
    const r = await run();
    expect(r.written).toBe(0);
    expect(r.deferredToHigherAuthority).toBe(1);
    const s = await stored();
    expect(s.amount, "a household statement was overwritten by a detection").toBe("9.99");
    expect(s.source).toBe("household_stated");
  });

  it("DEFERS to census too, so the rule is authority and not one special case", async () => {
    // A second source above it, because a single deferral case could pass
    // against a check hard-wired to household_stated.
    await sql`update commitments set source = 'census' where household_id = ${HOUSEHOLD}`;
    plaid.call.mockResolvedValue({ outflow_streams: [stream(31.99)], inflow_streams: [] });
    const r = await run();
    expect(r.deferredToHigherAuthority).toBe(1);
    expect((await stored()).amount).toBe("9.99");
  });

  it("counts a stream whose account we do not hold rather than writing it", async () => {
    plaid.call.mockResolvedValue({
      outflow_streams: [{ ...stream(5), account_id: "not-ours" }], inflow_streams: [],
    });
    const r = await run();
    expect(r.unmatchedAccounts).toBe(1);
    expect(r.written).toBe(0);
  });

  it("maps an unknown frequency to irregular and says how many", async () => {
    // Our cadence enum is WIDER than Plaid's: every_other_month, quarterly and
    // semiannual have no equivalent, which is what the census is for. A stream
    // Plaid cannot classify must not be silently dropped or guessed at.
    plaid.call.mockResolvedValue({
      outflow_streams: [{ ...stream(7.5, "UNKNOWN"), merchant_name: "Something Odd" }], inflow_streams: [],
    });
    const r = await run();
    expect(r.irregular).toBe(1);
  });
});
