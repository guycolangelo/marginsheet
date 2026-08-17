// Member invitations (M3 task 3.5, identity-onboarding-spec §7).
//
// "Primary adds a member: name + phone (+ optional email) -> invitation with
// unguessable token, 14-day expiry. Invitee path: link -> passkey/magic-link
// identity -> phone OTP -> joined as full_member."
//
// INVITATION CREATION IS A SENSITIVE ACTION (amendment 11, ruled 17 Aug 2026).
// §1 listed four and did not include member addition; it does now. A stolen
// session that invites its own address creates a permanent second door into the
// household's books, one that survives the original member noticing, because it
// is not a session to revoke but a member. Removal is loud and gets noticed
// within a day; addition is quiet and durable. And because every full member
// sees everything, an invitation is the largest single grant the product makes.
//
// DELIVERY OR NOTHING. The row is written and the email sent inside one
// transaction, so a send that fails rolls the invitation back. An invitation
// nobody received is a row that makes a household think they invited somebody.
//
// EMAIL FIRST, AND THAT IS THE DEGRADED PATH RATHER THAN A CHOICE. §7 puts the
// invitation SMS on the transactional path until A2P clears, and today both A2P
// and the Twilio trial block it. The sender is an interface so the switch is
// configuration rather than a rewrite.

import type { Sql } from "postgres";
import type { EmailSender } from "./email.js";
import { TOKEN_PURPOSES, mintToken, readInvitationToken } from "./tokens.js";

/** Ported from Base44 and restated in §7. */
export const INVITATION_DAYS = 14;

/**
 * The no-secrets statement, stated BEFORE joining rather than after.
 *
 * §7: "No secrets between principals is stated in the invite email, before
 * joining, not after." The substance, from the conversation service spec:
 * "Nothing a member tells the brains is confidential from the other full
 * members."
 *
 * Before joining is the whole requirement. Somebody deciding whether to join a
 * household's financial life needs to know what they tell MyKeeper is visible
 * to the other members AT THE MOMENT THEY ARE DECIDING. Afterwards it is a
 * disclosure about a choice they have already made.
 */
export const NO_SECRETS_STATEMENT =
  "Everyone in a MarginSheet household sees everything. Anything you tell MyKeeper is " +
  "visible to the other members, and anything they tell it is visible to you. There are no " +
  "private notes and no separate books.";

export interface InvitationDeps {
  sql: Sql;
  mail: EmailSender;
  baseUrl: string;
}

export type CreateOutcome =
  | { status: "invited"; token: string }
  | { status: "refused"; reason: "not_primary" | "invalid_phone" | "no_email" | "undeliverable" };

const PHONE = /^\+[1-9]\d{6,14}$/;

/**
 * Creates an invitation. PRIMARY ONLY.
 *
 * `members.is_primary` has existed since M1 and nothing has read it until now.
 * A household where any member can invite is a household where compromising the
 * least careful member compromises everything, which defeats the point of
 * having a primary at all.
 *
 * The caller has already been checked for recent-auth by the route, because
 * that check belongs to the sensitive-action layer rather than to this function.
 */
export async function createInvitation(
  deps: InvitationDeps,
  actingMemberId: string,
  invitee: { name: string; phone: string; email?: string }
): Promise<CreateOutcome> {
  if (!PHONE.test(invitee.phone.trim())) {
    return { status: "refused", reason: "invalid_phone" };
  }
  // Email is optional in §7 and required by us TODAY, because delivery is
  // email-first while A2P is unsubmitted. When SMS opens, this becomes optional
  // again and the refusal disappears rather than the rule changing.
  if (!invitee.email?.trim()) {
    return { status: "refused", reason: "no_email" };
  }

  const [actor] = await deps.sql<{ household_id: string; is_primary: boolean }[]>`
    select household_id, is_primary from members
     where id = ${actingMemberId} and status = 'active'
     limit 1
  `;
  if (!actor?.is_primary) {
    return { status: "refused", reason: "not_primary" };
  }

  const token = mintToken(TOKEN_PURPOSES.invitation);

  try {
    await deps.sql.begin(async (tx) => {
      await tx`
        insert into invitations
          (household_id, token, invited_email, invited_phone, expires_at)
        values
          (${actor.household_id}, ${token}, ${invitee.email!.trim().toLowerCase()},
           ${invitee.phone.trim()}, now() + make_interval(days => ${INVITATION_DAYS}))
      `;

      // Inside the transaction on purpose. A send that throws rolls the
      // invitation back, so the household is never told they invited somebody
      // who was never contacted.
      await deps.mail.send({
        to: invitee.email!.trim(),
        subject: "You have been added to a MarginSheet™ household",
        text: [
          `${invitee.name}, you have been invited to join a household on MarginSheet.`,
          "",
          `${deps.baseUrl}/household/invitations/accept?token=${encodeURIComponent(token)}`,
          "",
          NO_SECRETS_STATEMENT,
          "",
          `This invitation works for ${INVITATION_DAYS} days.`,
          "",
          "If you were not expecting this, you can ignore it and nothing happens.",
        ].join("\n"),
      });
    });
  } catch {
    return { status: "refused", reason: "undeliverable" };
  }

  return { status: "invited", token };
}

export type RedeemOutcome =
  | { status: "joined"; memberId: string }
  | { status: "refused"; reason: "no_invitation" | "already_member" };

/**
 * Redeems an invitation into a member row.
 *
 * The invitee has established identity by this point, by passkey or magic link,
 * and holds a session. What they do NOT hold is a member row, which is what
 * this creates.
 *
 * The phone arrives UNVERIFIED. They are a full_member immediately and nothing
 * about the household's money can reach them until they complete the OTP, which
 * is rule 3 doing its job rather than a separate rule: a member with an
 * unverified number is a member in name only.
 */
export async function redeemInvitation(
  sql: Sql,
  raw: unknown,
  authUserId: string
): Promise<RedeemOutcome> {
  // Purpose checked before any lookup, so a sign-in or recovery token is
  // refused for being the wrong kind rather than for being absent (3.2c).
  const token = readInvitationToken(raw);
  if (!token) return { status: "refused", reason: "no_invitation" };

  return await sql.begin(async (tx) => {
    // The invitation is read WITHOUT household context, which is why this
    // query runs before any GUC is set: the invitee does not belong to the
    // household yet, so there is nothing to scope to. `invitations` carries
    // household_isolation, so this runs as the owner-privileged path only in
    // the sense that no policy context exists to filter it; see the route,
    // which resolves nothing because there is nothing to resolve.
    const [invitation] = await tx<{ id: string; household_id: string; invited_phone: string | null }[]>`
      select id, household_id, invited_phone from invitations
       where token = ${token}
         and status = 'pending'
         and expires_at > now()
       limit 1
    `;
    if (!invitation) return { status: "refused", reason: "no_invitation" };

    const [existing] = await tx<{ id: string }[]>`
      select id from members where auth_user_id = ${authUserId} limit 1
    `;
    if (existing) return { status: "refused", reason: "already_member" };

    await tx`select set_config('marginsheet.household_id', ${invitation.household_id}, true)`;

    const [member] = await tx<{ id: string }[]>`
      insert into members (household_id, first_name, role, auth_user_id, phone)
      values (${invitation.household_id}, 'Member', 'full_member', ${authUserId},
              ${invitation.invited_phone})
      returning id
    `;

    // Single use. The status change and the member creation are one
    // transaction, so a failure cannot leave an accepted invitation with no
    // member or a member with a still-pending invitation.
    await tx`
      update invitations
         set status = 'accepted', accepted_by_member_id = ${member.id}, updated_at = now()
       where id = ${invitation.id}
    `;

    return { status: "joined", memberId: member.id };
  });
}
