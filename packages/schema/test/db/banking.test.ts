// Verification for §2 banking and sync.
//
// Same posture as §1: attempt the forbidden thing and require failure. A
// column privilege that is granted but never exercised, and a unique index
// that is created but never collided with, are both indistinguishable from
// nothing at all until something tries them.

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

async function seedItem(): Promise<{ itemId: string; household: string }> {
  const household = uuid();
  const [row] = await sql<{ id: string }[]>`
    insert into plaid_items (household_id, item_id, access_token_ciphertext)
    values (${household}, ${"item_" + uuid()}, 'ciphertext-under-test')
    returning id
  `;
  return { itemId: row.id, household };
}

describe("invariant 2: the token column is unreadable by the app role", () => {
  it("marginsheet_app cannot select the ciphertext, and cannot reach it via SELECT *", async () => {
    const { itemId } = await seedItem();

    // The table owner bypasses column privileges, so the assertion is only
    // meaningful as the non-owning role.
    await sql`set role marginsheet_app`;
    try {
      await expect(
        sql`select access_token_ciphertext from plaid_items where id = ${itemId}`
      ).rejects.toThrow(/permission denied/i);

      // The convenient path must fail too, or the control is cosmetic.
      await expect(sql`select * from plaid_items where id = ${itemId}`).rejects.toThrow(
        /permission denied/i
      );
    } finally {
      await sql`reset role`;
    }

    await sql`delete from plaid_items where id = ${itemId}`;
  });

  it("marginsheet_app can still do its job on the other columns", async () => {
    const { itemId, household } = await seedItem();

    // Since migration 0008 the app role is also filtered by RLS, so this
    // read must scope itself the way a real request does. Without the GUC it
    // correctly sees zero rows, which is the fail-closed behavior rather
    // than a regression.
    await sql`select set_config('marginsheet.household_id', ${household}, false)`;
    await sql`set role marginsheet_app`;
    try {
      const rows = await sql<{ status: string }[]>`
        select id, household_id, item_id, status, sync_status
        from plaid_items where id = ${itemId}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("healthy");
    } finally {
      await sql`reset role`;
      await sql`select set_config('marginsheet.household_id', '', false)`;
    }

    await sql`delete from plaid_items where id = ${itemId}`;
  });

  it("marginsheet_sync can read the ciphertext, because someone has to", async () => {
    const { itemId } = await seedItem();

    await sql`set role marginsheet_sync`;
    try {
      const rows = await sql<{ access_token_ciphertext: string }[]>`
        select access_token_ciphertext from plaid_items where id = ${itemId}
      `;
      expect(rows[0].access_token_ciphertext).toBe("ciphertext-under-test");
    } finally {
      await sql`reset role`;
    }

    await sql`delete from plaid_items where id = ${itemId}`;
  });

  it("the column records who may decrypt it and where the key lives", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('plaid_items'::regclass, ordinal_position) as description
      from information_schema.columns
      where table_name = 'plaid_items' and column_name = 'access_token_ciphertext'
    `;
    expect(row.description).toContain("marginsheet_sync only");
    expect(row.description).toContain("TOKEN_ENCRYPTION_KEY");
    expect(row.description).toContain("COLUMN privilege, not an RLS policy");
  });
});

describe("invariant 5: a re-delivered webhook is refused by the constraint", () => {
  it("rejects the same (source, event_id) twice", async () => {
    const eventId = `evt_${uuid()}`;
    await sql`
      insert into provider_events (source, event_id, event_type, payload)
      values ('stripe', ${eventId}, 'invoice.paid', ${sql.json({ probe: true })})
    `;

    // The retry that actually happens in production.
    await expect(
      sql`insert into provider_events (source, event_id, event_type, payload)
          values ('stripe', ${eventId}, 'invoice.paid', ${sql.json({ probe: true })})`
    ).rejects.toThrow(/provider_events_source_event_id_unique/);

    // The same id from a different provider is a different event: uniqueness
    // on event_id alone would wrongly reject this.
    await sql`
      insert into provider_events (source, event_id, event_type, payload)
      values ('plaid', ${eventId}, 'SYNC_UPDATES_AVAILABLE', ${sql.json({ probe: true })})
    `;

    // Ordered as text: ordering by the enum itself would sort by declaration
    // order (stripe first), which is a real trap for anyone reading results.
    const rows = await sql<{ source: string }[]>`
      select source from provider_events where event_id = ${eventId}
      order by source::text
    `;
    expect(rows.map((r) => r.source)).toEqual(["plaid", "stripe"]);

    await sql`delete from provider_events where event_id = ${eventId}`;
  });

  it("records that handlers must insert here first", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('provider_events'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("CHECKS AND INSERTS HERE FIRST");
    expect(row.description).toContain("STRUCTURAL");
  });

  it("accepts an event whose household is not yet known", async () => {
    const eventId = `evt_${uuid()}`;
    const [row] = await sql<{ household_id: string | null }[]>`
      insert into provider_events (source, event_id, event_type)
      values ('stripe', ${eventId}, 'customer.created')
      returning household_id
    `;
    expect(row.household_id).toBeNull();
    await sql`delete from provider_events where event_id = ${eventId}`;
  });
});

describe("one balance snapshot per account per day", () => {
  it("refuses a second snapshot for the same account and day, accepts the next day", async () => {
    const household = uuid();
    const [item] = await sql<{ id: string }[]>`
      insert into plaid_items (household_id, item_id) values (${household}, ${"item_" + uuid()})
      returning id
    `;
    const [account] = await sql<{ id: string }[]>`
      insert into financial_accounts (household_id, plaid_item_id, plaid_account_id)
      values (${household}, ${item.id}, ${"acct_" + uuid()})
      returning id
    `;

    await sql`
      insert into account_balance_snapshots (household_id, account_id, date, current_balance)
      values (${household}, ${account.id}, '2026-08-15', 1200.00)
    `;

    await expect(
      sql`insert into account_balance_snapshots (household_id, account_id, date, current_balance)
          values (${household}, ${account.id}, '2026-08-15', 1250.00)`
    ).rejects.toThrow(/account_balance_snapshots_account_date_unique/);

    await sql`
      insert into account_balance_snapshots (household_id, account_id, date, current_balance)
      values (${household}, ${account.id}, '2026-08-16', 1250.00)
    `;

    await sql`delete from account_balance_snapshots where account_id = ${account.id}`;
    await sql`delete from financial_accounts where id = ${account.id}`;
    await sql`delete from plaid_items where id = ${item.id}`;
  });

  it("stores the snapshot date as a bank day, not an instant", async () => {
    const [row] = await sql<{ data_type: string }[]>`
      select data_type from information_schema.columns
      where table_name = 'account_balance_snapshots' and column_name = 'date'
    `;
    expect(row.data_type).toBe("date");
  });
});

describe("the FK chain holds (invariant 1, the half that exists in 1.2)", () => {
  it("refuses to delete an item that still has accounts", async () => {
    const household = uuid();
    const [item] = await sql<{ id: string }[]>`
      insert into plaid_items (household_id, item_id) values (${household}, ${"item_" + uuid()})
      returning id
    `;
    const [account] = await sql<{ id: string }[]>`
      insert into financial_accounts (household_id, plaid_item_id, plaid_account_id)
      values (${household}, ${item.id}, ${"acct_" + uuid()})
      returning id
    `;

    // Postgres words RESTRICT violations as "violates RESTRICT setting of
    // foreign key constraint" (SQLSTATE 23001), not the plain NO ACTION
    // wording. Assert on the constraint name, which is stable across both.
    await expect(sql`delete from plaid_items where id = ${item.id}`).rejects.toThrow(
      /financial_accounts_plaid_item_id_plaid_items_id_fk/
    );

    await sql`delete from financial_accounts where id = ${account.id}`;
    await sql`delete from plaid_items where id = ${item.id}`;
  });

  it("refuses an account pointing at an item that does not exist", async () => {
    await expect(
      sql`insert into financial_accounts (household_id, plaid_item_id, plaid_account_id)
          values (${uuid()}, ${uuid()}, ${"acct_" + uuid()})`
    ).rejects.toThrow(/violates foreign key constraint/i);
  });
});

describe("types and scoping", () => {
  it("APRs are numeric(6,3) and balances are numeric(14,2)", async () => {
    const [apr] = await sql<{ precision: number; scale: number }[]>`
      select numeric_precision as precision, numeric_scale as scale
      from information_schema.columns
      where table_name = 'liability_details' and column_name = 'purchase_apr'
    `;
    expect([apr.precision, apr.scale]).toEqual([6, 3]);

    const [balance] = await sql<{ precision: number; scale: number }[]>`
      select numeric_precision as precision, numeric_scale as scale
      from information_schema.columns
      where table_name = 'financial_accounts' and column_name = 'current_balance'
    `;
    expect([balance.precision, balance.scale]).toEqual([14, 2]);
  });

  it("institutions is global and says so; the rest are household-scoped", async () => {
    const [inst] = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_name = 'institutions' and column_name = 'household_id'
    `;
    expect(inst.n).toBe(0);

    const [comment] = await sql<{ description: string | null }[]>`
      select obj_description('institutions'::regclass, 'pg_class') as description
    `;
    expect(comment.description).toContain("GLOBAL");

    for (const table of [
      "plaid_items",
      "financial_accounts",
      "account_balance_snapshots",
      "liability_details",
    ]) {
      const [row] = await sql<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_name = ${table} and column_name = 'household_id'
      `;
      expect(row, `${table} is missing household_id`).toBeTruthy();
      expect(row.is_nullable, table).toBe("NO");
    }
  });

  it("both roles exist and carry their provenance comments", async () => {
    const rows = await sql<{ rolname: string; description: string | null }[]>`
      select r.rolname, shobj_description(r.oid, 'pg_authid') as description
      from pg_roles r
      where r.rolname in ('marginsheet_app', 'marginsheet_sync')
      order by r.rolname
    `;
    expect(rows.map((r) => r.rolname)).toEqual(["marginsheet_app", "marginsheet_sync"]);
    expect(rows[0].description).toContain("migration 0002");
    expect(rows[1].description).toContain("invariant 2");
  });
});
