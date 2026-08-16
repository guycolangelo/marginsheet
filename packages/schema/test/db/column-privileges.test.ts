// Column-level privilege controls, verified against the catalog.
//
// WHY THIS FILE EXISTS. On 15 Aug 2026, while testing whether Better Auth's
// session columns could be locked down by revoking column privileges, the
// experiment "passed" and proved nothing:
//
//   REVOKING A COLUMN PRIVILEGE IS A NO-OP WHILE THE ROLE STILL HOLDS THE
//   TABLE-LEVEL PRIVILEGE.
//
// Postgres treats table and column grants as separate. A table-level GRANT
// covers every column, including ones a later column-level REVOKE claims to
// protect. So a migration can contain a carefully enumerated column grant,
// read as a control in review, and enforce nothing.
//
// This repo has two column-level controls and will grow more. Each one is
// asserted here against has_column_privilege, which is Postgres's own answer
// and accounts for table-level masking. Reviewing the GRANT statement is not
// enough, because the GRANT statement is exactly what fooled the experiment.

import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
afterAll(async () => {
  await sql.end();
});

interface Denial {
  table: string;
  column: string;
  role: string;
  denied: Array<"SELECT" | "INSERT" | "UPDATE">;
  why: string;
}

const DENIALS: Denial[] = [
  {
    table: "account",
    column: "password",
    role: "marginsheet_app",
    denied: ["SELECT", "INSERT", "UPDATE"],
    why: "identity-onboarding-spec §1 is passwordless entirely. Configuration saying emailAndPassword is disabled is a setting; this is a constraint (migration 0011).",
  },
  {
    table: "plaid_items",
    column: "access_token_ciphertext",
    role: "marginsheet_app",
    denied: ["SELECT", "INSERT", "UPDATE"],
    why: "Invariant 2: the token is unreadable by any RLS role; only the sync worker decrypts (0002). INSERT and UPDATE closed by 0013, which revoked the table-level grants that had been masking the column control since 0002. The app role has no legitimate reason to write a token: only the sync worker mints or rotates one.",
  },
];

describe("column-level denials actually deny, table grants included", () => {
  for (const d of DENIALS) {
    for (const priv of d.denied) {
      it(`${d.role} has no ${priv} on ${d.table}.${d.column}`, async () => {
        const [row] = await sql<{ allowed: boolean }[]>`
          select has_column_privilege(${d.role}, ${d.table}, ${d.column}, ${priv}) as allowed
        `;
        expect(
          row.allowed,
          `${d.role} can ${priv} ${d.table}.${d.column}. ${d.why}`
        ).toBe(false);
      });
    }
  }

  it("marginsheet_sync CAN read the Plaid token, so the denial is targeted", async () => {
    // A denial that applied to every role would break the sync worker, and a
    // test that only checked the denial would call that success.
    const [row] = await sql<{ allowed: boolean }[]>`
      select has_column_privilege('marginsheet_sync', 'plaid_items', 'access_token_ciphertext', 'SELECT') as allowed
    `;
    expect(row.allowed).toBe(true);
  });
});

describe("NEGATIVE CONTROL: the check detects a table grant masking a column denial", () => {
  it("reports allowed when a table-level grant covers a column with no column grant", async () => {
    // Reproduces the exact trap, in a rolled-back transaction. Without this,
    // every assertion above could be passing because has_column_privilege
    // always returns false for something.
    await sql
      .begin(async (tx) => {
        await tx`create table mask_probe (safe text, secret text)`;
        // Column grant on one column only. Looks like a control.
        await tx`grant select (safe) on mask_probe to marginsheet_app`;
        const [before] = await tx`
          select has_column_privilege('marginsheet_app', 'mask_probe', 'secret', 'SELECT') as allowed
        `;
        expect(before.allowed, "the column denial should hold before masking").toBe(false);

        // Now the table-level grant that silently voids it.
        await tx`grant select on mask_probe to marginsheet_app`;
        const [after] = await tx`
          select has_column_privilege('marginsheet_app', 'mask_probe', 'secret', 'SELECT') as allowed
        `;
        expect(
          after.allowed,
          "a table-level grant must mask the column denial, or this check proves nothing"
        ).toBe(true);

        throw new Error("rollback the probe");
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== "rollback the probe") throw e;
      });
  });
});

describe("the app role can still do its legitimate work on plaid_items", () => {
  // A denial that broke the surrounding writes would be a control that
  // removed the feature, which is the mistake 0012's header warns about.
  it("holds INSERT and UPDATE on the operational columns", async () => {
    for (const col of ["household_id", "item_id", "status", "sync_cursor"]) {
      const [ins] = await sql`select has_column_privilege('marginsheet_app','plaid_items',${col},'INSERT') as p`;
      expect(ins.p, `app role lost INSERT on plaid_items.${col}`).toBe(true);
    }
    for (const col of ["status", "sync_cursor", "sync_status", "last_synced_at"]) {
      const [upd] = await sql`select has_column_privilege('marginsheet_app','plaid_items',${col},'UPDATE') as p`;
      expect(upd.p, `app role lost UPDATE on plaid_items.${col}`).toBe(true);
    }
  });

  it("marginsheet_sync can still write the token, or nothing could mint one", async () => {
    const [r] = await sql`select has_column_privilege('marginsheet_sync','plaid_items','access_token_ciphertext','UPDATE') as p`;
    expect(r.p).toBe(true);
  });

  it("the token column is nullable, which is what lets the app create a row at all", async () => {
    const [c] = await sql<{ is_nullable: string }[]>`
      select is_nullable from information_schema.columns
       where table_name='plaid_items' and column_name='access_token_ciphertext'
    `;
    expect(c.is_nullable).toBe("YES");
  });
});
