// Recent-auth, enforced through the real endpoint (M3 task 3.4).
//
// This completes rule 1 of migration 0001. Both halves are now live: the
// credential class since 3.2b, the 10-minute window from here. Until this
// landed, a session created 29 days ago satisfied POST /auth/phone exactly as
// one created a minute ago, and `withinRecentAuthWindow()` existed with no
// caller.
//
// !!! THE HEADLINE CONTROL IS THE ROLLING-REFRESH ONE. !!!
//
// The session is 30-day rolling with a one-day updateAge, so an active
// household's session keeps extending. If that refresh reset `created_at`,
// recent-auth would be permanently satisfied for every active session and the
// control would be decorative. Better Auth's source refreshes with `expiresAt`
// and `updatedAt` only, which is why `created_at` is the right field, and a
// source read is evidence about TODAY'S version. The test below is evidence
// about the version that ships.
//
// Every other assertion here fails when our code is wrong. That one fails when
// our code is right and the framework changed underneath it, which is the only
// way this control dies quietly.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { realSignIn } from "./helpers/real-sign-in.js";
import { SoftwareAuthenticator } from "./helpers/authenticator.js";
import { BrowserWebAuthnClient } from "./helpers/webauthn-client.js";
import { createAuth, type AuthEnv } from "../src/auth.js";
import { RECENT_AUTH_MINUTES } from "../src/recent-auth.js";
import { router, type Env as WorkerEnv } from "../src/index.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8787";
const NEW_PHONE = () => `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

let env: AuthEnv;
let workerEnv: WorkerEnv;
let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "recentauth");
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

/** A member with a real session, and no passkey unless asked for one. */
async function member(opts: { withPasskey?: boolean } = {}) {
  const signedIn = await realSignIn(env);
  const auth = createAuth(env);
  const ctx = await auth.$context;
  const userId = (await ctx.internalAdapter.findUserByEmail(signedIn.email))!.user.id;

  const [household] = await owner<{ id: string }[]>`
    insert into households (name) values ('Recent Auth') returning id
  `;
  const [row] = await owner<{ id: string }[]>`
    insert into members (household_id, first_name, role, auth_user_id, phone)
    values (${household.id}, 'Probe', 'full_member', ${userId}, ${NEW_PHONE()})
    returning id
  `;

  let passkeySession = "";
  if (opts.withPasskey) {
    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    const client = new BrowserWebAuthnClient({ origin: ORIGIN, sessionCookie: signedIn.cookie });
    await client.register(auth.api, device, "Recent Auth Device");
    passkeySession = (await client.login(auth.api, device)).sessionCookie;
  }

  return { memberId: row.id, userId, cookie: signedIn.cookie, passkeySession, email: signedIn.email };
}

const tokenOf = (cookie: string) =>
  decodeURIComponent(cookie.split("=").slice(1).join("=")).split(".")[0];

/** Ages a session by moving created_at, which is what a clock would do. */
async function age(cookie: string, minutes: number) {
  await owner`
    update session set created_at = created_at - make_interval(mins => ${minutes})
     where token = ${tokenOf(cookie)}
  `;
}

function attemptChange(cookie: string): Promise<Response> {
  return router.fetch(
    new Request(`${ORIGIN}/auth/phone`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ phone: NEW_PHONE() }),
    }),
    workerEnv
  );
}

const phoneOf = async (id: string) =>
  (await owner<{ p: string | null }[]>`select phone as p from members where id = ${id}`)[0]?.p;

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the recent-auth suite");
});

describe.skipIf(!configured)("the window is enforced", { timeout: 60_000 }, () => {
  it("REFUSES a stale session, and the row is unchanged", async () => {
    const m = await member();
    const before = await phoneOf(m.memberId);
    await age(m.cookie, RECENT_AUTH_MINUTES + 5);

    const res = await attemptChange(m.cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "refused", reason: "stale_auth" });
    expect(await phoneOf(m.memberId), "the phone changed despite the refusal").toBe(before);
  });

  it("ALLOWS a session created a minute ago, so it is not simply shut", async () => {
    const m = await member();
    const res = await attemptChange(m.cookie);
    expect(res.status, `a fresh session was refused: ${await res.clone().text()}`).toBe(200);
  });

  it("the boundary holds on both sides", async () => {
    const inside = await member();
    await age(inside.cookie, RECENT_AUTH_MINUTES - 1);
    expect((await attemptChange(inside.cookie)).status).toBe(200);

    const outside = await member();
    await age(outside.cookie, RECENT_AUTH_MINUTES + 1);
    expect((await attemptChange(outside.cookie)).status).toBe(403);
  });

  it("REFUSES a session whose created_at is in the FUTURE", async () => {
    // Clock skew or a forged value. "Created in the future" must not read as
    // "created just now", which a naive age comparison would allow.
    const m = await member();
    await age(m.cookie, -60);
    expect((await attemptChange(m.cookie)).status).toBe(403);
  });
});

describe.skipIf(!configured)(
  "THE HEADLINE CONTROL: a rolling-refreshed session is still stale",
  { timeout: 60_000 },
  () => {
    it("29 days old and refreshed by Better Auth is STALE", async () => {
      // The failure this exists to catch: if the rolling refresh reset
      // created_at, recent-auth would be permanently satisfied for every active
      // session and this control would be decorative.
      const m = await member();
      const token = tokenOf(m.cookie);

      // An old session that is still valid, exactly like a household who has
      // been using the product for a month.
      await owner`
        update session
           set created_at = now() - make_interval(days => 29),
               expires_at = now() + make_interval(days => 1)
         where token = ${token}
      `;

      // Drive a real session read, which is what triggers Better Auth's
      // refresh: expiresAt is inside updateAge of expiry, so it refreshes.
      const auth = createAuth(env);
      const seen = await auth.api.getSession({ headers: new Headers({ cookie: m.cookie }) });
      expect(seen?.session, "the aged session stopped being valid, so this proves nothing").toBeTruthy();

      const [row] = await owner<{ created: Date; updated: Date; expires: Date }[]>`
        select created_at as created, updated_at as updated, expires_at as expires
          from session where token = ${token}
      `;

      // The refresh moved expiry and activity. It did NOT move authentication.
      expect(
        Date.now() - row.created.getTime(),
        "created_at moved, so the rolling refresh freshened authentication and recent-auth is decorative"
      ).toBeGreaterThan(28 * 24 * 60 * 60_000);

      // And the endpoint refuses, which is the claim that matters.
      const res = await attemptChange(m.cookie);
      expect(
        res.status,
        "a 29-day-old session passed recent-auth, so the window is not enforced on real sessions"
      ).toBe(403);
      expect(await res.json()).toEqual({ status: "refused", reason: "stale_auth" });
    });
  }
);

describe.skipIf(!configured)("the two refusals stay distinguishable", { timeout: 60_000 }, () => {
  it("stale and passkey_required are different reasons, because they need different actions", async () => {
    // "Sign in again" and "you need a passkey" are not interchangeable. A
    // household told the wrong one is stuck, which is why the conditions are
    // not collapsed into one predicate.
    const stale = await member();
    await age(stale.cookie, RECENT_AUTH_MINUTES + 5);
    const staleRes = await attemptChange(stale.cookie);

    const wrongClass = await member({ withPasskey: true });
    const classRes = await attemptChange(wrongClass.cookie);

    expect(await staleRes.json()).toEqual({ status: "refused", reason: "stale_auth" });
    expect(await classRes.json()).toEqual({ status: "refused", reason: "passkey_required" });
  });

  it("a FRESH passkey session succeeds, so both gates can be satisfied at once", async () => {
    const m = await member({ withPasskey: true });
    const res = await attemptChange(m.passkeySession);
    expect(res.status, `a fresh passkey session was refused: ${await res.clone().text()}`).toBe(200);
  });

  it("a fresh magic-link session with NO passkey still succeeds", async () => {
    // The case Guy named as the one that matters, still true after this task.
    // §1 makes magic link the weaker path, not an excluded one.
    const m = await member();
    expect((await attemptChange(m.cookie)).status).toBe(200);
  });
});

describe.skipIf(!configured)("re-challenge is a way through, not a wall", { timeout: 60_000 }, () => {
  it("re-authenticating lets the same change succeed", async () => {
    // A control that refuses correctly and offers no path forward is a
    // household who can never change their phone number.
    const m = await member();
    await age(m.cookie, RECENT_AUTH_MINUTES + 5);
    expect((await attemptChange(m.cookie)).status).toBe(403);

    // Sign in again. Re-authentication IS a new session, which is why no
    // last_authenticated_at column exists.
    const again = await realSignIn(env);
    await owner`
      update members set auth_user_id = (select id from "user" where email = ${again.email})
       where id = ${m.memberId}
    `;

    const res = await attemptChange(again.cookie);
    expect(res.status, `re-authentication did not restore access: ${await res.clone().text()}`).toBe(
      200
    );
  });
});
