// The realSignIn() contract, and the layer 1 network-identity proof (3.2d).
//
// Rotation-guarded like the other adapter tests: it connects as
// marginsheet_app by setting the role's password, so it runs only where
// AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE is set (the ephemeral CI branch).
//
// AND IT MUST NOT RUN IN PARALLEL WITH auth-adapter.test.ts. Both files
// ALTER ROLE marginsheet_app in beforeAll, and vitest runs files in parallel
// by default, so two concurrent ALTERs on the same catalog row race and
// Postgres refuses the second with "tuple concurrently updated". CI caught
// that on 16 Aug 2026. The test:auth-adapter script passes
// --no-file-parallelism for this reason: these files mutate shared global
// state, not just their own rows.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { realSignIn } from "./helpers/real-sign-in.js";
import type { AuthEnv } from "../src/auth.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = Boolean(OWNER_URL) && process.env.AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE === "1";

const UA = "ProbeBrowser/9.9 (contract test)";
const IP = "203.0.113.77";

let env: AuthEnv;
let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const password = `probe_${crypto.randomUUID().replace(/-/g, "")}`;
  await owner.unsafe(`ALTER ROLE marginsheet_app LOGIN PASSWORD '${password}'`);
  const u = new URL(OWNER_URL!);
  u.username = "marginsheet_app";
  u.password = password;
  env = {
    NEON_DATABASE_URL: u.toString(),
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: "http://localhost:8787",
  };
  app = postgres(u.toString(), { max: 1 });
});

afterAll(async () => {
  if (owner) await owner.end();
  if (app) await app.end();
});

describe.skipIf(!configured)("the realSignIn contract", () => {
  it("signs in over HTTP and returns a cookie that came from Set-Cookie", async () => {
    const s = await realSignIn(env, { userAgent: UA, clientIp: IP });

    // Provenance, not just validity. A constructed cookie could still validate.
    expect(s.setCookieHeader, "no Set-Cookie header was present").toBeTruthy();
    expect(s.setCookieHeader).toContain(s.cookie);
    expect(s.response.status).toBeLessThan(400);
  });

  it("the session it returns exists in the database", async () => {
    const s = await realSignIn(env, { userAgent: UA, clientIp: IP });
    const rows = await app`select id from "session" where token = ${s.sessionToken}`;
    expect(rows, "the cookie names a session that does not exist").toHaveLength(1);
  });

  it("records auth_method as magic_link, from the endpoint the server ran", async () => {
    const s = await realSignIn(env, { userAgent: UA, clientIp: IP });
    const [row] = await app<{ auth_method: string | null }[]>`
      select auth_method from "session" where token = ${s.sessionToken}
    `;
    expect(row.auth_method).toBe("magic_link");
  });
});

describe.skipIf(!configured)("layer 1: disableIpTracking, proven with layer 2 removed", () => {
  it("stores no IP even with the trigger disabled, and DOES store the user agent", async () => {
    // THE POINT OF DISABLING THE TRIGGER. With 0012 active both columns are
    // nulled on write, so asserting null would pass identically with
    // disableIpTracking deleted. Layer 2 has to come off to see layer 1.
    await owner.unsafe('ALTER TABLE "session" DISABLE TRIGGER session_no_network_identity');
    try {
      const s = await realSignIn(env, { userAgent: UA, clientIp: IP });
      const [row] = await app<{ ip_address: string | null; user_agent: string | null }[]>`
        select ip_address, user_agent from "session" where token = ${s.sessionToken}
      `;

      // Layer 1 working: the IP was offered and refused. Better Auth writes an
      // EMPTY STRING rather than null when getIp returns null, so the
      // assertion is "no address was recorded", not "the column is null".
      // Asserting null would have failed for the right reason and reported the
      // wrong one.
      expect(row.ip_address ?? "", "an IP was stored despite disableIpTracking").toBe("");
      expect(row.ip_address ?? "", "the offered IP was recorded").not.toContain(IP);

      // THE TRIPWIRE. This asserts the request context genuinely reached the
      // session write. If it stopped, user_agent would go null and this fails,
      // which is the only way to tell "suppressed" apart from "never arrived".
      // It also documents the asymmetry: Better Auth has no config gate for
      // user agent, so for that column the trigger is the SOLE defence.
      expect(
        row.user_agent,
        "no user agent reached the session write, so the IP assertion above proves nothing"
      ).toBe(UA);
    } finally {
      await owner.unsafe('ALTER TABLE "session" ENABLE TRIGGER session_no_network_identity');
    }
  });

  it("with the trigger restored, stores neither", async () => {
    const s = await realSignIn(env, { userAgent: UA, clientIp: IP });
    const [row] = await app<{ ip_address: string | null; user_agent: string | null }[]>`
      select ip_address, user_agent from "session" where token = ${s.sessionToken}
    `;
    expect(row.ip_address).toBeNull();
    expect(row.user_agent).toBeNull();
  });

  it("the trigger is enabled again, so the previous test left nothing off", async () => {
    const [t] = await owner<{ tgenabled: string }[]>`
      select tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname = 'session' and t.tgname = 'session_no_network_identity'
    `;
    expect(t.tgenabled).toBe("O");
  });
});
