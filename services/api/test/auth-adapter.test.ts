// M3 task 3.0: Better Auth against a real database, as the real role.
//
// This is the durable form of the 3.0 spike. The spike proved once, by hand,
// that Better Auth's adapter runs in workerd against Neon authenticated as
// marginsheet_app. A thing proved once by hand is a thing that stops being
// true quietly, so it runs on every pull request now.
//
// WHY IT CONNECTS AS marginsheet_app AND NOT AS THE OWNER. The owner holds
// BYPASSRLS and every table privilege, so an auth stack that works as the
// owner tells you nothing about whether it works as the role the application
// actually uses. On 15 Aug 2026 every Worker was connecting as the owner
// while the mitigation on record said otherwise. The test sets the app role's
// password itself, using the owner connection CI already has, and then throws
// the owner connection away.
//
// !!! THIS TEST ROTATES marginsheet_app's PASSWORD. !!!
//
// It has to: the role's password is write-only in the secret store, so the
// only way to connect as it is to set a new one, and there is no way to put
// the old one back. Any environment whose Workers hold the previous password
// stops being able to reach its database until the secret is reissued.
//
// Running it against dev did exactly that on 15 Aug 2026, twice, and /health
// caught it both times within seconds. Against staging or production it would
// be an outage.
//
// So it refuses to run unless AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE is set, which
// CI sets ONLY on the ephemeral per-PR branch that gets destroyed minutes
// later. Locally, set it only when DATABASE_URL points at a branch you are
// willing to break, and reissue with scripts/put-app-db-url.sh afterwards.
//
// Requires DATABASE_URL (owner). Skips loudly if absent rather than passing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createAuth } from "../src/auth.js";

const OWNER_URL = process.env.DATABASE_URL;

// A test that silently no-ops when unconfigured is a test that reports success
// for an absent database. It is skipped explicitly and visibly instead.
const mayRotate = process.env.AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE === "1";
const configured = Boolean(OWNER_URL) && mayRotate;

if (OWNER_URL && !mayRotate) {
  console.warn(
    "\nauth-adapter tests SKIPPED: they rotate marginsheet_app's password.\n" +
      "Set AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE=1 only against a disposable branch.\n"
  );
}

let appUrl: string;
let owner: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });

  const password = `probe_${crypto.randomUUID().replace(/-/g, "")}`;
  await owner.unsafe(`ALTER ROLE marginsheet_app LOGIN PASSWORD '${password}'`);

  const u = new URL(OWNER_URL!);
  u.username = "marginsheet_app";
  u.password = password;
  appUrl = u.toString();
});

afterAll(async () => {
  if (owner) await owner.end();
});

function auth() {
  return createAuth({
    NEON_DATABASE_URL: appUrl,
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: "http://localhost:8787",
  });
}

describe.skipIf(!configured)("Better Auth runs as the RLS-subject application role", () => {
  it("connects as marginsheet_app, which holds no BYPASSRLS", async () => {
    const sql = postgres(appUrl, { max: 1 });
    try {
      const [row] = await sql<{ current_user: string; bypassrls: boolean }[]>`
        select current_user,
               coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypassrls
      `;
      expect(row.current_user).toBe("marginsheet_app");
      expect(row.bypassrls).toBe(false);
    } finally {
      await sql.end();
    }
  });

  it("completes a full session round trip", async () => {
    const ctx = await auth().$context;
    const email = `probe-${crypto.randomUUID()}@marginsheet.test`;

    const user = await ctx.internalAdapter.createUser({
      email,
      name: "Adapter Probe",
      emailVerified: false,
    });
    expect(user.id).toBeTruthy();

    try {
      const session = await ctx.internalAdapter.createSession(user.id, false);
      expect(session.token).toBeTruthy();

      // The round trip that matters: a second query finds the session by its
      // token and resolves it to the same user.
      const found = await ctx.internalAdapter.findSession(session.token);
      expect(found?.session.token).toBe(session.token);
      expect(found?.user.id).toBe(user.id);

      await ctx.internalAdapter.deleteSession(session.token);
      expect(await ctx.internalAdapter.findSession(session.token)).toBeFalsy();
    } finally {
      await ctx.internalAdapter.deleteUser(user.id);
    }
  });
});

describe.skipIf(!configured)("passwordless is a constraint, not a setting", () => {
  it("NEGATIVE CONTROL: the app role cannot write account.password", async () => {
    // identity-onboarding-spec §1 says passwordless, entirely. Configuration
    // saying emailAndPassword is disabled is a setting somebody can flip.
    // Migration 0011 withholds the column privilege, so the write fails at the
    // database. This proves the withholding bites rather than merely existing.
    const sql = postgres(appUrl, { max: 1 });
    const ctx = await auth().$context;
    const user = await ctx.internalAdapter.createUser({
      email: `pwprobe-${crypto.randomUUID()}@marginsheet.test`,
      name: "Password Probe",
      emailVerified: false,
    });

    try {
      await expect(
        sql`
          insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
          values (${crypto.randomUUID()}, 'a', 'credential', ${user.id}, 'hunter2', now(), now())
        `
      ).rejects.toThrow(/permission denied/i);

      // And the neighbouring columns still work, so the grant is surgical
      // rather than the app role simply having no access to the table.
      const id = crypto.randomUUID();
      await sql`
        insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
        values (${id}, 'a', 'credential', ${user.id}, now(), now())
      `;
      const rows = await sql`select id from account where id = ${id}`;
      expect(rows).toHaveLength(1);
      await sql`delete from account where id = ${id}`;
    } finally {
      await ctx.internalAdapter.deleteUser(user.id);
      await sql.end();
    }
  });

  it("NEGATIVE CONTROL: the app role cannot read account.password either", async () => {
    const sql = postgres(appUrl, { max: 1 });
    try {
      await expect(sql`select password from account limit 1`).rejects.toThrow(/permission denied/i);
    } finally {
      await sql.end();
    }
  });
});
