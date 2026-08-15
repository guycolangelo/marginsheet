// Verification for §3 the ledger, and the completion of invariant 1.
//
// Same posture throughout: attempt the forbidden thing and require failure.

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

/** A household with one item and one account, all agreeing. */
async function seedHousehold() {
  const household = uuid();
  const [item] = await sql<{ id: string }[]>`
    insert into plaid_items (household_id, item_id)
    values (${household}, ${"item_" + uuid()}) returning id
  `;
  const [account] = await sql<{ id: string }[]>`
    insert into financial_accounts (household_id, plaid_item_id, plaid_account_id)
    values (${household}, ${item.id}, ${"acct_" + uuid()}) returning id
  `;
  return { household, itemId: item.id, accountId: account.id };
}

async function cleanup(household: string) {
  await sql`delete from transactions where household_id = ${household}`;
  await sql`delete from financial_accounts where household_id = ${household}`;
  await sql`delete from plaid_items where household_id = ${household}`;
}

describe("invariant 1: transaction, account, and item households all agree", () => {
  it("refuses a transaction whose household differs from its account's", async () => {
    const a = await seedHousehold();
    const otherHousehold = uuid();

    await expect(
      sql`insert into transactions (household_id, account_id, date, amount, direction)
          values (${otherHousehold}, ${a.accountId}, '2026-08-15', 42.00, 'expense')`
    ).rejects.toThrow(/transactions_account_same_household_fk/);

    await cleanup(a.household);
  });

  it("refuses an account placed under another household's item", async () => {
    const a = await seedHousehold();
    const otherHousehold = uuid();

    await expect(
      sql`insert into financial_accounts (household_id, plaid_item_id, plaid_account_id)
          values (${otherHousehold}, ${a.itemId}, ${"acct_" + uuid()})`
    ).rejects.toThrow(/financial_accounts_item_same_household_fk/);

    await cleanup(a.household);
  });

  it("accepts the same insert when the households agree, so the constraint is not just blocking everything", async () => {
    const a = await seedHousehold();

    const [row] = await sql<{ id: string }[]>`
      insert into transactions (household_id, account_id, date, amount, direction)
      values (${a.household}, ${a.accountId}, '2026-08-15', 42.00, 'expense')
      returning id
    `;
    expect(row.id).toBeTruthy();

    await cleanup(a.household);
  });

  it("records that the invariant is structural, not merely tested", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(c.oid, 'pg_constraint') as description
      from pg_constraint c
      where c.conname = 'transactions_account_same_household_fk'
    `;
    expect(row.description).toContain("UNREPRESENTABLE");
  });
});

describe("direction drops unclassified (invariant 9)", () => {
  it("has exactly three values, and unclassified is not one", async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'transaction_direction' order by e.enumsortorder
    `;
    const values = rows.map((r) => r.enumlabel);
    expect(values).toEqual(["income", "expense", "transfer"]);
    expect(values).not.toContain("unclassified");
  });

  it("rejects unclassified outright, rather than storing it", async () => {
    const a = await seedHousehold();
    await expect(
      sql`insert into transactions (household_id, account_id, date, amount, direction)
          values (${a.household}, ${a.accountId}, '2026-08-15', 10.00, 'unclassified')`
    ).rejects.toThrow(/invalid input value for enum/i);
    await cleanup(a.household);
  });

  it("records the inclusion doctrine and its carve-out", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(t.oid, 'pg_type') as description
      from pg_type t where t.typname = 'transaction_direction'
    `;
    expect(row.description).toContain("INCLUSION DOCTRINE");
    expect(row.description).toContain("resolveDirection IS THE SINGLE SOURCE OF TRUTH");
    expect(row.description).toContain("materiality floor");
  });
});

describe("the single canonical merchant key", () => {
  it("carries the canonical steps and the retroactive-breakage warning", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('transactions'::regclass, ordinal_position) as description
      from information_schema.columns
      where table_name = 'transactions' and column_name = 'normalized_merchant_key'
    `;
    expect(row.description).toContain("THE SINGLE CANONICAL MERCHANT KEY");
    expect(row.description).toContain("TWO normalizations");
    expect(row.description).toContain("BREAKS LEARNED RECORDS RETROACTIVELY");
    expect(row.description).toContain("normalizeMerchantKey");
  });

  it("is indexed with household and direction, the shape the three operations query", async () => {
    const [row] = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where tablename = 'transactions' and indexname = 'transactions_merchant_key_idx'
    `;
    expect(row.indexdef).toContain("household_id");
    expect(row.indexdef).toContain("normalized_merchant_key");
    expect(row.indexdef).toContain("direction");
  });
});

describe("review state and queue reason", () => {
  it("review_state has the three real states and defaults to auto_filed", async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'review_state' order by e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual([
      "auto_filed",
      "needs_review",
      "user_reviewed",
    ]);

    const [col] = await sql<{ column_default: string | null }[]>`
      select column_default from information_schema.columns
      where table_name = 'transactions' and column_name = 'review_state'
    `;
    expect(col.column_default).toContain("auto_filed");
  });

  it("records that user_reviewed is untouchable by automated passes", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(t.oid, 'pg_type') as description
      from pg_type t where t.typname = 'review_state'
    `;
    expect(row.description).toContain("AUTHORITATIVE AND UNTOUCHABLE");
  });

  it("queue_reason ships seven values including ambiguous", async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'queue_reason' order by e.enumsortorder
    `;
    const values = rows.map((r) => r.enumlabel);
    expect(values).toHaveLength(7);
    expect(values).toContain("ambiguous");
  });

  it("records how the ledger-spec conflict resolved, so it is not re-litigated", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(t.oid, 'pg_type') as description
      from pg_type t where t.typname = 'queue_reason'
    `;
    expect(row.description).toContain("SPEC CONFLICT WAS RESOLVED HERE");
    expect(row.description).toContain("data-model-spec is authoritative");
  });

  it("the needs_review index is partial, not a full index", async () => {
    const [row] = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where tablename = 'transactions' and indexname = 'transactions_needs_review_idx'
    `;
    expect(row.indexdef).toContain("WHERE");
    expect(row.indexdef).toContain("needs_review");
  });
});

describe("ledger column types and uniqueness", () => {
  it("amount is numeric(14,2) and date is a bank day", async () => {
    const [amount] = await sql<{ precision: number; scale: number }[]>`
      select numeric_precision as precision, numeric_scale as scale
      from information_schema.columns
      where table_name = 'transactions' and column_name = 'amount'
    `;
    expect([amount.precision, amount.scale]).toEqual([14, 2]);

    const [date] = await sql<{ data_type: string }[]>`
      select data_type from information_schema.columns
      where table_name = 'transactions' and column_name = 'date'
    `;
    expect(date.data_type).toBe("date");
  });

  it("refuses a duplicate plaid_transaction_id", async () => {
    const a = await seedHousehold();
    const plaidId = `txn_${uuid()}`;

    await sql`
      insert into transactions (household_id, account_id, plaid_transaction_id, date, amount, direction)
      values (${a.household}, ${a.accountId}, ${plaidId}, '2026-08-15', 10.00, 'expense')
    `;
    await expect(
      sql`insert into transactions (household_id, account_id, plaid_transaction_id, date, amount, direction)
          values (${a.household}, ${a.accountId}, ${plaidId}, '2026-08-16', 11.00, 'expense')`
    ).rejects.toThrow(/transactions_plaid_transaction_id_unique/);

    await cleanup(a.household);
  });

  it("stores jsonb for the polymorphic Plaid payloads, not serialized text", async () => {
    for (const column of ["payment_meta", "counterparties", "destination", "chat_transcript"]) {
      const [row] = await sql<{ data_type: string }[]>`
        select data_type from information_schema.columns
        where table_name = 'transactions' and column_name = ${column}
      `;
      expect(row.data_type, column).toBe("jsonb");
    }
  });
});
