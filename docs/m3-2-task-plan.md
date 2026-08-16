# M3 Task 3.2, Magic Link and Token Discipline
## Drafted for Guy's approval, 15 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §§1 and 7, docs/m3-task-plan.md.

---

## Scope

Magic-link sign-in, the credential-class guard behind the §1 tightening, token separation across the three token kinds, and the two proofs that were resequenced into this task: the layer 1 network-identity proof and the real session that unblocks the passkey harness.

**Out:** passkey registration and login (3.1a, immediately after this), the recovery path (3.1b), the three phone rules (3.3), invitations themselves (3.5). This task builds the token *discipline* invitations will live under, not the invitation flow.

---

## 1. Three jobs, and how they stay separable

Magic link becomes load-bearing for three unrelated things: ordinary sign-in, the signed session the passkey harness needs, and the real request context the layer 1 proof needs. The risk is that a later change to sign-in silently guts one of the other two.

The word that matters is **silently**. These cannot be made independent, since two of them exist precisely because sign-in produces a real session. They can be made **loud**.

### The shared seam, stated as a contract

One helper, `realSignIn()`, is the single place any test obtains a product-issued session. Its contract:

1. It drives a real HTTP request through the auth handler.
2. It returns the cookie **taken from a `Set-Cookie` response header**, never constructed.
3. It never touches `internalAdapter`.

A contract test asserts all three on the helper itself: that a `Set-Cookie` header was actually present, that the cookie validates through `getSession`, and that a session row exists. If a future change to sign-in makes the helper fall back to minting sessions directly, that test fails and names it. One seam, verified, rather than three tests quietly depending on an assumption.

### The tripwire that makes the layer 1 proof self-checking

This is the part worth reading closely. The layer 1 proof disables the 0012 trigger and asserts `ip_address` is null, which is `disableIpTracking` working. But a null could also mean **no request context reached the session write at all**, in which case the proof would pass while proving nothing, which is the failure shape of this entire build.

The same test already asserts `user_agent` is **populated**, because Better Auth has no config gate for it. That assertion is doing double duty:

- it documents the asymmetry (IP has a config gate and a trigger; user agent has only the trigger), and
- **it is the tripwire.** If a later change stopped headers reaching the session write, `user_agent` would go null and the test would fail. The IP assertion could never distinguish "suppressed" from "absent"; the user agent assertion can, and it fails loudly in exactly the case that would hollow out the IP assertion.

So the layer 1 proof cannot silently degrade into a tautology. The thing that would break it is the thing that trips it.

### The passkey harness

3.1a consumes `realSignIn()` and nothing else from this task. If sign-in changes, the harness breaks at the seam with a named contract failure rather than producing sessions the product never issues, which is the whole reason for the resequence.

---

## 2. The §1 tightening

**The rule:** a phone change requires a passkey when the member has one registered. A magic link is accepted only when no passkey exists.

### What has to exist first

A session must know which credential class established it. Better Auth's session does not record that. So the session gains an `auth_method` field (`passkey` or `magic_link`), written by the server at sign-in and never accepted from a client. Migration 0014, and the column is server-authoritative or the whole control is advisory.

### The three cases, because two would be a trap

| Member state | Session established by | Phone change |
|---|---|---|
| has a passkey | magic link | **refused** |
| has a passkey | passkey | **succeeds** |
| **no passkey** | magic link | **succeeds** |

You asked for the first two: the refusal is the control, the success proves it is not blocking everything. The third is the one I want to add, because without it "refuse magic-link phone changes" passes both of your cases while **locking out every member who has no passkey**, which §1 explicitly does not do. That member is the weaker path by construction, not an excluded one.

### A scope boundary I need ruled

The phone-change *mechanics* are 3.3 (uniqueness, no channel write path, verification). The *authorization* is this task. My proposal: 3.2 ships the credential-class guard and a minimal phone-change endpoint to attach it to, so the test exercises a real endpoint rather than a stand-in, and 3.3 adds the three rules around it. The alternative is a stand-in sensitive action here, which tests the guard against something the product does not have.

---

## 3. Token discipline

Three token kinds, three different powers:

| Token | Power | Lifetime |
|---|---|---|
| sign-in magic link | creates a session | short |
| recovery token | one half of a recovery challenge, creates nothing alone | short |
| invitation | joins a household as `full_member` | 14 days (ported, §7) |

An invitation token accepted by the sign-in endpoint would hand a household session to whoever holds an invite. That is the failure this section exists to prevent.

### Kept distinct three ways, because one way is a convention

1. **Separate storage.** Invitations already live in their own table from M1. Recovery gets its own table in 3.1b rather than sharing Better Auth's `verification`. Sign-in links stay in `verification`, owned by the plugin. Three tables, so a lookup for one kind cannot find another.
2. **Domain-separated values.** Each kind carries a purpose prefix, and every validator rejects a wrong prefix **before** any lookup. This makes cross-presentation fail fast and makes it visible rather than a silent miss.
3. **Separate consumers.** No shared "validate token" function. A function that takes a token and a purpose is one refactor away from taking a token.

### The proof: a full cross-presentation matrix

Every token kind presented to every consumer. Three diagonal cells must succeed; **six off-diagonal cells must be refused.** A test that only checked the diagonal would pass on a system where any token opened any door.

I will also assert the refusals are refusals and not accidents: an invitation token rejected by sign-in must be rejected on **purpose**, not merely absent from `verification`. Storage separation alone would produce a passing test for the wrong reason, which is the same trap as the column-privilege no-op.

---

## 4. Single use, expiry, and the double click

### Single use and expiry

A sign-in link is consumed on first successful use and refused thereafter. Proposed lifetimes, for your ruling: **sign-in 15 minutes**, recovery halves 10 minutes, invitations 14 days (already ported). Expiry is asserted by clock manipulation, not by reading config.

### The double click, which is really the email-scanner problem

A link clicked twice is the visible half. The dangerous half is that **corporate email security scanners follow links before the human does**, and a GET-consumed single-use token is burned by the scanner. The member then clicks a dead link and cannot sign in, and it looks like our bug because it is.

**Proposal:** the emailed link performs no consumption. It opens a page; an explicit action on that page consumes the token. Scanners issue GETs and do not press buttons, so the token survives them.

That also makes the double click harmless:

| Situation | Behaviour |
|---|---|
| link opened twice, not yet consumed | both show the page; whichever action fires first consumes it |
| action fired twice quickly | second finds the token consumed **by this same member**, and lands them in their signed-in session rather than an error |
| token consumed, then presented later from elsewhere | refused, with "this link has been used" and an offer to send a new one |
| expired | refused, same shape, never silently reissued |

The third row is the one that must not be softened into the second. A consumed token presented by anyone other than the member who consumed it is refused, always. Convenience for the double click stops exactly where it would become a replay.

This costs one click. I think it is worth it and I want it ruled rather than assumed, because it is a visible change to the sign-in experience.

---

## Sub-tasks

- **3.2a** Magic-link send hook (Postmark), sign-in flow, single use, expiry, the landing-page consumption model.
- **3.2b** `auth_method` on the session (migration 0014, server-authoritative) and the credential-class guard, with the three-case test.
- **3.2c** Token discipline: prefixes, separate consumers, the nine-cell cross-presentation matrix.
- **3.2d** `realSignIn()` and its contract test; the layer 1 HTTP proof with the trigger-disabled measurement and the user-agent tripwire; the asymmetry written into the 0012 migration header and the custody doc as ruled.
- **3.2e** Rate limiting on magic-link sends, per email and per IP, as config rather than constants (M3 owns this per the ruling; the per-phone limits land with OTP in 3.3).

## Rulings needed

1. **The phone-change boundary** (§2 above): minimal endpoint here, or a stand-in.
2. **Lifetimes**: 15 minutes for sign-in, 10 for recovery halves.
3. **The landing-page consumption model**, which costs one click and defeats email scanners.

## The verification test, applied

Every control here attempts the forbidden thing: the guard is proven by a refused phone change and an allowed one, token separation by six refused cross-presentations, single use by a second attempt, expiry by moving the clock. The layer 1 proof carries its own tripwire so it cannot decay into a tautology.
