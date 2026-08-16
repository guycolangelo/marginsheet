// Passkey registration and login, with a real software authenticator.
//
// The 3.1 plan flagged the risk that this test would be tempted into stubbing
// the authenticator, and Guy ruled: bring the finding rather than ship a stub,
// because a stub asserts only that our own function was called.
//
// No stub was needed. test/helpers/authenticator.ts generates a real P-256
// keypair and signs real ECDSA assertions, which @simplewebauthn/server
// verifies inside Better Auth exactly as it verifies a hardware key. The
// forged-signature control at the bottom is what proves that: if the server
// were not really verifying, the forgery would be accepted and that test
// would fail.
//
// Shares the rotation hazard of auth-adapter.test.ts: it connects as
// marginsheet_app by setting the role's password, so it runs only where
// AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE is set (the ephemeral CI branch).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createAuth } from "../src/auth.js";
import { SoftwareAuthenticator } from "./helpers/authenticator.js";

const OWNER_URL = process.env.DATABASE_URL;
const mayRotate = process.env.AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE === "1";
const configured = Boolean(OWNER_URL) && mayRotate;

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8787";

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
    BETTER_AUTH_URL: ORIGIN,
  });
}

/** A signed-in user, which passkey registration requires. */
async function signedInUser() {
  const a = auth();
  const ctx = await a.$context;
  const user = await ctx.internalAdapter.createUser({
    email: `pk-${crypto.randomUUID()}@marginsheet.test`,
    name: "Passkey Probe",
    emailVerified: true,
  });
  const session = await ctx.internalAdapter.createSession(user.id, false);
  const headers = new Headers({ cookie: `better-auth.session_token=${session.token}` });
  return { a, ctx, user, session, headers };
}

describe.skipIf(!configured)("passkey registration and login, end to end", () => {
  it("registers a real credential and authenticates with it", async () => {
    const { a, ctx, user, headers } = await signedInUser();
    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });

    try {
      const options = (await a.api.generatePasskeyRegistrationOptions({ headers })) as {
        challenge: string;
      };
      expect(options.challenge, "no registration challenge issued").toBeTruthy();

      const registered = await a.api.verifyPasskeyRegistration({
        headers,
        body: { response: device.register(options.challenge), name: "Probe Device" },
      });
      expect(registered, "registration was rejected").toBeTruthy();

      // It is in the database, on the right user.
      const sql = postgres(appUrl, { max: 1 });
      try {
        const rows = await sql`select user_id from passkey where user_id = ${user.id}`;
        expect(rows).toHaveLength(1);
      } finally {
        await sql.end();
      }

      // And it authenticates: a real signature, verified server side.
      const authOptions = (await a.api.generatePasskeyAuthenticationOptions()) as {
        challenge: string;
      };
      const result = await a.api.verifyPasskeyAuthentication({
        body: { response: device.authenticate(authOptions.challenge) },
        headers: new Headers(),
      });
      expect(result, "authentication with a valid signature was rejected").toBeTruthy();
    } finally {
      await ctx.internalAdapter.deleteUser(user.id);
    }
  });

  it("NEGATIVE CONTROL: a forged signature is rejected", async () => {
    // This is the test that makes the one above mean something. If the server
    // were not verifying signatures, a corrupted one would sail through and
    // every assertion above would be theatre.
    const { a, ctx, user, headers } = await signedInUser();
    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });

    try {
      const options = (await a.api.generatePasskeyRegistrationOptions({ headers })) as {
        challenge: string;
      };
      await a.api.verifyPasskeyRegistration({
        headers,
        body: { response: device.register(options.challenge), name: "Probe Device" },
      });

      const authOptions = (await a.api.generatePasskeyAuthenticationOptions()) as {
        challenge: string;
      };

      await expect(
        a.api.verifyPasskeyAuthentication({
          body: { response: device.forgeBadSignature(authOptions.challenge) },
          headers: new Headers(),
        })
      ).rejects.toThrow();
    } finally {
      await ctx.internalAdapter.deleteUser(user.id);
    }
  });
});
