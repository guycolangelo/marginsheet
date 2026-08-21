// Verification for §4 projections.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { COMMITMENT_SOURCE_AUTHORITY } from "@marginsheet/shared/commitments";

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL ?? "", { max: 1 });

const uuid = () => crypto.randomUUID();

beforeAll(() => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for introspection tests");
});
afterAll(async () => {
  await sql.end();
});

async function insertCommitment(
  household: string,
  overrides: Record<string, unknown> = {}
) {
  const row = {
    merchant_key: "acme",
    direction: "outflow",
    cadence: "monthly",
    account_id: null,
    source: "plaid_recurring",
    ...overrides,
  };
  return sql`
    insert into commitments
      (household_id, merchant_key, direction, cadence, account_id, source)
    values
      (${household}, ${row.merchant_key as string}, ${row.direction as string},
       ${row.cadence as string}, ${row.account_id as string | null},
       ${row.source as string})
    returning id
  `;
}

describe("the upsert key, and NULLS NOT DISTINCT", () => {
  it("refuses a second commitment for the same stream when BOTH accounts are unknown", async () => {
    const household = uuid();
    await insertCommitment(household);

    // This is the day-one case: Plaid Recurring streams arrive before their
    // account is learned. Postgres default NULL-distinctness would permit
    // this and mint a duplicate.
    await expect(insertCommitment(household)).rejects.toThrow(
      /commitments_stream_unique/
    );

    await sql`delete from commitments where household_id = ${household}`;
  });

  it("permits the same stream on two different known accounts", async () => {
    const household = uuid();
    await insertCommitment(household, { account_id: uuid() });
    await insertCommitment(household, { account_id: uuid() });

    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from commitments where household_id = ${household}
    `;
    expect(row.n).toBe(2);
    await sql`delete from commitments where household_id = ${household}`;
  });

  it("re-attribution: moving the account updates in place rather than duplicating", async () => {
    const household = uuid();
    const [c] = await insertCommitment(household);
    const newAccount = uuid();

    await sql`update commitments set account_id = ${newAccount} where id = ${c.id}`;

    const rows = await sql<{ account_id: string }[]>`
      select account_id from commitments where household_id = ${household}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(newAccount);
    await sql`delete from commitments where household_id = ${household}`;
  });

  it("a different cadence is a different stream", async () => {
    const household = uuid();
    await insertCommitment(household, { cadence: "monthly" });
    await insertCommitment(household, { cadence: "annual" });
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from commitments where household_id = ${household}
    `;
    expect(row.n).toBe(2);
    await sql`delete from commitments where household_id = ${household}`;
  });

  it("records that NULLS NOT DISTINCT is deliberate and what breaks without it", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(c.oid, 'pg_constraint') as description
      from pg_constraint c where c.conname = 'commitments_stream_unique'
    `;
    expect(row.description).toContain("NULLS NOT DISTINCT IS DELIBERATE");
    expect(row.description).toContain("WHAT BREAKS IF THIS IS CHANGED");
    expect(row.description).toContain("day one");
  });

  it("the constraint really is NULLS NOT DISTINCT in the catalog", async () => {
    const [row] = await sql<{ definition: string }[]>`
      select pg_get_constraintdef(c.oid) as definition
      from pg_constraint c where c.conname = 'commitments_stream_unique'
    `;
    expect(row.definition).toContain("NULLS NOT DISTINCT");
  });
});

describe("source authority", () => {
  it("the shared ordering covers exactly the database enum, so the two cannot drift", async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'commitment_source' order by e.enumsortorder
    `;
    const dbValues = rows.map((r) => r.enumlabel);
    const sharedValues = Object.keys(COMMITMENT_SOURCE_AUTHORITY);
    expect(dbValues).toEqual(sharedValues);
  });

  it("records that household_stated always wins and that authority is per stream", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(t.oid, 'pg_type') as description
      from pg_type t where t.typname = 'commitment_source'
    `;
    expect(row.description).toContain("ALWAYS WINS");
    expect(row.description).toContain("PER STREAM");
    expect(row.description).toContain("COMMITMENT_SOURCE_AUTHORITY");
  });
});

describe("the two direction enums are distinguishable", () => {
  it("have different value sets", async () => {
    const values = async (typname: string) =>
      (
        await sql<{ enumlabel: string }[]>`
          select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = ${typname} order by e.enumsortorder
        `
      ).map((r) => r.enumlabel);

    expect(await values("commitment_direction")).toEqual(["inflow", "outflow"]);
    expect(await values("transaction_direction")).toEqual([
      "income",
      "expense",
      "transfer",
      "undetermined",
    ]);
  });

  it("each comment names the other, so a copied filter is caught by reading", async () => {
    const describe_ = async (typname: string) =>
      (
        await sql<{ description: string | null }[]>`
          select obj_description(t.oid, 'pg_type') as description
          from pg_type t where t.typname = ${typname}
        `
      )[0].description ?? "";

    expect(await describe_("commitment_direction")).toContain("NOT transaction_direction");
    expect(await describe_("transaction_direction")).toContain("NOT commitment_direction");
  });
});

describe("household goals", () => {
  it("margin_target_pct is nullable, and a goals row with no target is valid", async () => {
    const [col] = await sql<{ is_nullable: string }[]>`
      select is_nullable from information_schema.columns
      where table_name = 'household_goals' and column_name = 'margin_target_pct'
    `;
    expect(col.is_nullable).toBe("YES");

    const household = uuid();
    const [row] = await sql<{ margin_target_pct: string | null }[]>`
      insert into household_goals (household_id) values (${household})
      returning margin_target_pct
    `;
    expect(row.margin_target_pct).toBeNull();
    await sql`delete from household_goals where household_id = ${household}`;
  });

  it("refuses a second goals row for the same household", async () => {
    const household = uuid();
    await sql`insert into household_goals (household_id) values (${household})`;
    await expect(
      sql`insert into household_goals (household_id) values (${household})`
    ).rejects.toThrow(/household_goals_household_unique/);
    await sql`delete from household_goals where household_id = ${household}`;
  });

  it("records that the null is an advice-gate input, not a display preference", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('household_goals'::regclass, ordinal_position) as description
      from information_schema.columns
      where table_name = 'household_goals' and column_name = 'margin_target_pct'
    `;
    expect(row.description).toContain("ADVICE-GATE CONCERN, NOT A DISPLAY PREFERENCE");
    expect(row.description).toContain("CITED AS THE METHOD");
    expect(row.description).toContain("FAILS the gate");
  });

  it("stores the Margin target as a percentage, not as money", async () => {
    const [row] = await sql<{ precision: number; scale: number }[]>`
      select numeric_precision as precision, numeric_scale as scale
      from information_schema.columns
      where table_name = 'household_goals' and column_name = 'margin_target_pct'
    `;
    expect([row.precision, row.scale]).toEqual([6, 3]);
  });
});
