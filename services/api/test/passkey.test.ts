// Passkey registration and login, with a real software authenticator (3.1a).
//
// The 3.1 plan flagged the risk that this file would be tempted into stubbing
// the authenticator, and Guy ruled: bring the finding rather than ship a stub,
// because a stub asserts only that our own function was called.
//
// No stub was needed, and no gap is owed. helpers/authenticator.ts generates a
// real P-256 keypair and signs real ECDSA assertions, which
// @simplewebauthn/server verifies inside Better Auth exactly as it verifies a
// hardware key. The forged-signature control is what proves that: if the
// server were not really verifying, the forgery would be accepted and that one
// test would fail while every other test here stayed green.
//
// WHY THIS COULD NOT RUN BEFORE 3.2. The first attempt hand-built
// `better-auth.session_token=<token>` from internalAdapter.createSession, and
// every case failed with APIError: Unauthorized before reaching a line of
// WebAuthn code, because Better Auth SIGNS its session cookies. Guy ruled the
// resequence on that basis: a session minted through internalAdapter is a
// session the product never issues. The cookie here comes from a real
// magic-link sign-in through realSignIn().
//
// The Origin header and the challenge cookie are handled by
// helpers/webauthn-client.ts, which carries the reasoning. Read it before
// changing anything here that fails.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { realSignIn } from "./helpers/real-sign-in.js";
import { SoftwareAuthenticator } from "./helpers/authenticator.js";
import { BrowserWebAuthnClient } from "./helpers/webauthn-client.js";
import { createAuth, type AuthEnv } from "../src/auth.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8787";

let env: AuthEnv;
let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "passkey");
  env = {
    NEON_DATABASE_URL: appUrl,
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: ORIGIN,
  };
  app = postgres(appUrl, { max: 1 });
});

afterAll(async () => {
  if (owner) await owner.end();
  if (app) await app.end();
});

/** A member who signed in for real, and the browser that will speak for them. */
async function signedInMember() {
  const signedIn = await realSignIn(env);
  const auth = createAuth(env);
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(signedIn.email);
  const client = new BrowserWebAuthnClient({ origin: ORIGIN, sessionCookie: signedIn.cookie });
  const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
  return { auth, userId: found!.user.id, client, device, signedIn };
}

// Every test below drives at least one real WebAuthn ceremony against a real
// database, so the suites carry a 40s timeout. Vitest's 5s default is enough
// when this file runs alone and not enough when it runs with the other eight,
// and a timeout there reads as a broken control rather than a slow fixture.
it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the passkey suite");
});

describe.skipIf(!configured)("registration, against a real product session", { timeout: 40_000 }, () => {
  it("registers a credential and writes it to the right user", async () => {
    const { auth, userId, client, device } = await signedInMember();

    await client.register(auth.api, device, "Probe Device");

    const rows = await app<{ credential_id: string }[]>`
      select credential_id from passkey where user_id = ${userId}
    `;
    expect(rows, "no passkey row was written for this user").toHaveLength(1);
    expect(rows[0].credential_id).toBeTruthy();
  });

  it("REFUSES registration with no session at all", async () => {
    // Attempting the forbidden operation. Registration is a privileged act:
    // an unauthenticated caller adding a credential would be adding one to
    // somebody else's account.
    const { auth, device } = await signedInMember();
    const anonymous = new BrowserWebAuthnClient({ origin: ORIGIN });

    await expect(anonymous.register(auth.api, device)).rejects.toThrow();
  });

  it("REFUSES registration when the challenge cookie is absent", async () => {
    // The challenge is not optional state. Without the cookie the server has
    // nothing to compare the attestation against, and it must refuse rather
    // than accept an unanchored one.
    const { auth, client, device } = await signedInMember();

    const call = (await auth.api.generatePasskeyRegistrationOptions({
      headers: client.headers(),
      returnHeaders: true,
    })) as { response?: { challenge: string }; challenge?: string };
    const challenge = String(call.response?.challenge ?? call.challenge);

    await expect(
      auth.api.verifyPasskeyRegistration({
        headers: client.headers(), // deliberately without the challenge cookie
        body: { response: device.register(challenge), name: "No Cookie" },
      })
    ).rejects.toThrow();
  });
});

describe.skipIf(!configured)("login with a registered credential", { timeout: 40_000 }, () => {
  it("authenticates and issues a session", async () => {
    const { auth, client, device } = await signedInMember();
    await client.register(auth.api, device, "Login Device");

    const { sessionCookie } = await client.login(auth.api, device);

    expect(
      sessionCookie,
      "authentication succeeded but issued no session cookie"
    ).toContain("=");
  });

  it("the session it issues records auth_method = passkey", async () => {
    // The provenance the §1 tightening depends on. If this were null or
    // magic_link, a passkey holder could never change their phone.
    const { auth, client, device } = await signedInMember();
    await client.register(auth.api, device, "Provenance Device");

    const { sessionCookie } = await client.login(auth.api, device);
    const token = decodeURIComponent(sessionCookie.split("=").slice(1).join("=")).split(".")[0];

    const [row] = await app<{ auth_method: string | null }[]>`
      select auth_method from session where token = ${token}
    `;
    expect(row?.auth_method, "a passkey login did not record its credential class").toBe(
      "passkey"
    );
  });

  it("NEGATIVE CONTROL: a forged signature is refused", async () => {
    // The test that makes every other test in this file mean something. The
    // forgery travels the identical path as a good assertion and differs only
    // in the signature. If the server were not verifying, this would pass.
    const { auth, client, device } = await signedInMember();
    await client.register(auth.api, device, "Forgery Device");

    await expect(
      client.login(auth.api, device, /* tamper */ true),
      "a forged signature was accepted, so the server is not verifying"
    ).rejects.toThrow();
  });
});

describe.skipIf(!configured)("listing and revoking", { timeout: 40_000 }, () => {
  it("lists the member's own credentials", async () => {
    const { auth, client, device } = await signedInMember();
    await client.register(auth.api, device, "Listed Device");

    const listed = (await auth.api.listPasskeys({ headers: client.headers() })) as unknown[];
    expect(listed).toHaveLength(1);
  });

  it("revokes one, and the credential stops existing", async () => {
    const { auth, userId, client, device } = await signedInMember();
    await client.register(auth.api, device, "Doomed Device");

    const listed = (await auth.api.listPasskeys({ headers: client.headers() })) as {
      id: string;
    }[];
    await auth.api.deletePasskey({ headers: client.headers(), body: { id: listed[0].id } });

    const rows = await app`select id from passkey where user_id = ${userId}`;
    expect(rows, "the passkey survived its own revocation").toHaveLength(0);
  });

  it("REFUSES revoking a credential belonging to another member", async () => {
    // Attempting the forbidden operation. Revocation is how a lost device is
    // cut off, so being able to revoke someone else's is being able to strip
    // their credential and push them onto the weaker path.
    const victim = await signedInMember();
    await victim.client.register(victim.auth.api, victim.device, "Victim Device");
    const victimKeys = (await victim.auth.api.listPasskeys({
      headers: victim.client.headers(),
    })) as { id: string }[];

    const attacker = await signedInMember();
    await attacker.auth.api
      .deletePasskey({ headers: attacker.client.headers(), body: { id: victimKeys[0].id } })
      .catch(() => undefined);

    const survivors = await app`select id from passkey where user_id = ${victim.userId}`;
    expect(
      survivors,
      "another member's passkey was revoked, which strips their credential"
    ).toHaveLength(1);
  });
});
