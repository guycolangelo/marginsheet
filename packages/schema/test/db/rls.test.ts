// Row-level security: attempted cross-household reads, not policy inspection.
//
// A policy that exists and a policy that bites are different things, and the
// difference is the whole value. Every assertion here assumes the app role
// and tries to see something it must not.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL ?? "", { max: 1 });

const uuid = () => crypto.randomUUID();

beforeAll(() => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for introspection tests");
});
afterAll(async () => {
  await sql.end();
});

/** Two households, each with one transaction. */
async function seedTwoHouseholds() {
  const make = async () => {
    const household = uuid();
    const [item] = await sql<{ id: string }[]>`
      insert into plaid_items (household_id, item_id) values (${household}, ${"i_" + uuid()})
      returning id
    `;
    const [account] = await sql<{ id: string }[]>`
      insert into financial_accounts (household_id, plaid_item_id, plaid_account_id)
      values (${household}, ${item.id}, ${"a_" + uuid()}) returning id
    `;
    const [txn] = await sql<{ id: string }[]>`
      insert into transactions (household_id, account_id, date, amount, direction)
      values (${household}, ${account.id}, '2026-08-15', 100.00, 'expense')
      returning id
    `;
    return { household, accountId: account.id, transactionId: txn.id };
  };
  return { a: await make(), b: await make() };
}

async function cleanup(households: string[]) {
  for (const h of households) {
    await sql`delete from transactions where household_id = ${h}`;
    await sql`delete from financial_accounts where household_id = ${h}`;
    await sql`delete from plaid_items where household_id = ${h}`;
  }
}

describe("household isolation bites", () => {
  it("scoped to household A, the app role cannot see household B's transactions", async () => {
    const { a, b } = await seedTwoHouseholds();

    await sql`select set_config('marginsheet.household_id', ${a.household}, false)`;
    await sql`set role marginsheet_app`;
    try {
      const rows = await sql<{ id: string; household_id: string }[]>`
        select id, household_id from transactions
      `;
      const ids = rows.map((r) => r.id);
      expect(ids, "household A's own row must be visible").toContain(a.transactionId);
      expect(ids, "household B's row must be invisible").not.toContain(b.transactionId);
      // And nothing at all from another household leaked in.
      expect(rows.every((r) => r.household_id === a.household)).toBe(true);
    } finally {
      await sql`reset role`;
      await sql`select set_config('marginsheet.household_id', '', false)`;
    }

    await cleanup([a.household, b.household]);
  });

  it("a direct read of B's row by id returns nothing while scoped to A", async () => {
    const { a, b } = await seedTwoHouseholds();

    await sql`select set_config('marginsheet.household_id', ${a.household}, false)`;
    await sql`set role marginsheet_app`;
    try {
      const rows = await sql`select id from transactions where id = ${b.transactionId}`;
      expect(rows).toHaveLength(0);
    } finally {
      await sql`reset role`;
      await sql`select set_config('marginsheet.household_id', '', false)`;
    }

    await cleanup([a.household, b.household]);
  });

  it("FAILS CLOSED: an unset session sees zero rows, not all rows", async () => {
    const { a, b } = await seedTwoHouseholds();

    // Empty string and unset must behave identically. The nullif in the
    // predicate is what makes an empty GUC fail closed rather than raise a
    // cast error, which is the difference between a quiet zero-row result
    // and a 3am stack trace.
    for (const value of ["", "   "]) {
      await sql`select set_config('marginsheet.household_id', ${value}, false)`;
      await sql`set role marginsheet_app`;
      try {
        const rows = await sql`select id from transactions`;
        expect(rows, `GUC set to ${JSON.stringify(value)}`).toHaveLength(0);
      } finally {
        await sql`reset role`;
      }
    }

    await cleanup([a.household, b.household]);
  });

  it("WITH CHECK refuses writing a row into another household", async () => {
    const { a, b } = await seedTwoHouseholds();

    await sql`select set_config('marginsheet.household_id', ${a.household}, false)`;
    await sql`set role marginsheet_app`;
    try {
      await expect(
        sql`insert into transactions (household_id, account_id, date, amount, direction)
            values (${b.household}, ${b.accountId}, '2026-08-16', 5.00, 'expense')`
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await sql`reset role`;
      await sql`select set_config('marginsheet.household_id', '', false)`;
    }

    await cleanup([a.household, b.household]);
  });

  it("isolation holds on the conversation tables too, not only the ledger", async () => {
    const householdA = uuid();
    const householdB = uuid();
    const [ctxA] = await sql<{ id: string }[]>`
      insert into known_context (household_id, type, text)
      values (${householdA}, 'fact', 'A said this') returning id
    `;
    const [ctxB] = await sql<{ id: string }[]>`
      insert into known_context (household_id, type, text)
      values (${householdB}, 'fact', 'B said this') returning id
    `;

    await sql`select set_config('marginsheet.household_id', ${householdA}, false)`;
    await sql`set role marginsheet_app`;
    try {
      const rows = await sql<{ id: string }[]>`select id from known_context`;
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(ctxA.id);
      expect(ids).not.toContain(ctxB.id);
    } finally {
      await sql`reset role`;
      await sql`select set_config('marginsheet.household_id', '', false)`;
    }

    await sql`delete from known_context where id in (${ctxA.id}, ${ctxB.id})`;
  });
});

describe("invariant 2 under RLS", () => {
  it("the app role still cannot read the Plaid token, with policies now in force", async () => {
    const household = uuid();
    const [item] = await sql<{ id: string }[]>`
      insert into plaid_items (household_id, item_id, access_token_ciphertext)
      values (${household}, ${"i_" + uuid()}, 'secret-under-rls') returning id
    `;

    await sql`select set_config('marginsheet.household_id', ${household}, false)`;
    await sql`set role marginsheet_app`;
    try {
      // Even scoped to its OWN household, the column privilege still denies.
      await expect(
        sql`select access_token_ciphertext from plaid_items where id = ${item.id}`
      ).rejects.toThrow(/permission denied/i);
      // The row itself is visible; only the column is not.
      const rows = await sql`select id, status from plaid_items where id = ${item.id}`;
      expect(rows).toHaveLength(1);
    } finally {
      await sql`reset role`;
      await sql`select set_config('marginsheet.household_id', '', false)`;
    }

    await sql`delete from plaid_items where id = ${item.id}`;
  });
});

describe("coverage: every household-scoped table has the policy", () => {
  it("no household-scoped table was missed", async () => {
    const scoped = await sql<{ table_name: string }[]>`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (
          select 1 from information_schema.columns col
          where col.table_name = c.relname and col.column_name = 'household_id'
        )
      order by c.relname
    `;

    const withPolicy = await sql<{ tablename: string }[]>`
      select distinct tablename from pg_policies
      where schemaname = 'public' and policyname = 'household_isolation'
    `;
    const covered = new Set(withPolicy.map((r) => r.tablename));

    const missing = scoped.map((r) => r.table_name).filter((t) => !covered.has(t));
    expect(missing, `tables missing household_isolation: ${missing.join(", ")}`).toEqual([]);
  });

  it("households itself is covered, scoped by its own id", async () => {
    const [row] = await sql<{ qual: string }[]>`
      select qual from pg_policies
      where tablename = 'households' and policyname = 'household_isolation'
    `;
    expect(row.qual).toContain("id");
  });

  it("the two global tables are intentionally exempt", async () => {
    for (const table of ["institutions", "global_merchant_facts"]) {
      const [row] = await sql<{ relrowsecurity: boolean }[]>`
        select relrowsecurity from pg_class where relname = ${table}
      `;
      expect(row.relrowsecurity, `${table} should not have RLS`).toBe(false);
    }
  });

  it("records what the predicate is and what its absence would cost", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(p.oid, 'pg_policy') as description
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relname = 'transactions' and p.polname = 'household_isolation'
    `;
    expect(row.description).toContain("worse than any amount of downtime");
    expect(row.description).toContain("FAIL-CLOSED");
  });
});
