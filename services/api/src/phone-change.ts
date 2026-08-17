// POST /auth/phone: the minimal real phone-change endpoint (M3 task 3.1a).
//
// OWED SINCE 15 AUGUST. The 3.2 plan ruled: "Build the minimal real endpoint
// here, not a stand-in. A control tested against a stand-in is a control
// nobody has exercised, and the endpoint is small." 3.2b shipped
// `mayChangePhone()` and a pure-logic test, and the endpoint never landed. The
// decision table was correct, tested, and wired to nothing: no path existed
// through which a phone change could be attempted, so the §1 tightening could
// not have gone red however broken it was. This closes that.
//
// WHAT IS IN SCOPE HERE: authorization only. The phone-change MECHANICS,
// meaning uniqueness, the verification round trip through Twilio Verify, and
// the rule that no channel write path exists, remain task 3.3. This endpoint
// decides whether the caller is allowed to change the number at all, which is
// the half §1 tightened.
//
// THE RULE (identity-onboarding-spec §1, tightened 15 Aug 2026): a phone
// change requires a passkey when the member has one registered. A magic link
// is accepted only when no passkey exists. The phone is the SIM-swap surface,
// so an email-delivered link that can move it lets whoever controls the inbox
// move the security primitive. A passkey is bound to hardware and cannot be
// forwarded.
//
// PROVENANCE IS EVERYTHING. The credential class comes from
// `session.auth_method`, which is written by the server from the path it just
// executed and is declared `input: false` so it cannot be supplied by a
// client. Migration 0015's comment states the consequence plainly: a
// client-supplied value would make this entire tightening advisory. Nothing in
// this file reads anything the caller said about how they signed in.

import type { Sql } from "postgres";
import type { Auth } from "./auth.js";
import { mayChangePhone, type AuthMethod } from "./auth-guard.js";

export type PhoneChangeOutcome =
  | { status: "changed" }
  | { status: "refused"; reason: "passkey_required" }
  | { status: "refused"; reason: "not_signed_in" }
  | { status: "refused"; reason: "no_member" }
  | { status: "refused"; reason: "invalid_phone" };

/** E.164, loosely. 3.3 owns real validation; this only rejects the absurd. */
const PHONE = /^\+[1-9]\d{6,14}$/;

export async function changePhone(
  auth: Auth,
  sql: Sql,
  request: Request
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session) {
    return Response.json(
      { status: "refused", reason: "not_signed_in" } satisfies PhoneChangeOutcome,
      { status: 401 }
    );
  }

  let phone = "";
  try {
    const body = (await request.json()) as { phone?: unknown };
    phone = typeof body.phone === "string" ? body.phone.trim() : "";
  } catch {
    phone = "";
  }
  if (!PHONE.test(phone)) {
    return Response.json(
      { status: "refused", reason: "invalid_phone" } satisfies PhoneChangeOutcome,
      { status: 400 }
    );
  }

  const userId = session.user.id;

  // BOOTSTRAPPING PAST RLS, exactly one id wide.
  //
  // `members` carries household_isolation, which filters on the
  // marginsheet.household_id GUC. A session identifies a USER; the member row
  // says which HOUSEHOLD; and the member row cannot be read until the
  // household is known. auth_household_id() is the SECURITY DEFINER resolver
  // from migration 0018 that answers that one question and nothing else.
  //
  // Everything after this line runs under the policy as normal. The GUC is set
  // from the resolver's answer, so the caller sees exactly what the policy
  // already intended them to see, and no more.
  const [resolved] = await sql<{ household_id: string | null }[]>`
    select public.auth_household_id(${userId}) as household_id
  `;
  if (!resolved?.household_id) {
    return Response.json(
      { status: "refused", reason: "no_member" } satisfies PhoneChangeOutcome,
      { status: 403 }
    );
  }

  // ONE TRANSACTION, because set_config's third argument is is_local: the
  // setting lives for the current transaction only. Each statement outside a
  // transaction is its own implicit one, so a GUC set that way would be gone
  // before the next query and every policied read would return nothing. The
  // transaction-local form is still the right one: a session-level GUC would
  // outlive the request on a reused connection and leak one household's
  // context into the next caller's.
  return await sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${resolved.household_id}, true)`;

    // A policied read, under the policy. If the GUC were wrong or unset this
    // returns nothing and the request is refused, which is the safe direction.
    const [member] = await tx<{ id: string }[]>`
      select id from members where auth_user_id = ${userId} limit 1
    `;
    if (!member) {
      return Response.json(
        { status: "refused", reason: "no_member" } satisfies PhoneChangeOutcome,
        { status: 403 }
      );
    }

    // Does this member hold ANY passkey? Asked of the database, not of the
    // session and not of anything the caller sent.
    const [{ count }] = await tx<{ count: string }[]>`
      select count(*) as count from passkey where user_id = ${userId}
    `;
    const memberHasPasskey = Number(count) > 0;

    // The credential class that established THIS session, server-written.
    const authMethod = ((session.session as { auth_method?: unknown }).auth_method ??
      null) as AuthMethod;

    const decision = mayChangePhone({ sessionAuthMethod: authMethod, memberHasPasskey });
    if (!decision.allowed) {
      // Refused BEFORE any write. The test asserts on the database row rather
      // than this response, because a handler that returns 403 while writing
      // the change would otherwise look identical from the outside.
      return Response.json(
        { status: "refused", reason: decision.reason } satisfies PhoneChangeOutcome,
        { status: 403 }
      );
    }

    // Authorization only. The number is recorded as UNVERIFIED: verification
    // is 3.3's, and a changed number that arrived already verified would
    // defeat the point of verifying it.
    await tx`
      update members
         set phone = ${phone}, phone_verified_at = null, updated_at = now()
       where id = ${member.id}
    `;

    return Response.json({ status: "changed" } satisfies PhoneChangeOutcome);
  });
}
