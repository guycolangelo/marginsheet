// The gate on household-facing channel access (M3 task 3.3, invariant 3).
//
// !!! THE COLUMN, NOT THE NUMBER. !!!
//
// Every gated send path checks `phone_verified_at`. Checking that a phone
// number EXISTS is the natural mistake and it passes every functional test,
// because a member with an unverified number does have a number. That is why
// there is one gate function and a static test that fails when a send path
// checks the wrong thing.
//
// WHAT IS GATED, ruled by Guy 17 Aug 2026 and recorded in migration 0020:
//
//   GATED   messages about the household's MONEY. Everything MyKeeper sends:
//           digests, alerts, statements, questions, broadcasts.
//   UNGATED transactional mail about the household's ACCESS. Sign-in links,
//           recovery, the day-12 pre-charge notice. MarginSheet speaking as
//           itself rather than a brain.
//
// WHY ACCESS MAIL IS NOT AN EXEMPTION. That mail is how a member reaches the
// state where a phone can be verified at all. 0001's literal wording gated
// every email, and under it a household who abandoned at step 1 could never
// come back, which contradicts the spine's own recovery path.
//
// The line is MONEY versus ACCESS, not a list. A new send path asks which of
// the two it is, and the answer decides. That is what stops the exemptions
// growing one plausible case at a time.

import type { Sql } from "postgres";

export type ChannelDecision =
  | { mayReach: true }
  | { mayReach: false; reason: "no_member" | "phone_unverified" };

/**
 * Whether a household-facing channel message may reach this member.
 *
 * Reads `phone_verified_at` and nothing else. It deliberately does NOT return
 * the phone number: a gate that hands back the thing it guards invites a caller
 * to keep the number and skip the gate next time.
 */
export async function mayReachMember(sql: Sql, memberId: string): Promise<ChannelDecision> {
  const [row] = await sql<{ verified: Date | null }[]>`
    select phone_verified_at as verified from members
     where id = ${memberId} and status = 'active'
     limit 1
  `;
  if (!row) return { mayReach: false, reason: "no_member" };
  // Null is the closed state. A removed member and an unverified one both get
  // nothing, and neither case is a special case.
  if (!row.verified) return { mayReach: false, reason: "phone_unverified" };
  return { mayReach: true };
}
