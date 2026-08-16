// session.auth_method: the one field the §1 tightening rests on.
//
// The guard logic is tested in services/api/test/auth-guard.test.ts. This
// pins the column itself, because the control depends less on the comparison
// than on the PROVENANCE of the value being compared.

import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
afterAll(async () => {
  await sql.end();
});

describe("session.auth_method", () => {
  it("is nullable, because sessions predate it and NULL is the weakest class", async () => {
    const [col] = await sql<{ is_nullable: string; udt_name: string }[]>`
      select is_nullable, udt_name from information_schema.columns
       where table_name = 'session' and column_name = 'auth_method'
    `;
    expect(col).toBeTruthy();
    expect(col.is_nullable).toBe("YES");
    // text, not an enum: Better Auth's adapter binds a text parameter and an
    // enum column would reject it. The CHECK below does the constraining.
    expect(col.udt_name).toBe("text");
  });

  it("admits exactly the two credential classes, by CHECK constraint", async () => {
    const [c] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'session_auth_method_known'
    `;
    expect(c, "the CHECK constraint is missing").toBeTruthy();
    expect(c.def).toContain("'passkey'");
    expect(c.def).toContain("'magic_link'");
  });

  it("NEGATIVE CONTROL: rejects a third credential class", async () => {
    // A third value would be a class nobody wrote a rule for, and the guard
    // would silently treat it as the weakest.
    const [u] = await sql<{ id: string }[]>`
      insert into "user" (id, name, email, email_verified)
      values (${`ck_${crypto.randomUUID()}`}, 'Check Probe', ${`ck_${crypto.randomUUID()}@probe.test`}, false)
      returning id
    `;
    const sid = `sess_${crypto.randomUUID()}`;
    try {
      await expect(
        sql`
          insert into "session" (id, expires_at, token, updated_at, user_id, auth_method)
          values (${sid}, now() + interval '1 day', ${sid}, now(), ${u.id}, 'sms_code')
        `
      ).rejects.toThrow(/session_auth_method_known/);
    } finally {
      await sql`delete from "user" where id = ${u.id}`;
    }
  });

  it("carries the reason a client-supplied value would void the control", async () => {
    // Doctrine in the database, same pattern as M1's column comments. Someone
    // wiring this field from a request body should hit this sentence first.
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('session'::regclass, ordinal_position) as description
        from information_schema.columns
       where table_name = 'session' and column_name = 'auth_method'
    `;
    expect(row.description).toContain("SERVER-WRITTEN ONLY");
    expect(row.description).toContain("ADVISORY");
    expect(row.description).toContain("WEAKEST");
  });

  it("the app role can read and write it, since it authorises and records", async () => {
    for (const priv of ["SELECT", "INSERT", "UPDATE"]) {
      const [r] = await sql`
        select has_column_privilege('marginsheet_app','session','auth_method',${priv}) as p
      `;
      expect(r.p, `app role lacks ${priv} on session.auth_method`).toBe(true);
    }
  });

  it("the 0012 trigger does not touch it, only the network-identity columns", async () => {
    // The trigger nulls ip_address and user_agent on every write. If it ever
    // grew to null this column too, every session would look like the weakest
    // class and the tightening would refuse every phone change.
    const [u] = await sql<{ id: string }[]>`
      insert into "user" (id, name, email, email_verified)
      values (${`am_${crypto.randomUUID()}`}, 'Auth Method Probe', ${`am_${crypto.randomUUID()}@probe.test`}, false)
      returning id
    `;
    const sid = `sess_${crypto.randomUUID()}`;
    try {
      await sql`
        insert into "session" (id, expires_at, token, updated_at, user_id, auth_method)
        values (${sid}, now() + interval '1 day', ${sid}, now(), ${u.id}, 'passkey')
      `;
      const [row] = await sql<{ auth_method: string | null }[]>`
        select auth_method from "session" where id = ${sid}
      `;
      expect(row.auth_method).toBe("passkey");
    } finally {
      await sql`delete from "user" where id = ${u.id}`;
    }
  });
});
