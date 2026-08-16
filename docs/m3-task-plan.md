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

**What happens when a household loses every device. RULED 15 Aug 2026 (Guy), approved as proposed.** Magic link to the verified email AND a phone OTP. Both required, neither sufficient. Access is reconstructed from two independent channels, with no password existing anywhere.

**The reasoning, recorded because it governs every future change to this path:** single-factor recovery makes the recovery path the weakest link, and an attacker attacks the weakest link. A recovery path weaker than the primary path means the primary path's strength is decorative. Anyone proposing to simplify this later is proposing to make passkeys ornamental.

**Email also gone:** slow, support-mediated identity proof. **Slow is a feature, not an apology**, and it is never to be written about as friction to be reduced. This is an OWED PROCESS, not code, and it is NOT built in M3. It is carried as a named open item with an owner.

## SEQUENCE CHANGE, 15 August 2026 (approved by Guy)

**3.2 now runs before 3.1.** The order below is written as originally approved; the executed order is:

| Order | Task |
|---|---|
| 1 | **3.2** magic link sign-in, which is the first path that issues a real session |
| 2 | **3.1a** passkey registration and login |
| 3 | **3.1c** the layer 1 HTTP proof |
| 4 | **3.1b** the recovery path, which needs both of the above to exist |
| 5 | 3.3, 3.4, 3.5, 3.6 unchanged |

**Why, and the reason is not the one that surfaced it.** 3.1a stalled because Better Auth signs its session cookies and passkey registration requires a signed-in caller, so a test minting a session through `internalAdapter` was rejected before reaching any WebAuthn code.

The harness problem is real but it is not the justification. Guy's ruling, recorded because it governs how this kind of test gets written from here on: **a test that mints a session through `internalAdapter` is testing a session the product never issues.** Driving passkey registration against a session that came from a real sign-in over a real endpoint is more faithful, not merely more convenient. The blocker pushed the work toward the more honest test.

The layer 1 proof moves for the same reason rather than a related one: it needs a real request context with real headers, which only a real sign-in produces.

**The condition attached to this change.** When 3.2 lands, confirm that a real signed cookie from a real magic-link sign-in genuinely exercises the WebAuthn path end to end. If registration turns out to need something else the harness still cannot produce, that is a **named gap with an owner and a manual verification**, not another workaround. Two reorderings to dodge the same wall would mean the wall is the finding.

---

## Task 3.2, magic link, and the passkey tightening

Magic link as the second factor of identity, never the first when a passkey exists.

The §1 tightening you ruled, now in code: **a phone change requires a passkey when the member has one registered; a magic link is accepted only when no passkey exists.** The test attempts the forbidden thing: a member with a registered passkey tries to change their phone behind a magic link, and is refused.

## Task 3.3, phone verification and the three rules

The Twilio Verify send hook, wired to the service the probe validated. Then the three rules from 1.1's column comments, enforced in code and each proven by attempting the violation:

1. No channel access of any kind until `phone_verified_at` is set. (Invariant 3.)
2. Phone changes in-app only, behind fresh auth; no write path from any channel. (Invariant 4.)
3. One verified phone per member; a number in use by another member in any household is rejected with support routing.

**Rule 3 wording, RULED 15 Aug 2026 (Guy), approved.** Generic to the user, specific in the support queue. Never disclose that the number exists. Never hint at which household. The user-facing message routes to support **without implying wrongdoing**: a spouse mistyping their partner's number is a likelier cause than an attacker enumerating, and the copy is written for the likely case, not the adversarial one.

## Task 3.4, recent-auth re-challenge

The 10-minute window for sensitive actions (phone change, member removal, export; cancellation is M7's but the mechanism is shared). Proven by clock manipulation, not by trusting the config: an action attempted at 10 minutes and one second is refused.

## Task 3.5, member invitations (§7)

Invitation with an unguessable token and 14-day expiry. Invitee path: link, then passkey or magic link, then phone OTP, then `full_member`.

**No secrets between principals is stated in the invite email, before joining, not after.** That is a §7 requirement and it is testable: the invitation email body is asserted to carry it.

Until A2P clears, invitation SMS rides the transactional path; if blocked, invitations fall back to email, degraded and documented. The brains' intros on join are M13 and are not built here.

## Task 3.6, the consolidated suite

Invariants 3 and 4 named in the manifest with their proofs, the M1 `auth_user_id` open item closed, and every discipline gap this module inherits or creates carried with an owner.

---

## The four rulings (all answered 15 Aug 2026)

1. **Lost-every-device, RULED: approved as proposed** (3.1). Magic link AND phone OTP, both required, neither sufficient. A recovery path weaker than the primary path makes the primary path's strength decorative. Email-also-gone is slow support-mediated identity proof, an owed process, not built in M3.
2. **Duplicate-phone wording, RULED: approved** (3.3). Generic to the user, specific in the support queue. Never disclose the number exists, never hint at which household, never imply wrongdoing.
3. **Endpoints, RULED: yes.** M3 ships enforcement plus endpoints; M8 ships the screens that call them. Guy's reasoning: *a rule only reachable through a service function nobody calls yet is a rule nobody has exercised.*
4. **OTP rate limiting, RULED: M3 owns it.** It is an SMS-cost attack and a brute-force surface, and both go live the moment an endpoint exists. Deferring would ship the attack surface in M3 and the control in M8, which is backwards. **Limits per phone, per member, and per IP, expressed as config rather than constants.**

## The verification test, applied to this module up front

Per the constitution's new rule, each control this module ships is designed to answer yes to "if the thing this guards were completely broken, would this go red?" Concretely: every phone rule is proven by attempting the violation and requiring refusal, the recent-auth window is proven by manipulating the clock, and the passkey tightening is proven by trying to change a phone behind a magic link. No test in M3 asserts that a control exists. Each asserts that it bites.
