// Phone verification, and the two failures a household must be able to act on
// (M3 task 3.3).
//
// Verification is Twilio Verify OTP. `phone_verified_at` is set ONLY by an
// approved check, because that column is the gate on every household-facing
// channel message and setting it on anything less would open the gate without
// anyone having proven they hold the number.
//
// TWO REFUSALS THAT MUST BE HONEST, and they are the same lesson twice:
// A REFUSAL THE HOUSEHOLD CANNOT ACT ON IS INDISTINGUISHABLE FROM A BUG.
//
// 1. RULE 2, the global uniqueness collision. `members_verified_phone_unique`
//    already refuses a number another member has VERIFIED. What did not exist
//    was the honest failure: the collision surfaced as a Postgres unique
//    violation and reached the household as a 500. 0001 says "rejected with
//    support routing, never silently reassigned", and a 500 is neither.
//
//    UNVERIFIED duplicates are permitted on purpose. Two people may begin
//    signup with the same typo, and locking a household out over somebody
//    else's typo is the failure the partial index was designed to avoid. So
//    the collision check asks whether the number is verified BY SOMEONE ELSE,
//    not whether it appears twice.
//
// 2. TWILIO REFUSING THE NUMBER. The account is on trial, so Verify reaches
//    only allowlisted numbers. That constraint disappears on upgrade; the
//    error path does not, because Twilio refuses numbers for reasons that
//    outlive the trial: a landline, an invalid number, a blocked region, an
//    unreachable carrier, a rate limit.
//
//    Two outcomes are forbidden. A HANG, so the send is bounded by a timeout
//    and a timeout is a refusal. And a 500, which from the household's side is
//    a silent success: they were told nothing and nothing happened.
//
//    The copy distinction that matters: "we cannot text that number" is about
//    the number and invites correcting it. "Something went wrong" invites
//    nothing.

import type { Sql } from "postgres";
import type { OtpSender } from "./otp.js";

/** A send that has not answered in this long is a refusal, not a wait. */
export const SEND_TIMEOUT_MS = 10_000;

export type StartOutcome =
  | { status: "sent" }
  | { status: "refused"; reason: "invalid_phone"; message: string }
  | { status: "refused"; reason: "already_verified_elsewhere"; message: string }
  | { status: "refused"; reason: "unreachable_number"; message: string }
  | { status: "refused"; reason: "provider_unavailable"; message: string };

export type CheckOutcome =
  | { status: "verified" }
  | { status: "refused"; reason: "wrong_code" | "no_pending_number"; message: string }
  | { status: "refused"; reason: "already_verified_elsewhere"; message: string };

/** E.164. 3.3 owns real validation; the shape is checked before anything else. */
const PHONE = /^\+[1-9]\d{6,14}$/;

/** Postgres unique violation. */
const UNIQUE_VIOLATION = "23505";

function isPhoneCollision(error: unknown): boolean {
  const e = error as { code?: string; constraint_name?: string; message?: string };
  return (
    e?.code === UNIQUE_VIOLATION &&
    String(e.constraint_name ?? e.message ?? "").includes("members_verified_phone_unique")
  );
}

/**
 * Whether this number is already VERIFIED by a different member THAT THIS
 * CALLER CAN SEE.
 *
 * !!! THIS CANNOT ENFORCE RULE 2, AND IT IS NOT WHAT DOES. !!!
 *
 * Rule 2 is global: a number verified by a member in ANY household is refused.
 * `members` carries household_isolation, so a query running in household A
 * cannot see household B's rows at all. A pre-check is therefore blind to
 * exactly the case the rule is about.
 *
 * What enforces rule 2 is `members_verified_phone_unique`, which is an index
 * and does not care about policies. So the CONSTRAINT is the enforcement and
 * the error translation below is the honesty. That is the right way round:
 * verify against the database rather than against a query that has been
 * filtered before it answered.
 *
 * This pre-check is kept because it catches the same-household case before a
 * code is sent, which is a better experience when it applies. It is not relied
 * on, and a caller reading only this function would think rule 2 lived here.
 *
 * The alternative was a second SECURITY DEFINER function to see across
 * households. That is a ruling of Guy''s per migration 0018, and it is not
 * needed: the constraint already sees everything.
 */
async function verifiedByAnother(
  sql: Sql,
  phone: string,
  memberId: string
): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    select id from members
     where phone = ${phone}
       and phone_verified_at is not null
       and id <> ${memberId}
     limit 1
  `;
  return Boolean(row);
}

/** Bounds a provider call. A hang is a refusal the household can act on. */
async function bounded<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error?: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("__timeout__")), SEND_TIMEOUT_MS);
    });
    return { ok: true, value: await Promise.race([work, timeout]) };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "__timeout__";
    return { ok: false, timedOut, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Starts verification for a member's number.
 *
 * The number is recorded UNVERIFIED and the gate stays closed until a code is
 * approved. Nothing here can open it.
 */
export async function startPhoneVerification(
  sql: Sql,
  otp: OtpSender,
  memberId: string,
  phone: string
): Promise<StartOutcome> {
  const trimmed = phone.trim();
  if (!PHONE.test(trimmed)) {
    return {
      status: "refused",
      reason: "invalid_phone",
      message: "That does not look like a phone number. Include the country code, like +15551234567.",
    };
  }

  // Rule 2, best effort before sending, so a household in the SAME household
  // never receives a code for a number they cannot keep. The cross-household
  // case is invisible here and is caught by the constraint at confirm time.
  if (await verifiedByAnother(sql, trimmed, memberId)) {
    return {
      status: "refused",
      reason: "already_verified_elsewhere",
      // Names what happened and what to do. It deliberately does NOT say who
      // holds the number: that would confirm another household's phone to
      // whoever typed it.
      message:
        "That number is already verified on another MarginSheet account. " +
        "If it is yours, contact support and we will move it across.",
    };
  }

  const sent = await bounded(otp.send(trimmed));
  if (!sent.ok) {
    // A timeout and a provider error are DIFFERENT FIXES, so they are kept
    // apart here even though the household-facing shape is similar. One is
    // ours to chase, the other is the number.
    if (sent.timedOut) {
      return {
        status: "refused",
        reason: "provider_unavailable",
        message: "We could not send a code just now. Try again in a moment.",
      };
    }
    return {
      status: "refused",
      reason: "unreachable_number",
      message:
        "We cannot text that number. Check it, or use a mobile number that can receive SMS.",
    };
  }

  // Recorded unverified. The gate is still shut.
  await sql`
    update members set phone = ${trimmed}, phone_verified_at = null, updated_at = now()
     where id = ${memberId}
  `;
  return { status: "sent" };
}

/**
 * Checks a code and, only on approval, opens the gate.
 *
 * Rule 2 is checked AGAIN here. Between the send and the check, another member
 * could have verified the same number, and a uniqueness rule enforced only on
 * the way in is a uniqueness rule with a window.
 */
export async function confirmPhoneVerification(
  sql: Sql,
  otp: OtpSender,
  memberId: string,
  code: string
): Promise<CheckOutcome> {
  const [member] = await sql<{ phone: string | null }[]>`
    select phone from members where id = ${memberId} and status = 'active' limit 1
  `;
  if (!member?.phone) {
    return {
      status: "refused",
      reason: "no_pending_number",
      message: "There is no number waiting to be verified. Start again and we will text a code.",
    };
  }

  const checked = await bounded(otp.check(member.phone, code.trim()));
  if (!checked.ok || checked.value !== true) {
    return {
      status: "refused",
      reason: "wrong_code",
      message: "That code did not match. Check it, or ask for a new one.",
    };
  }

  // The one place this column is ever set, and the place rule 2 is actually
  // enforced. The partial unique index sees every household; this query does
  // not. So the write is attempted and the violation is TRANSLATED, rather
  // than pre-checked by something that cannot see the collision.
  //
  // That also closes the race a pre-check leaves open: between checking and
  // writing, somebody else could verify the same number.
  try {
    await sql`
      update members set phone_verified_at = now(), updated_at = now()
       where id = ${memberId}
    `;
  } catch (error) {
    if (isPhoneCollision(error)) {
      // 0001: "rejected with support routing, never silently reassigned". The
      // constraint guaranteed the second half; this supplies the first.
      return {
        status: "refused",
        reason: "already_verified_elsewhere",
        message:
          "That number is already verified on another MarginSheet account. " +
          "If it is yours, contact support and we will move it across.",
      };
    }
    throw error;
  }
  return { status: "verified" };
}
