// Verification by introspection (ruled 15 Aug 2026).
//
// This asks Postgres what actually landed. It does not read the Drizzle
// schema, the migration file, or the migration's own output. Those are
// reports; the database is the data. This file is also the template every
// later section's verification follows.
//
// Runs against the PR's ephemeral Neon branch in CI, after migrate:up.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL ?? "", { max: 1 });

beforeAll(() => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for introspection tests");
});
afterAll(async () => {
  await sql.end();
});

describe("conventions hold in the database", () => {
  it("money is exact decimal: numeric(14,2) does not drift where float does", async () => {
    // 1.0 lands no money column yet (categories holds none), so this proves
    // the property the convention exists for, against the real engine. 1.1
    // replaces it with assertions on actual money columns.
    await sql`create temp table money_probe (amount numeric(14,2), loose double precision)`;
    await sql`insert into money_probe values (0.10, 0.10), (0.20, 0.20)`;

    const [row] = await sql<{ exact: string; drifted: number }[]>`
      select sum(amount)::text as exact, sum(loose) as drifted from money_probe
    `;
    // The exact column sums to precisely 0.30; the float column is why we do
    // not use floats for money.
    expect(row.exact).toBe("0.30");
    expect(row.drifted).not.toBe(0.3);

    const [col] = await sql<{ precision: number; scale: number }[]>`
      select numeric_precision as precision, numeric_scale as scale
      from information_schema.columns
      where table_name = 'money_probe' and column_name = 'amount'
    `;
    expect(col.precision).toBe(14);
    expect(col.scale).toBe(2);
  });

  it("timestamps are timestamptz, never bare timestamp", async () => {
    const rows = await sql<{ column_name: string; data_type: string }[]>`
      select column_name, data_type
      from information_schema.columns
      where table_name = 'categories'
        and column_name in ('created_at', 'updated_at')
      order by column_name
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.data_type, row.column_name).toBe("timestamp with time zone");
    }
  });

  it("primary key defaults to uuidv7(), generated in the database", async () => {
    const [row] = await sql<{ column_default: string | null }[]>`
      select column_default
      from information_schema.columns
      where table_name = 'categories' and column_name = 'id'
    `;
    expect(row.column_default).toContain("uuidv7()");
  });

  it("household_id is present and not null", async () => {
    const [row] = await sql<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type
      from information_schema.columns
      where table_name = 'categories' and column_name = 'household_id'
    `;
    expect(row.data_type).toBe("uuid");
    expect(row.is_nullable).toBe("NO");
  });
});

describe("rulings are queryable in the database", () => {
  it("pl_line has exactly the seven values, and taxes is not among them", async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'pl_line'
      order by e.enumsortorder
    `;
    const values = rows.map((r) => r.enumlabel);
    expect(values).toEqual([
      "income",
      "fixed_obligations",
      "variable_operating",
      "discretionary",
      "interest_fees",
      "transfer",
      "deployment",
    ]);
    expect(values).not.toContain("taxes");
  });

  it("the taxes ruling is readable from the database, not only from the repo", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(t.oid, 'pg_type') as description
      from pg_type t
      where t.typname = 'pl_line'
    `;
    expect(row.description).toBeTruthy();
    expect(row.description).toContain("Taxes is NOT a line");
    expect(row.description).toContain("Taxes After Takehome");
  });

  it("the categories table carries its doctrine comment", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('categories'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("Gifts received");
  });
});

describe("updated_at is maintained by trigger, not by hope", () => {
  it("a row's updated_at advances on update without the writer setting it", async () => {
    const household = crypto.randomUUID();
    const [inserted] = await sql<{ id: string; updated_at: Date }[]>`
      insert into categories (household_id, name, pl_line)
      values (${household}, 'introspection probe', 'discretionary')
      returning id, updated_at
    `;

    await new Promise((r) => setTimeout(r, 10));

    const [updated] = await sql<{ updated_at: Date }[]>`
      update categories set name = 'introspection probe, renamed'
      where id = ${inserted.id}
      returning updated_at
    `;

    expect(updated.updated_at.getTime()).toBeGreaterThan(inserted.updated_at.getTime());
    await sql`delete from categories where id = ${inserted.id}`;
  });
});
