// marginsheet_sync's boundary, attempted rather than inspected (M4 task 4.1).
//
// The role is described in the custody doc as "The Plaid sync worker. The only
// place TOKEN_ENCRYPTION_KEY is used to decrypt." Before 0023 it held INSERT,
// SELECT and UPDATE on 39 tables including messages, threads, known_context,
// decision_journal and every LLM log. A ROLE'S DOCUMENTATION IS A SECURITY
// CLAIM AND THE GRANT IS WHAT IS TRUE.
//
// WHY THIS ASSERTS ON THE ERROR CODE AND NOT ON ROW COUNTS. Every one of these
// tables carries household_isolation, so a SELECT the role IS allowed to make
// returns zero rows when no GUC is set. A test asserting "no rows came back"
// would therefore pass with the wide grant fully intact, proving RLS works and
// saying nothing at all about the grant. It has to be 42501, insufficient
// privilege, or it is not testing the thing it claims to test.
//
// WHY THREE TABLES AND NOT ONE (Guy, 17 Aug 2026). One refusal proves a
// boundary exists. Three from different sections of the schema prove it is a
// boundary rather than a single lucky revoke. messages is the conversation
// itself, known_context is what the brains remember about a household, and
// decision_journal is the advisory record. A sync worker reaching any of them
// is the failure this migration exists to prevent.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const OWNER_URL = process.env.DATABASE_URL;
const configured = Boolean(OWNER_URL);

let sql: ReturnType<typeof postgres>;

beforeAll(() => {
  if (configured) sql = postgres(OWNER_URL!, { max: 1 });
});
afterAll(async () => {
  if (sql) await sql.end();
});

/** Runs one statement with the sync role's privileges and returns the error code.
 *
 * NOT IN A TRANSACTION, deliberately. The first version wrapped this in
 * sql.begin() and every refusal failed the test rather than satisfying it: a
 * statement that errors inside a transaction aborts it, and postgres.js
 * rethrows the original error past the catch. The refusals were CORRECT and
 * the harness reported them as failures.
 *
 * A reserved connection gives the same isolation for what this needs, which is
 * that SET ROLE does not leak to another test, without a transaction to
 * poison. RESET ROLE runs in finally so a throwing statement cannot leave the
 * connection holding the sync role when it returns to the pool. */
async function asSyncRole(statement: string): Promise<{ ok: boolean; code?: string }> {
  const conn = await sql.reserve();
  try {
    await conn.unsafe("SET ROLE marginsheet_sync");
    try {
      await conn.unsafe(statement);
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, code: (error as { code?: string }).code };
    } finally {
      await conn.unsafe("RESET ROLE");
    }
  } finally {
    conn.release();
  }
}

const FORBIDDEN = [
  ["messages", "the household's conversation with its own assistant"],
  ["known_context", "what the brains remember about a household"],
  ["decision_journal", "the advisory record"],
] as const;

describe.skipIf(!configured)("the sync role cannot reach what it has no business reaching", () => {
  for (const [table, what] of FORBIDDEN) {
    it(`is REFUSED a read of ${table}`, async () => {
      const result = await asSyncRole(`select * from "${table}" limit 1`);
      expect(
        result.ok,
        `marginsheet_sync read ${table}: ${what}. The grant is wider than the role's description.`
      ).toBe(false);
      // 42501 is insufficient_privilege. Anything else means the statement
      // failed for an unrelated reason and this test proved nothing.
      expect(
        result.code,
        `${table} refused with ${result.code}, not 42501. A refusal for the wrong reason is not a boundary.`
      ).toBe("42501");
    });
  }

  it("is REFUSED a write to messages, not merely a read", async () => {
    // The pre-0023 grant carried INSERT and UPDATE as well as SELECT, and a
    // sync worker that can WRITE a household's conversation is a worse
    // outcome than one that can read it.
    const result = await asSyncRole(
      `insert into "messages" (id) values (gen_random_uuid())`
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("42501");
  });
});

describe.skipIf(!configured)("the sync role can still do its actual job", () => {
  it("reads plaid_items.access_token_ciphertext, which is why it exists", async () => {
    // The positive half. A boundary that refuses everything is not a
    // narrowing, it is a broken role, and this is the one column no other
    // role may read.
    const result = await asSyncRole(
      `select access_token_ciphertext from "plaid_items" limit 1`
    );
    expect(
      result.ok,
      `the sync role cannot read the token column it exists to read: ${result.code}`
    ).toBe(true);
  });

  for (const table of [
    "institutions",
    "financial_accounts",
    "account_balance_snapshots",
    "liability_details",
    "transactions",
    "provider_events",
    "commitments",
  ]) {
    it(`can read ${table}`, async () => {
      const result = await asSyncRole(`select * from "${table}" limit 1`);
      expect(result.ok, `${table} refused with ${result.code}`).toBe(true);
    });
  }
});

describe.skipIf(!configured)("the narrowing is enumerated, so a new table is not silently reachable", () => {
  it("holds grants on exactly the 11 tables 0023, 0024 and 0038 name", async () => {
    // The shape assertion. If somebody adds a table and grants it broadly,
    // this goes red and sends them to 0023's comment, which explains why the
    // list is a list.
    const rows = await sql<{ table_name: string }[]>`
      select distinct table_name
      from information_schema.role_table_grants
      where grantee = 'marginsheet_sync' and table_schema = 'public'
      order by table_name
    `;
    expect(rows.map((r) => r.table_name)).toEqual([
      "account_balance_snapshots",
      // ADDED BY 0038, DELIBERATELY AND BY NAME, which is the process 0023's
      // own comment prescribes: "if the pipeline needs a tenth table, add it
      // here by name and add it to the negative control's knowledge".
      //
      // IT IS THE RIGHT KIND OF WIDENING and that distinction is the whole
      // point of the enumeration. balance_reconciliations is a table the sync
      // pipeline OWNS and writes as part of its one job. The same migration's
      // first draft would have granted insight_ledger, which is a conversation
      // table 0023 names as its own example of what this role must not reach,
      // and that was refused rather than added here.
      "balance_reconciliations",
      "commitments",
      "financial_accounts",
      "household_state_signals",
      "institutions",
      "liability_details",
      "plaid_items",
      "provider_events",
      "schema_migrations",
      "transactions",
    ]);
  });
});
