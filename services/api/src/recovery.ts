// The lost-every-device recovery path (M3 task 3.1b).
//
// §1: magic link AND phone OTP, both required, neither sufficient, ending in a
// newly registered passkey. Recovery that leaves someone still without a
// credential is not recovery.
//
// !!! THE HALVES ARE MARKED AGAINST ONE CHALLENGE, NOT COUNTED GLOBALLY. !!!
//
// Every step below takes the recovery token, and every lookup is by that
// token. That is what binds the OTP to the challenge the link belongs to. A
// naive implementation asks "is there a met email half?" and "is there a met
// phone half?", finds both true, and issues a grant: two unrelated checks
// wearing the costume of two factors, letting whoever controls any inbox plus
// any phone recover any account. There is no query here that asks whether a
// half is met without asking whose.
//
// WHY THIS DOES NOT REUSE THE MAGIC-LINK PLUGIN. Better Auth signs a user in
// on magic-link verification; confirmSignIn() depends on exactly that in
// production. If recovery reused it, the emailed link alone would create a
// session and the OTP would be a formality after the fact.
//
// ============================================================================
// THIS IS THE SECOND REGISTRATION PATH, AND A THIRD IS A RULING.
// ============================================================================
//
// The first is @better-auth/passkey's own, covered by test/passkey.test.ts.
// This one exists because the plugin's registration REQUIRES a session, and §1
// says the member registers a passkey and "only now does a session exist".
// Both cannot hold through the plugin's endpoint, so recovery verifies the
// attestation itself with the same library the plugin uses and writes the
// credential directly. Ruled by Guy, 17 Aug 2026.
//
// WHY THE ORDERING IS NOT ARBITRARY (recorded at Guy's instruction): a session
// that exists before any credential is a session an attacker mid-flow could
// use. Credential first, session second means the grant is exchangeable for
// exactly one thing.
//
// TWO PATHS WRITING THE SAME CREDENTIAL SHAPE IS A DRIFT SURFACE. Three is a
// maintenance problem nobody notices until one of them stops working, so
// adding a third is a ruling rather than an implementation detail. The drift
// this one can suffer is caught by the named assertion in the end-to-end test:
// a passkey registered through recovery must AUTHENTICATE, not merely exist as
// a row. If this file and the plugin ever disagree about storage, that test
// goes red and nothing else has to notice.

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { Sql } from "postgres";
import type { Auth } from "./auth.js";
import type { EmailSender } from "./email.js";
import type { OtpSender } from "./otp.js";
import { TOKEN_PURPOSES, mintToken, readRecoveryToken } from "./tokens.js";

/**
 * The WebAuthn challenge for a recovery registration, DERIVED from the
 * recovery token rather than stored.
 *
 * A challenge must be unpredictable to anyone who should not be completing the
 * ceremony. The recovery token already is: 256 bits of randomness, delivered
 * only to a verified inbox, and useless without the phone half. Deriving from
 * it keeps the property and adds no state that could drift out of step with
 * the grant. It is single-use for the same reason the grant is: the challenge
 * dies with the token that produced it.
 *
 * SHA-256 rather than the token itself, so the value presented to the
 * authenticator is not the bearer secret. An attestation object travels
 * further than a token should.
 */
export async function recoveryChallenge(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let s = "";
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Recovery halves live 10 minutes (ruled 15 Aug 2026). */
export const RECOVERY_MINUTES = 10;

export interface RecoveryDeps {
  sql: Sql;
  auth: Auth;
  mail: EmailSender;
  otp: OtpSender;
  baseUrl: string;
  rpId: string;
  origin: string;
}

interface Challenge {
  id: string;
  auth_user_id: string;
  email_half_met_at: Date | null;
  phone_half_met_at: Date | null;
  spent_at: Date | null;
  expires_at: Date;
}


/**
 * The member's verified phone, read through the RLS resolver.
 *
 * `members` carries household_isolation, so this cannot be read without the
 * household GUC, and recovery runs before any household is known: the member
 * has no credential, which is the whole premise. auth_household_id() from
 * migration 0018 answers that one question, and everything after it runs under
 * the policy as normal. This is the second caller of the resolver and the
 * reason it is a function rather than an inline query in phone-change.ts.
 */
async function verifiedPhone(sql: Sql, authUserId: string): Promise<string | null> {
  return await sql.begin(async (tx) => {
    const [resolved] = await tx<{ household_id: string | null }[]>`
      select public.auth_household_id(${authUserId}) as household_id
    `;
    if (!resolved?.household_id) return null;

    await tx`select set_config('marginsheet.household_id', ${resolved.household_id}, true)`;

    const [member] = await tx<{ phone: string | null; verified: Date | null }[]>`
      select phone, phone_verified_at as verified from members
       where auth_user_id = ${authUserId} and status = 'active'
       limit 1
    `;
    // An UNVERIFIED number is not a factor. Recovery that texted a number
    // nobody had proven they hold would be one factor and a formality.
    return member?.phone && member.verified ? member.phone : null;
  });
}

/** Loads a challenge BY ITS TOKEN. The only way any step finds one. */
async function challengeFor(sql: Sql, raw: unknown): Promise<Challenge | null> {
  // The purpose prefix is checked before any lookup, so a sign-in or
  // invitation token presented here is refused because it is not a recovery
  // token, never because it happens to be absent from this table (3.2c).
  const token = readRecoveryToken(raw);
  if (!token) return null;

  const [row] = await sql<Challenge[]>`
    select id, auth_user_id, email_half_met_at, phone_half_met_at, spent_at, expires_at
      from recovery_challenges
     where token = ${token}
       and expires_at > now()
       and spent_at is null
     limit 1
  `;
  return row ?? null;
}

/**
 * Step 1. Opens a challenge and sends both halves.
 *
 * Answers identically whether or not the address is known, for the same reason
 * the sign-in endpoint does: a different answer here enumerates accounts, and
 * recovery is the endpoint an attacker probes first.
 */
export async function requestRecovery(deps: RecoveryDeps, email: string): Promise<void> {
  const ctx = await deps.auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email);
  if (!found) return;

  const phone = await verifiedPhone(deps.sql, found.user.id);
  if (!phone) return;

  const token = mintToken(TOKEN_PURPOSES.recovery);
  await deps.sql`
    insert into recovery_challenges (auth_user_id, token, expires_at)
    values (${found.user.id}, ${token},
            now() + make_interval(mins => ${RECOVERY_MINUTES}))
  `;

  await deps.mail.send({
    to: email,
    subject: "Recovering your MarginSheet™ account",
    text: [
      "You asked to get back into your account.",
      "",
      `${deps.baseUrl}/auth/recovery?token=${encodeURIComponent(token)}`,
      "",
      `Open that, then enter the code we texted you. Both are needed, and both work for ${RECOVERY_MINUTES} minutes.`,
      "",
      "If you did not ask for this, nothing has happened and you can ignore it.",
    ].join("\n"),
  });

  await deps.otp.send(phone);
}

/** Step 2. Marks the EMAIL half. Signs nobody in, deliberately. */
export async function meetEmailHalf(deps: RecoveryDeps, raw: unknown): Promise<boolean> {
  const challenge = await challengeFor(deps.sql, raw);
  if (!challenge) return false;

  await deps.sql`
    update recovery_challenges set email_half_met_at = now() where id = ${challenge.id}
  `;
  return true;
}

/**
 * Step 3. Marks the PHONE half.
 *
 * Takes the recovery TOKEN as well as the code, and that is the cross-account
 * control: the code is checked against the phone belonging to the member this
 * CHALLENGE is for. A code that is valid for somebody else is checked against
 * the wrong number and fails, because there is no path here that accepts a
 * code without first deciding whose it must be.
 */
export async function meetPhoneHalf(
  deps: RecoveryDeps,
  raw: unknown,
  code: string
): Promise<boolean> {
  const challenge = await challengeFor(deps.sql, raw);
  if (!challenge) return false;

  const phone = await verifiedPhone(deps.sql, challenge.auth_user_id);
  if (!phone) return false;

  if (!(await deps.otp.check(phone, code))) return false;

  await deps.sql`
    update recovery_challenges set phone_half_met_at = now() where id = ${challenge.id}
  `;
  return true;
}

export type GrantState =
  | { granted: true; authUserId: string; challengeId: string }
  | { granted: false; reason: "no_challenge" | "email_half_missing" | "phone_half_missing" };

/** Both halves, on one row, unexpired and unspent. Nothing else is a grant. */
export async function grantState(deps: RecoveryDeps, raw: unknown): Promise<GrantState> {
  const challenge = await challengeFor(deps.sql, raw);
  if (!challenge) return { granted: false, reason: "no_challenge" };
  if (!challenge.email_half_met_at) return { granted: false, reason: "email_half_missing" };
  if (!challenge.phone_half_met_at) return { granted: false, reason: "phone_half_missing" };
  return { granted: true, authUserId: challenge.auth_user_id, challengeId: challenge.id };
}

export type RecoveryOutcome =
  | { status: "recovered"; setCookie: string }
  | { status: "refused"; reason: GrantState extends { granted: false } ? never : string };

/**
 * Step 4. Spends the grant on a passkey, and ONLY on a passkey.
 *
 * Ordering, which §1 states and which is not arbitrary: verify the
 * attestation, write the credential, THEN issue a session. A session that
 * existed before the credential would be usable by an attacker mid-flow, and
 * the whole point of the grant is that it is exchangeable for exactly one
 * thing.
 */
export async function registerPasskeyFromGrant(
  deps: RecoveryDeps,
  raw: unknown,
  attestation: unknown,
  deviceName = "Recovered device"
): Promise<{ ok: false; reason: string } | { ok: true; sessionToken: string }> {
  const grant = await grantState(deps, raw);
  if (!grant.granted) return { ok: false, reason: grant.reason };

  const expectedChallenge = await recoveryChallenge(readRecoveryToken(raw)!);

  // Real WebAuthn verification, with the same library the plugin uses and the
  // same expectations. Not a stub and not a weaker check.
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestation as never,
      expectedChallenge,
      expectedOrigin: deps.origin,
      expectedRPID: deps.rpId,
      requireUserVerification: false,
    });
  } catch {
    return { ok: false, reason: "attestation_invalid" };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: "attestation_invalid" };
  }

  const info = verification.registrationInfo;
  const credential = info.credential;

  // The grant is spent FIRST, conditionally, so a concurrent second attempt
  // cannot also pass. The update returns no row if somebody else spent it.
  const spent = await deps.sql<{ id: string }[]>`
    update recovery_challenges
       set spent_at = now()
     where id = ${grant.challengeId} and spent_at is null
    returning id
  `;
  if (spent.length === 0) return { ok: false, reason: "already_spent" };

  const toBase64Url = (bytes: Uint8Array) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  await deps.sql`
    insert into passkey (id, name, public_key, user_id, credential_id, counter,
                         device_type, backed_up, transports, created_at, aaguid)
    values (${crypto.randomUUID()}, ${deviceName},
            ${toBase64Url(credential.publicKey)}, ${grant.authUserId},
            ${credential.id}, ${credential.counter},
            ${info.credentialDeviceType}, ${info.credentialBackedUp},
            ${(credential.transports ?? []).join(",") || null}, now(), ${info.aaguid ?? null})
  `;

  // The credential exists. NOW a session may.
  const ctx = await deps.auth.$context;
  const session = await ctx.internalAdapter.createSession(grant.authUserId, false);
  return { ok: true, sessionToken: session.token };
}
