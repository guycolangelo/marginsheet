// The §1 phone-change tightening, attempted rather than described (3.1a).
//
// !!! THIS CONTROL HAS BEEN NOMINALLY LIVE SINCE 3.2b AND HAS NEVER BITTEN. !!!
//
// 3.2b shipped `mayChangePhone()` and a pure-logic test of its decision table.
// Both were correct. Neither could fail in a way that mattered, because there
// was no endpoint: `mayChangePhone()` had no caller anywhere in src/, so no
// request could attempt a phone change at all. Asked the standing question,
// would this go red if the tightening were completely broken, the answer was
// no, because nothing could reach it. A function returning the right answer to
// a question nobody asks is the purest form of that shape.
//
// The 3.2 plan had already ruled against exactly this, on 15 Aug 2026: "Build
// the minimal real endpoint here, not a stand-in. A control tested against a
// stand-in is a control nobody has exercised, and the endpoint is small." The
// ruling was recorded and the endpoint was not built.
//
// The refusal case also could not have been constructed before tonight even
// with an endpoint, because no test could register a passkey. Both halves are
// now real: a real registered credential, and a real request that attempts the
// change and is refused.
//
// EVERY ASSERTION IS ON THE DATABASE ROW, NOT THE RESPONSE. A handler that
// answers 403 while writing the change looks identical from the outside, and
// the row is the thing that decides whether an attacker moved the SIM-swap
// surface.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { realSignIn } from "./helpers/real-sign-in.js";
import { SoftwareAuthenticator } from "./helpers/authenticator.js";
import { BrowserWebAuthnClient } from "./helpers/webauthn-client.js";
import { createAuth, type AuthEnv } from "../src/auth.js";
import { router, type Env as WorkerEnv } from "../src/index.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8787";
const NEW_PHONE = "+15551234567";

let env: AuthEnv;
let workerEnv: WorkerEnv;
let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "phone");
  env = {
    NEON_DATABASE_URL: appUrl,
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: ORIGIN,
  };
  workerEnv = { ...env, POSTMARK_TOKEN: "t", AUTH_FROM_EMAIL: "accounts@marginsheet.com" };
  app = postgres(appUrl, { max: 1 });
});

afterAll(async () => {
  if (owner) await owner.end();
  if (app) await app.end();
});

/**
 * A household member with a real auth identity, a real member row, and an
 * optional real registered passkey.
 */
// Building a member WITH a passkey runs two full WebAuthn ceremonies, which
// takes seconds rather than milliseconds. The tests that use it carry their own
// timeout; vitest's 5s default is not enough and a timeout here reads as a
// broken control rather than a slow fixture.
async function member(opts: { withPasskey: boolean }) {
  const signedIn = await realSignIn(env);
  const auth = createAuth(env);
  const ctx = await auth.$context;
  const userId = (await ctx.internalAdapter.findUserByEmail(signedIn.email))!.user.id;

  const [household] = await owner<{ id: string }[]>`
    insert into households (name) values ('Phone Probe') returning id
  `;
  const [row] = await owner<{ id: string }[]>`
    insert into members (household_id, first_name, role, auth_user_id, phone)
    values (${household.id}, 'Probe', 'full_member', ${userId}, '+15550000000')
    returning id
  `;

  const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
  let passkeySession = "";

  if (opts.withPasskey) {
    const client = new BrowserWebAuthnClient({ origin: ORIGIN, sessionCookie: signedIn.cookie });
    await client.register(auth.api, device, "Phone Probe Device");
    // A second ceremony, so this session's auth_method is genuinely "passkey"
    // rather than the magic-link one that authorised registration.
    passkeySession = (await client.login(auth.api, device)).sessionCookie;
  }

  return { memberId: row.id, magicLinkSession: signedIn.cookie, passkeySession, device };
}

/** Attempts the change through the real route, as a client would. */
function attemptChange(cookie: string, phone = NEW_PHONE): Promise<Response> {
  return router.fetch(
    new Request(`${ORIGIN}/auth/phone`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ phone }),
    }),
    workerEnv
  );
}

const phoneOf = async (id: string) =>
  (await owner<{ phone: string | null }[]>`select phone from members where id = ${id}`)[0]?.phone;

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the phone-change suite");
});

describe.skipIf(!configured)("the three §1 cases, through the real endpoint", () => {
  it("REFUSES a magic-link session when the member HAS a passkey", { timeout: 40_000 }, async () => {
    // THE CONTROL. This is the SIM-swap path being closed, attempted for the
    // first time since the tightening was written on 15 August.
    const m = await member({ withPasskey: true });

    const res = await attemptChange(m.magicLinkSession);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "refused", reason: "passkey_required" });
    expect(
      await phoneOf(m.memberId),
      "the phone was changed despite the refusal, so the response lied"
    ).toBe("+15550000000");
  });

  it("ALLOWS the same change behind a passkey session", { timeout: 40_000 }, async () => {
    // Proof the control is not simply blocking everything. Without this, a
    // handler that refused every phone change would pass the case above.
    const m = await member({ withPasskey: true });

    const res = await attemptChange(m.passkeySession);

    expect(res.status, `a passkey session was refused: ${await res.clone().text()}`).toBe(200);
    expect(await phoneOf(m.memberId)).toBe(NEW_PHONE);
  });

  it("ALLOWS a magic-link session when the member has NO passkey", async () => {
    // Named by Guy as the one that matters. §1 makes magic link the weaker
    // path, not an excluded one, and without this case "refuse magic-link
    // phone changes" would pass both cases above while locking out every
    // member who has never registered a passkey.
    const m = await member({ withPasskey: false });

    const res = await attemptChange(m.magicLinkSession);

    expect(res.status).toBe(200);
    expect(await phoneOf(m.memberId)).toBe(NEW_PHONE);
  });
});

describe.skipIf(!configured)("the endpoint refuses what it should before deciding", () => {
  it("REFUSES an unauthenticated caller", async () => {
    const m = await member({ withPasskey: false });
    const res = await attemptChange("");
    expect(res.status).toBe(401);
    expect(await phoneOf(m.memberId)).toBe("+15550000000");
  });

  it("REFUSES a phone that is not a phone, without touching the row", async () => {
    const m = await member({ withPasskey: false });
    const res = await attemptChange(m.magicLinkSession, "not-a-number");
    expect(res.status).toBe(400);
    expect(await phoneOf(m.memberId)).toBe("+15550000000");
  });

  it("a changed number is recorded UNVERIFIED", async () => {
    // Verification is 3.3's. A number that arrived already verified would
    // defeat the point of verifying it, and this is the cheapest place to
    // stop that being introduced later.
    const m = await member({ withPasskey: false });
    await attemptChange(m.magicLinkSession);

    const [row] = await owner<{ phone_verified_at: Date | null }[]>`
      select phone_verified_at from members where id = ${m.memberId}
    `;
    expect(row.phone_verified_at).toBeNull();
  });
});
