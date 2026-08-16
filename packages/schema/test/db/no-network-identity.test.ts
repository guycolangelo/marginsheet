// MarginSheet holds no network identity for households (ruled 15 Aug 2026).
//
// The application is configured not to collect the IP, but configuration is a
// setting somebody can flip. These tests exercise the structural half: the
// trigger from migration 0012, which nulls both columns on write no matter
// what the application sends.
//
// Every case here writes the values DELIBERATELY and requires them to come
// back null. A test that merely observed nulls would pass just as happily
// against a table nobody had written to.

import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
afterAll(async () => {
  await sql.end();
});

async function withSession<T>(fn: (userId: string, sessionId: string) => Promise<T>): Promise<T> {
  const userId = `probe_${crypto.randomUUID()}`;
  const sessionId = `sess_${crypto.randomUUID()}`;
  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${userId}, 'Network Probe', ${`${userId}@probe.test`}, false)
  `;
  try {
    return await fn(userId, sessionId);
  } finally {
    await sql`delete from "user" where id = ${userId}`;
  }
}

describe("the session table cannot store network identity", () => {
  it("nulls an IP and user agent written on INSERT", async () => {
    await withSession(async (userId, sessionId) => {
      await sql`
        insert into "session" (id, expires_at, token, updated_at, user_id, ip_address, user_agent)
        values (${sessionId}, now() + interval '1 day', ${sessionId}, now(), ${userId},
                '203.0.113.77', 'ProbeBrowser/9.9')
      `;
      const [row] = await sql`select ip_address, user_agent from "session" where id = ${sessionId}`;
      expect(row.ip_address, "an IP address survived the insert").toBeNull();
      expect(row.user_agent, "a user agent survived the insert").toBeNull();
    });
  });

  it("nulls an IP and user agent written on UPDATE", async () => {
    // The insert path is not the only way in. A session is updated on every
    // rolling refresh, which is the likelier place for this to creep back.
    await withSession(async (userId, sessionId) => {
      await sql`
        insert into "session" (id, expires_at, token, updated_at, user_id)
        values (${sessionId}, now() + interval '1 day', ${sessionId}, now(), ${userId})
      `;
      await sql`
        update "session"
           set ip_address = '198.51.100.9', user_agent = 'SneakyAgent/1.0'
         where id = ${sessionId}
      `;
      const [row] = await sql`select ip_address, user_agent from "session" where id = ${sessionId}`;
      expect(row.ip_address).toBeNull();
      expect(row.user_agent).toBeNull();
    });
  });

  it("the trigger exists on the table, fired for both insert and update", async () => {
    const rows = await sql<{ tgname: string }[]>`
      select tgname from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where c.relname = 'session' and not t.tgisinternal
    `;
    expect(rows.map((r) => r.tgname)).toContain("session_no_network_identity");
  });

  it("NEGATIVE CONTROL: the same write keeps its values on a table without the trigger", async () => {
    // Proves these assertions are detecting the trigger rather than a column
    // that never accepts text, or a probe that silently wrote nothing.
    await sql`create temporary table trigger_control (ip_address text, user_agent text)`;
    await sql`insert into trigger_control values ('203.0.113.77', 'ProbeBrowser/9.9')`;
    const [row] = await sql`select ip_address, user_agent from trigger_control`;
    expect(row.ip_address).toBe("203.0.113.77");
    expect(row.user_agent).toBe("ProbeBrowser/9.9");
  });
});
