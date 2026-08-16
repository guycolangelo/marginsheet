# M3 Task 3.1, Passkeys and Recovery
## Drafted for Guy's approval, 15 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §1, docs/m3-task-plan.md.

---

## Scope

Passkey registration and login, the lost-every-device recovery path, the HTTP endpoints that expose them (ruling 3), and the layer 1 proof for the network-identity ruling.

**Out:** magic link as a general sign-in method (3.2, though recovery uses one here), phone verification and the three phone rules (3.3), recent-auth re-challenge (3.4), invitations (3.5). Screens are M8 throughout.

**Rate limiting**, ruled M3-owned, attaches to the recovery endpoints here because they send email and SMS the moment they exist. The per-phone, per-member, per-IP config lands with the OTP work in 3.3; 3.1 ships the recovery endpoints behind the same limiter rather than unthrottled.

---

## 1. Recovery built as a path, not two features

The requirement: **magic link AND phone OTP, both required, neither sufficient, ending in a newly registered passkey.** Recovery that leaves someone still without a credential is not recovery.

### The path

1. Member requests recovery with their email. No credential is presented; that is the point.
2. Magic link goes to the verified email. Clicking it **does not sign anyone in.** It marks one half of a recovery challenge as met.
3. Phone OTP goes through Twilio Verify. Approving it marks the other half.
4. Only when **both** halves are met does a recovery grant exist. It is short-lived and authorises **exactly one action**: registering a passkey.
5. The member registers a new passkey. Now they hold a credential, and only now does a session exist.

The grant is consumed by that registration. It cannot be replayed, and it cannot be spent on anything else.

### The problem I have to solve first, stated plainly

**Better Auth's magic-link plugin signs a user in on verification.** That is its entire purpose, and it is directly incompatible with step 2. If recovery used the stock plugin, clicking the email link would create a session, and the phone OTP would become a formality after the fact rather than a required factor. Single-factor recovery is exactly what the ruling forbids.

So recovery does **not** reuse the sign-in magic link. It gets its own token type, its own verification row, and its own endpoints, and the stock magic-link plugin stays scoped to 3.2's ordinary sign-in. Two tokens that look similar and mean different things is how a "both required" rule quietly becomes "either will do."

I will confirm the plugin's behaviour empirically before building, the same way 3.0 opened with a spike, rather than designing around what I believe it does.

### The test, as you specified it

One end-to-end test that runs the path **with every credential removed**: passkeys deleted, sessions deleted, nothing left but a user row with a verified email and phone. It ends by asserting a **newly registered passkey exists and authenticates**. Anything less would be a test of two features that exist rather than a path that works.

Around it, the controls that make it worth something. Each attempts the forbidden thing:

| Attempt | Required result |
|---|---|
| Magic link alone, then try to register a passkey | refused, and no session exists |
| Phone OTP alone, then try to register a passkey | refused, and no session exists |
| Both halves met, then the grant used twice | second use refused |
| Both halves met, grant expired, then used | refused |
| Grant used to do anything other than register a passkey | refused |
| Magic link for account A plus OTP for account B | refused, halves must belong to one member |

That last one is the failure mode I would most expect to survive a naive implementation.

---

## 2. The HTTP sign-in proof for layer 1

**The subtlety that changes the test.** The trigger from 0012 nulls `ip_address` and `user_agent` on every write. So a test that signs in over HTTP and asserts both columns are null **proves nothing about layer 1**. It would pass identically with `disableIpTracking` removed, because the trigger would clean up regardless. That is the same shape as the column-revoke experiment that passed while the control was never applied.

**To prove layer 1, layer 2 has to come off.** So:

1. On the ephemeral CI branch only, `ALTER TABLE "session" DISABLE TRIGGER session_no_network_identity`.
2. Drive a real sign-in through the auth handler with a real `User-Agent` header and a real client IP header.
3. Assert what actually landed.
4. Re-enable the trigger and assert the normal path stores neither.

### What I expect that test to show, including the uncomfortable half

With the trigger disabled:

- `ip_address` **null**, because `disableIpTracking` makes `getIp` return null. That is layer 1 doing its job, proven on the path that has a request context.
- `user_agent` **populated**, because Better Auth has no configuration for it and reads the header unconditionally. I verified this in the 3.0 source read.

So the honest conclusion the test will encode: **layer 1 covers the IP only. For user agent, the trigger is not defence in depth, it is the only defence.** I would rather that be an asserted, documented fact than an assumption that the two columns are protected the same way.

The trigger stays enabled everywhere except inside that one test, and the test restores it before finishing.

### On "a real request"

`getIp` reads exclusively from request headers, so a `Request` carrying those headers exercises the identical code path a socket-delivered request would. The test drives the auth handler with a real `Request` rather than standing up a server, and the assertion is on the database row rather than the response.

One thing to note: Better Auth's default IP header is `x-forwarded-for`, and Cloudflare supplies `CF-Connecting-IP`. With tracking disabled this is moot, but if the ruling is ever revisited, that mismatch would make the IP look absent for the wrong reason. The test sends both headers so it cannot pass by that accident.

---

## 3. Passkeys, and the thing that could make this task longer

Registration and login via `@better-auth/passkey`, plus listing and revoking a member's passkeys (needed by recovery, and by the 3.2 tightening that requires a passkey for phone changes).

**The risk:** WebAuthn assertions are produced by an authenticator, which is hardware or a browser. Testing registration and login in CI needs a **software authenticator** that can generate real attestation and assertion objects, not a mock of our own code. If that proves harder than expected I will bring you the finding rather than substituting a mock that tests nothing, since a passkey test that stubs the authenticator asserts only that our own function was called.

---

## Sub-tasks

- **3.1a** Passkey registration, login, list, revoke, with a software authenticator in CI.
- **3.1b** The recovery path: recovery-specific tokens, both halves, the single-purpose grant, the end-to-end test with every credential removed, and the six controls above.
- **3.1c** The layer 1 HTTP proof, including the trigger-disabled measurement and its documented asymmetry.
- **3.1d** Endpoints wired into the Worker, behind the rate limiter, with `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` provisioned per environment.

## The verification test, applied

Every control here is designed to answer yes to "if the thing this guards were completely broken, would this go red?" The recovery controls attempt the forbidden thing. The layer 1 proof removes the layer that would mask it. The passkey tests use a real authenticator or they do not ship.
