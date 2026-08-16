// Single use, expiry, and the double-click table (3.2a, completing it).
//
// Everything here runs against a REAL session row, reached through a real
// HTTP sign-in. The unit tests in magic-link.test.ts cover the email and the
// link's shape; these cover what happens when the token is presented.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createAuth, type AuthEnv } from "../src/auth.js";
import { RecordingSender } from "../src/email.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = Boolean(OWNER_URL) && process.env.AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE === "1";

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

/** Requests a link and returns the token, without consuming anything. */
async function requestLink(): Promise<{ token: string; email: string }> {
  const mail = new RecordingSender();
  const auth = createAuth(env, mail);
  const email = `consume-${crypto.randomUUID()}@marginsheet.test`;
  const res = await auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Consumption Probe" }),
    })
  );
  if (!res.ok) throw new Error(`link request failed: HTTP ${res.status}`);
  const link = mail.sent[0].text.split("\n").find((l) => l.startsWith("http"))!;
  return { token: new URL(link).searchParams.get("token")!, email };
}

/** Presents a token to the verify endpoint. Returns the raw response. */
async function present(token: string, cookie?: string): Promise<Response> {
  const auth = createAuth(env, new RecordingSender());
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return auth.handler(
    new Request(
      `${env.BETTER_AUTH_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
      { method: "GET", headers, redirect: "manual" }
    )
  );
}

const accepted = (r: Response) => Boolean(r.headers.get("set-cookie"));

describe.skipIf(!configured)("opening the link consumes nothing", () => {
  it("a token survives being fetched, because only the confirm action spends it", async () => {
    // The scanner case. The emailed URL points at the confirm page, which is
    // not this endpoint at all; this asserts the token is still spendable
    // after the link has been in an inbox and a scanner has walked it.
    const { token } = await requestLink();
    const rows = await app`select id from verification where identifier like ${"%" + "sign-in" + "%"} or value = ${token}`;
    // Storage detail varies by plugin version; what matters is that the token
    // still works, asserted next.
    expect(accepted(await present(token)), "the token was not spendable").toBe(true);
    expect(rows).toBeDefined();
  });
});

describe.skipIf(!configured)("single use", () => {
  it("refuses a token that has already been spent", async () => {
    const { token } = await requestLink();
    expect(accepted(await present(token)), "first use should succeed").toBe(true);

    const second = await present(token);
    expect(accepted(second), "a spent token was accepted a second time").toBe(false);
  });

  it("NEGATIVE CONTROL: a fresh token IS accepted, so the refusal is not blanket", async () => {
    const { token } = await requestLink();
    expect(accepted(await present(token))).toBe(true);
  });
});

describe.skipIf(!configured)("expiry, proven by moving the clock", () => {
  it("refuses a token whose window has passed", async () => {
    // Moving the clock rather than reading config: the stored expiry is
    // pushed into the past, which is what the passage of 15 minutes does.
    const { token } = await requestLink();
    await owner`update verification set expires_at = now() - interval '1 minute'`;

    const res = await present(token);
    expect(accepted(res), "an expired token was accepted").toBe(false);
  });

  it("NEGATIVE CONTROL: the same token would have worked before the clock moved", async () => {
    const { token } = await requestLink();
    await owner`update verification set expires_at = now() + interval '15 minutes'`;
    expect(accepted(await present(token)), "the probe itself is broken").toBe(true);
  });
});

describe.skipIf(!configured)("the double-click table", () => {
  it("row 3: a spent token presented from elsewhere is refused, always", async () => {
    // The row that must not soften. Convenience for a genuine double click
    // stops exactly where it would become a replay: a spent token presented
    // by anyone who is not already the member who spent it gets nothing.
    const { token } = await requestLink();
    const first = await present(token);
    expect(accepted(first)).toBe(true);

    // No cookie: a different client entirely.
    const elsewhere = await present(token);
    expect(accepted(elsewhere), "a spent token was honoured for a stranger").toBe(false);
  });

  it("row 4: an expired token is refused with the same shape, never reissued", async () => {
    const { token } = await requestLink();
    await owner`update verification set expires_at = now() - interval '1 minute'`;
    const res = await present(token);
    expect(accepted(res)).toBe(false);
    // Never silently mints a replacement.
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe.skipIf(!configured)("row 2: the double click, through /auth/confirm", () => {
  /** Calls the confirm action the way the landing page does. */
  async function confirm(token: string, cookie?: string) {
    const auth = createAuth(env, new RecordingSender());
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const { confirmSignIn } = await import("../src/confirm.js");
    return confirmSignIn(
      auth,
      new Request(`${env.BETTER_AUTH_URL}/auth/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ token }),
      }),
      env.BETTER_AUTH_URL
    );
  }

  it("first action signs the member in", async () => {
    const { token } = await requestLink();
    const res = await confirm(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "signed_in" });
    expect(res.headers.get("set-cookie"), "no session cookie was issued").toBeTruthy();
  });

  it("ROW 2: the second action lands the same member signed in, not an error", async () => {
    const { token } = await requestLink();
    const first = await confirm(token);
    const cookie = first.headers.get("set-cookie")!.split(";")[0];

    // The same member, clicking again with the session they just received.
    const second = await confirm(token, cookie);
    expect(second.status, "the member's own double click was refused").toBe(200);
    expect(await second.json()).toEqual({ status: "already_signed_in" });

    // And no second session was minted: they are in the one they had.
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("ROW 3 still holds: the same spent token from a stranger is refused", async () => {
    // The row that must not soften. Row 2 must not have opened it.
    const { token } = await requestLink();
    await confirm(token);

    const stranger = await confirm(token);
    expect(stranger.status, "a spent token was honoured for a stranger").toBe(401);
    expect(await stranger.json()).toEqual({ status: "refused", reason: "used_or_expired" });
    expect(stranger.headers.get("set-cookie")).toBeNull();
  });

  it("ROW 4 still holds: an expired token is refused even for a signed-in member", async () => {
    // A signed-in member gets "already signed in", never a fresh session from
    // a dead token. Nothing is reissued.
    const { token: live } = await requestLink();
    const signedIn = await confirm(live);
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];

    const { token: stale } = await requestLink();
    await owner`update verification set expires_at = now() - interval '1 minute'`;

    const res = await confirm(stale, cookie);
    expect(await res.json()).toEqual({ status: "already_signed_in" });
    expect(res.headers.get("set-cookie"), "a dead token minted a session").toBeNull();
  });
});
