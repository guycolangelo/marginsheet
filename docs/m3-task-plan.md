# M3 Task Plan, Auth and Household Membership
## Drafted for Guy's approval, 15 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §§1 and 7, data-model-spec (members, invitations, consent_records).

---

## Scope

**In:** everything that decides who a person is and which household they belong to. Better Auth passwordless (passkey plus magic link), phone verification through Twilio Verify as a security primitive, sessions and recent-auth re-challenge, the three phone rules, and §7 member invitations.

**Out, and refused by default:** the onboarding spine, Stripe, trials, cancellation (all M7). Screens (M8). The brains' intros on join (M13). M3 builds the enforcement; M8 builds the rooms it is enforced in.

**Invariants owned:** §9's 3 (no channel message reaches an unverified phone) and 4 (phone change requires in-app recent-auth; no channel input can ever alter a phone). Everything else in §9 is M7's.

## Prerequisites, both now closed

| Prerequisite | Status |
|---|---|
| BYPASSRLS spike | Closed. All six Workers authenticate as `marginsheet_app`, gated by a blocking CI job. |
| Live Verify OTP decoupling check | Closed 15 Aug. HTTP 201 pending, then 200 approved, no session-shaped field. |

Carried constraint: the Twilio account is on trial until 19 Aug, so Verify reaches allowlisted numbers only. Founder testing is unaffected. **The gate is the first non-founder phone, not the date.**

---

## Task 3.0, the spike and the foundation

**The spike comes first, and its outcome is reported either way.** Better Auth is assumed to run on Cloudflare Workers against Neon over HTTP. That assumption has never been executed. Today proved what happens when a stated mitigation was never in place, so before any auth code is written:

- Stand Better Auth up in a Worker, against the dev Neon branch, as `marginsheet_app`.
- Prove one real session round trip: create a user, issue a session cookie, read it back on a second request.
- Confirm the Neon adapter works under Workers' runtime constraints, and confirm it works as a **non-superuser role subject to RLS**, which is the part most likely to break and the part nobody has tested.

If it does not work, I stop and bring you the finding rather than routing around it.

Then, assuming green:
- Migration 0011 creating Better Auth's own tables (user, session, account, verification, passkey).
- **The `members.auth_user_id` integrity test M1 owed.** 1.1 ruled no FK on that column, a soft reference with an integrity test instead. The user table did not exist then. It does now, so that test lands here and the M1 open item closes.
- Session configuration: secure, httpOnly, 30-day rolling.

## Task 3.1, passkeys, and losing every device

Passkey registration and login. Then the question you asked me to answer plainly.

**What happens when a household loses every device.** My proposal, for your ruling: magic link to the verified email, then a phone OTP, both required, neither sufficient. That reconstructs access from two independent channels without a password existing anywhere. If the email is also gone, the path is support-mediated with identity proof, deliberately slow, and it is the only human-in-the-loop path in the auth system.

I want your ruling on this because it is the floor of the whole security model: **whatever this path is, it is the weakest way into a household**, and everything above it is decoration if it is wrong.

## Task 3.2, magic link, and the passkey tightening

Magic link as the second factor of identity, never the first when a passkey exists.

The §1 tightening you ruled, now in code: **a phone change requires a passkey when the member has one registered; a magic link is accepted only when no passkey exists.** The test attempts the forbidden thing: a member with a registered passkey tries to change their phone behind a magic link, and is refused.

## Task 3.3, phone verification and the three rules

The Twilio Verify send hook, wired to the service the probe validated. Then the three rules from 1.1's column comments, enforced in code and each proven by attempting the violation:

1. No channel access of any kind until `phone_verified_at` is set. (Invariant 3.)
2. Phone changes in-app only, behind fresh auth; no write path from any channel. (Invariant 4.)
3. One verified phone per member; a number in use by another member in any household is rejected with support routing.

Rule 3 needs a decision from you: the rejection must not disclose that the number exists elsewhere, because that leaks household membership to a stranger who guesses a number. I propose the rejection is generic to the user and specific in the support queue.

## Task 3.4, recent-auth re-challenge

The 10-minute window for sensitive actions (phone change, member removal, export; cancellation is M7's but the mechanism is shared). Proven by clock manipulation, not by trusting the config: an action attempted at 10 minutes and one second is refused.

## Task 3.5, member invitations (§7)

Invitation with an unguessable token and 14-day expiry. Invitee path: link, then passkey or magic link, then phone OTP, then `full_member`.

**No secrets between principals is stated in the invite email, before joining, not after.** That is a §7 requirement and it is testable: the invitation email body is asserted to carry it.

Until A2P clears, invitation SMS rides the transactional path; if blocked, invitations fall back to email, degraded and documented. The brains' intros on join are M13 and are not built here.

## Task 3.6, the consolidated suite

Invariants 3 and 4 named in the manifest with their proofs, the M1 `auth_user_id` open item closed, and every discipline gap this module inherits or creates carried with an owner.

---

## Four things I want your ruling on before I build

1. **The lost-every-device path** (3.1). My proposal is above. This is the floor of the security model.
2. **Duplicate-phone rejection wording** (3.3). Generic to the user, specific to support, so a stranger guessing numbers learns nothing.
3. **Does M3 expose HTTP endpoints, or only the service layer?** The spec says phone changes happen "in-app," and the app is M8. I propose M3 ships the enforcement plus the endpoints, and M8 ships the screens that call them, so M3's rules are testable over the wire rather than only as functions.
4. **OTP rate limiting.** §8 instruments OTP failure rate but no spec section throttles it. Unthrottled OTP is an SMS-cost attack and a brute-force surface. I propose M3 owns throttling. If you would rather it wait, it becomes a named discipline gap with an owner rather than a silence.

## The verification test, applied to this module up front

Per the constitution's new rule, each control this module ships is designed to answer yes to "if the thing this guards were completely broken, would this go red?" Concretely: every phone rule is proven by attempting the violation and requiring refusal, the recent-auth window is proven by manipulating the clock, and the passkey tightening is proven by trying to change a phone behind a magic link. No test in M3 asserts that a control exists. Each asserts that it bites.
