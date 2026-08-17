// The lost-every-device recovery path (M3 task 3.1b).
//
// §1: magic link AND phone OTP, both required, neither sufficient, ending in a
// newly registered passkey. Built and tested as a PATH, not as two features
// that happen to exist.
//
// THE END-TO-END TEST STARTS WITH EVERY CREDENTIAL REMOVED: passkeys deleted,
// sessions deleted, nothing left but a user row with a verified email and a
// verified phone. It ends by asserting the recovered credential
// AUTHENTICATES, which is the named assertion rather than a side effect
// (ruled by Guy, 17 Aug 2026). A passkey row that exists but cannot sign in is
// exactly the recovery that leaves someone without a credential.
//
// THAT ASSERTION IS ALSO THE DRIFT CONTROL. Recovery is the SECOND path that
// writes a credential, because the plugin's registration requires a session
// and §1 says the session exists only after the credential. Two paths writing
// the same shape is a drift surface. Registration here and authentication
// through the plugin means any disagreement about storage shows up as a
// credential that registers and cannot be used, and this is where it shows.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { realSignIn } from "./helpers/real-sign-in.js";
import { SoftwareAuthenticator } from "./helpers/authenticator.js";
import { BrowserWebAuthnClient } from "./helpers/webauthn-client.js";
import { createAuth, type AuthEnv } from "../src/auth.js";
import { RecordingSender } from "../src/email.js";
import { RecordingOtpSender } from "../src/otp.js";
import {
  RECOVERY_MINUTES,
  grantState,
  meetEmailHalf,
  meetPhoneHalf,
  recoveryChallenge,
  registerPasskeyFromGrant,
  requestRecovery,
  type RecoveryDeps,
} from "../src/recovery.js";
import { TOKEN_PURPOSES, mintToken } from "../src/tokens.js";

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
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "recovery");
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

function deps(mail = new RecordingSender(), otp = new RecordingOtpSender()): RecoveryDeps & {
  mail: RecordingSender;
  otp: RecordingOtpSender;
} {
  return {
    sql: app,
    auth: createAuth(env),
    mail,
    otp,
    baseUrl: ORIGIN,
    rpId: RP_ID,
    origin: ORIGIN,
  };
}

/**
 * A household member who once had everything, and now has nothing but a
 * verified email and a verified phone.
 */
async function memberWithEverythingRemoved(phone: string) {
  const signedIn = await realSignIn(env);
  const auth = createAuth(env);
  const ctx = await auth.$context;
  const userId = (await ctx.internalAdapter.findUserByEmail(signedIn.email))!.user.id;

  const [household] = await owner<{ id: string }[]>`
    insert into households (name) values ('Recovery Probe') returning id
  `;
  await owner`
    insert into members (household_id, first_name, role, auth_user_id, phone, phone_verified_at)
    values (${household.id}, 'Probe', 'full_member', ${userId}, ${phone}, now())
  `;

  // They had a passkey once.
  const client = new BrowserWebAuthnClient({ origin: ORIGIN, sessionCookie: signedIn.cookie });
  const oldDevice = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
  await client.register(auth.api, oldDevice, "The device they lost");

  // And now it is gone, along with every session. This is the starting state.
  await app`delete from passkey where user_id = ${userId}`;
  await app`delete from session where user_id = ${userId}`;

  const remaining = await app`select id from passkey where user_id = ${userId}`;
  expect(remaining, "the fixture did not actually remove every credential").toHaveLength(0);

  return { userId, email: signedIn.email, phone };
}

// Unique per run. `members_verified_phone_unique` enforces that a VERIFIED
// number belongs to one member, which is a real M1 invariant and not something
// to work around: a shared verified phone would make the recovery factor
// ambiguous about whose it is.
const phoneFor = () =>
  `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

/** The link exactly as the household receives it. */
function tokenFromEmail(mail: RecordingSender): string {
  const link = mail.sent.at(-1)!.text.split("\n").find((l) => l.trim().startsWith("http"))!;
  return new URL(link.trim()).searchParams.get("token")!;
}

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the recovery suite");
});

describe.skipIf(!configured)("the path, from every credential removed", { timeout: 60_000 }, () => {
  it("recovers, and the new passkey AUTHENTICATES", async () => {
    const d = deps();
    const who = await memberWithEverythingRemoved(phoneFor());

    await requestRecovery(d, who.email);
    const token = tokenFromEmail(d.mail);

    // Half one. This signs nobody in, which is the whole reason recovery does
    // not reuse the magic-link plugin.
    expect(await meetEmailHalf(d, token)).toBe(true);
    expect(
      await app`select id from session where user_id = ${who.userId}`,
      "the recovery link created a session, so the OTP is now a formality"
    ).toHaveLength(0);

    // Half two.
    expect(await meetPhoneHalf(d, token, d.otp.codeFor(who.phone)!)).toBe(true);

    // Only now is there a grant.
    const grant = await grantState(d, token);
    expect(grant.granted).toBe(true);

    // Spend it on the one thing it authorises.
    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    const attestation = device.register(await recoveryChallenge(token));
    const result = await registerPasskeyFromGrant(d, token, attestation);
    expect(result.ok, `recovery refused: ${JSON.stringify(result)}`).toBe(true);

    // The credential exists...
    const rows = await app`select id from passkey where user_id = ${who.userId}`;
    expect(rows, "recovery finished without leaving a credential").toHaveLength(1);

    // ...AND IT AUTHENTICATES. The named assertion. A row that cannot sign in
    // is the recovery that recovered nothing, and this is also the control
    // that catches drift between the two registration paths.
    const anonymous = new BrowserWebAuthnClient({ origin: ORIGIN });
    const { sessionCookie } = await anonymous.login(createAuth(env).api, device);
    expect(
      sessionCookie,
      "the recovered passkey did not authenticate, so recovery recovered nothing"
    ).toContain("=");
  });

  it("issues the session only AFTER the credential exists", async () => {
    // §1's ordering, and it is not arbitrary: a session that exists before any
    // credential is a session an attacker mid-flow could use.
    const d = deps();
    const who = await memberWithEverythingRemoved(phoneFor());

    await requestRecovery(d, who.email);
    const token = tokenFromEmail(d.mail);
    await meetEmailHalf(d, token);
    await meetPhoneHalf(d, token, d.otp.codeFor(who.phone)!);

    // Both halves met, grant live, nothing spent: still no session.
    expect(
      await app`select id from session where user_id = ${who.userId}`,
      "a session existed while the member still held no credential"
    ).toHaveLength(0);

    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    await registerPasskeyFromGrant(d, token, device.register(await recoveryChallenge(token)));

    expect(await app`select id from session where user_id = ${who.userId}`).toHaveLength(1);
  });
});

describe.skipIf(!configured)("neither half is sufficient", { timeout: 60_000 }, () => {
  it("REFUSES on the magic link alone, and no session exists", async () => {
    const d = deps();
    const who = await memberWithEverythingRemoved(phoneFor());
    await requestRecovery(d, who.email);
    const token = tokenFromEmail(d.mail);

    await meetEmailHalf(d, token);

    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    const result = await registerPasskeyFromGrant(d, token, device.register(await recoveryChallenge(token)));

    expect(result).toEqual({ ok: false, reason: "phone_half_missing" });
    expect(await app`select id from passkey where user_id = ${who.userId}`).toHaveLength(0);
    expect(await app`select id from session where user_id = ${who.userId}`).toHaveLength(0);
  });

  it("REFUSES on the phone OTP alone, and no session exists", async () => {
    const d = deps();
    const who = await memberWithEverythingRemoved(phoneFor());
    await requestRecovery(d, who.email);
    const token = tokenFromEmail(d.mail);

    await meetPhoneHalf(d, token, d.otp.codeFor(who.phone)!);

    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    const result = await registerPasskeyFromGrant(d, token, device.register(await recoveryChallenge(token)));

    expect(result).toEqual({ ok: false, reason: "email_half_missing" });
    expect(await app`select id from passkey where user_id = ${who.userId}`).toHaveLength(0);
    expect(await app`select id from session where user_id = ${who.userId}`).toHaveLength(0);
  });
});

describe.skipIf(!configured)("THE CROSS-ACCOUNT CASE", { timeout: 60_000 }, () => {
  it("REFUSES member A's link combined with member B's OTP", async () => {
    // The control this whole task is built around, and the one a naive
    // implementation passes. Asking "is there a met email half?" and "is there
    // a met phone half?" finds both true here. That is two unrelated checks
    // wearing the costume of two factors, and it means whoever controls any
    // inbox plus any phone recovers any account.
    const d = deps();
    const alice = await memberWithEverythingRemoved(phoneFor());
    const bob = await memberWithEverythingRemoved(phoneFor());

    await requestRecovery(d, alice.email);
    const aliceToken = tokenFromEmail(d.mail);
    await requestRecovery(d, bob.email);
    const bobToken = tokenFromEmail(d.mail);

    // Alice's email half is genuinely met.
    expect(await meetEmailHalf(d, aliceToken)).toBe(true);
    // Bob's phone half is genuinely met, on Bob's challenge.
    expect(await meetPhoneHalf(d, bobToken, d.otp.codeFor(bob.phone)!)).toBe(true);

    // Now the attack: present BOB's code against ALICE's challenge.
    expect(
      await meetPhoneHalf(d, aliceToken, d.otp.codeFor(bob.phone)!),
      "another member's OTP was accepted against this challenge"
    ).toBe(false);

    // Neither account has a grant. One half each, belonging to different rows.
    expect(await grantState(d, aliceToken)).toEqual({
      granted: false,
      reason: "phone_half_missing",
    });
    expect(await grantState(d, bobToken)).toEqual({
      granted: false,
      reason: "email_half_missing",
    });

    // And neither can register anything.
    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    expect(
      (await registerPasskeyFromGrant(d, aliceToken, device.register(await recoveryChallenge(aliceToken)))).ok
    ).toBe(false);
    expect(await app`select id from passkey where user_id = ${alice.userId}`).toHaveLength(0);
    expect(await app`select id from passkey where user_id = ${bob.userId}`).toHaveLength(0);
  });
});

describe.skipIf(!configured)("the grant is single use and short lived", { timeout: 60_000 }, () => {
  it("REFUSES a second use", async () => {
    const d = deps();
    const who = await memberWithEverythingRemoved(phoneFor());
    await requestRecovery(d, who.email);
    const token = tokenFromEmail(d.mail);
    await meetEmailHalf(d, token);
    await meetPhoneHalf(d, token, d.otp.codeFor(who.phone)!);

    const first = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    expect((await registerPasskeyFromGrant(d, token, first.register(await recoveryChallenge(token)))).ok).toBe(true);

    const second = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    const again = await registerPasskeyFromGrant(d, token, second.register(await recoveryChallenge(token)));

    expect(again.ok, "the grant was spendable twice").toBe(false);
    expect(
      await app`select id from passkey where user_id = ${who.userId}`,
      "a second credential was registered from one grant"
    ).toHaveLength(1);
  });

  it("REFUSES once expired, proven by moving the clock", async () => {
    const d = deps();
    const who = await memberWithEverythingRemoved(phoneFor());
    await requestRecovery(d, who.email);
    const token = tokenFromEmail(d.mail);
    await meetEmailHalf(d, token);
    await meetPhoneHalf(d, token, d.otp.codeFor(who.phone)!);

    // expires_at is immutable to the app role by column grant, so the clock is
    // moved with the owner connection. That restriction is itself a control:
    // a caller who could push this forward would hold an unexpiring recovery.
    await owner`
      update recovery_challenges
         set expires_at = now() - make_interval(mins => 1)
       where auth_user_id = ${who.userId}
    `;

    const device = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
    const result = await registerPasskeyFromGrant(d, token, device.register(await recoveryChallenge(token)));

    expect(result).toEqual({ ok: false, reason: "no_challenge" });
    expect(await app`select id from passkey where user_id = ${who.userId}`).toHaveLength(0);
  });

  it("NEGATIVE CONTROL: the app role cannot move expires_at or re-point the user", async () => {
    // The two immutable columns from 0019. A caller able to write either turns
    // one met half into a recovery of somebody else's account, or into one
    // that never expires.
    const d = deps();
    const who = await memberWithEverythingRemoved(phoneFor());
    await requestRecovery(d, who.email);

    await expect(
      app`update recovery_challenges set expires_at = now() + make_interval(days => 30) where auth_user_id = ${who.userId}`
    ).rejects.toThrow(/permission denied/i);

    await expect(
      app`update recovery_challenges set auth_user_id = 'someone_else' where auth_user_id = ${who.userId}`
    ).rejects.toThrow(/permission denied/i);
  });
});

describe.skipIf(!configured)("token discipline at the recovery boundary", { timeout: 60_000 }, () => {
  it("REFUSES a sign-in token, on purpose rather than by absence", async () => {
    const d = deps();
    // Same secret material, relabelled. The refusal is about the purpose.
    const recovery = mintToken(TOKEN_PURPOSES.recovery);
    const material = recovery.split("_")[2];
    const asSignIn = `ms_${TOKEN_PURPOSES.signIn}_${material}`;

    expect(await grantState(d, asSignIn)).toEqual({ granted: false, reason: "no_challenge" });
    expect(await meetEmailHalf(d, asSignIn)).toBe(false);
  });

  it("REFUSES an invitation token", async () => {
    const d = deps();
    expect(await meetEmailHalf(d, mintToken(TOKEN_PURPOSES.invitation))).toBe(false);
  });

  it("answers identically for an address it has never seen", async () => {
    // Recovery is the endpoint an attacker probes first, so it must not say
    // whether an account exists.
    const d = deps();
    await requestRecovery(d, `nobody-${crypto.randomUUID()}@marginsheet.test`);
    expect(d.mail.sent, "an unknown address was told it is unknown by silence").toHaveLength(0);
    expect(d.otp.sent).toHaveLength(0);
  });

  it("halves live the ruled 10 minutes", () => {
    expect(RECOVERY_MINUTES).toBe(10);
  });
});
