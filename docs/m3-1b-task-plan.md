# M3 Task 3.1b, The Recovery Path
## Drafted for Guy's approval, 17 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §1, docs/m3-1-task-plan.md §1, docs/m3-2-task-plan.md §3.

---

## 0. Two constraints, confirmed rather than assumed, and the collision they create

The 3.1 plan said the plugin's behaviour would be confirmed empirically before building. It no longer needs a spike, because shipping code and a passing test already settle both halves.

**Better Auth's magic link DOES sign a user in on verification.** `confirmSignIn()` takes its session cookie straight off the response from `/api/auth/magic-link/verify`. That is the entire mechanism 3.2a is built on, running in production right now. So recovery cannot use the stock magic-link plugin: clicking the emailed link would create a session and the phone OTP would become a formality after the fact. Single-factor recovery is exactly what §1 forbids.

**Passkey registration REQUIRES a session.** 3.1a proves it by attempting the forbidden thing: `REFUSES registration with no session at all` passes because the plugin refuses.

### The collision, and the ruling I need

§1 says the member registers a passkey and **"only now does a session exist"**. Registration requires a session. Those cannot both be satisfied through the plugin's endpoint.

Two ways out. This is the one decision in this plan I will not make alone, because it moves a security boundary:

**Option A, recommended.** Recovery verifies the attestation itself, with `@simplewebauthn/server` (the same library the plugin uses, called the same way), and writes the credential. A session is issued only after the row exists. Ordering is preserved exactly as §1 states it, and the grant remains the only authority in play. Cost: one registration path that is ours rather than the plugin's, which must be kept in step with the plugin's storage shape. The 3.1a suite already covers the plugin's path, so drift would show as a passkey that registers through recovery but fails to authenticate, and there is a test for precisely that.

**Option B.** The grant is exchanged for a narrowly scoped session that can only register a passkey. Simpler, uses the plugin unchanged. Cost: a session exists before any credential does, which is the sentence §1 was written to prevent. A scope field on that session becomes a control that has to be checked everywhere a session is accepted, and "everywhere" is the word that makes it fragile.

I recommend A. B trades a one-time implementation cost for a permanent invariant that every future endpoint has to honour, and this week has been a catalogue of what happens to invariants that depend on remembering.

---

## 1. The path, built as a path

**Magic link AND phone OTP. Both required, neither sufficient. It ends in a registered passkey or it is not recovery.**

1. The member requests recovery with their email. No credential is presented; that is the point.
2. A recovery link goes to the verified email. **Clicking it signs nobody in.** It marks one half met.
3. An OTP goes to the verified phone through Twilio Verify. Approving it marks the other half.
4. Only when **both** halves are met does a grant exist. Short-lived, and it authorises **exactly one action**.
5. The member registers a passkey. The grant is consumed by that registration. Only now does a session exist.

### The test, as ruled: from every credential removed

One end-to-end test that starts with **passkeys deleted and sessions deleted**, leaving nothing but a user row with a verified email and a verified phone. It runs the whole path and ends by asserting a **newly registered passkey exists and authenticates**.

That last clause is new, and 3.1a is what makes it possible. Until now the end of the path could only be asserted as "a row appeared". Now the recovered credential can be made to sign in, which is the only assertion that proves recovery actually recovered anything. **Recovery that leaves someone still without a working credential is not recovery**, and a row that cannot authenticate is exactly that.

### Twilio, and why 3.1b is not blocked on it

The OTP sender is an interface with a recording fake, the same shape as `EmailSender`. Twilio Verify sits behind it in production. This is the pattern that let 3.2a go green before the Postmark token was pasted, and it is why the account being on a trial with caller-ID restrictions does not block this task.

The decoupling probe already established the property that matters: an approved Twilio verification returns a verdict and **no session-shaped field**. Phone is a security primitive, never a login method.

---

## 2. The cross-account control, and why it is the one that matters

**Magic link for member A plus OTP for member B must fail.**

A naive implementation passes this. It asks "is there a met email half?" and "is there a met phone half?" and finds both true. That is two unrelated checks wearing the costume of two factors, and it means an attacker who controls any inbox plus any phone recovers any account.

So the halves are not booleans. **Both are marked against one challenge row belonging to one member**, and the grant is issued from that row or not at all. There is no query anywhere in this task that asks whether a half is met without asking whose.

Proven by attempting it: open a challenge for A, meet its email half; open a challenge for B, meet its phone half; then attempt to obtain a grant for A, and for B. Both must be refused, and no grant row may exist for either.

---

## 3. 3.2c's second pass, closed in the same work

Recovery brings the third token kind into existence, so the cross-presentation matrix goes from **2x2 to 3x3** here.

- `readRecoveryToken()` is written, with its purpose baked in and no parameter, matching the existing consumers.
- The `recover` purpose is already reserved in `tokens.ts`, so no format is invented.
- The three `it.todo` entries in `token-matrix.test.ts` become real: the recovery consumer accepts a recovery token and refuses the other two kinds.
- The assertion that **no recovery consumer is exported** must be updated in the same commit, by design: it exists to force whoever adds one to come back and fill the column in.
- The `3.2c-second-pass` open item closes only when the matrix is nine real cells. If 3.5 has not landed, the invitation **consumer** column stays owed and the item stays open with its scope narrowed.

---

## 4. Sub-tasks

- **3.1b.1** The recovery tokens and their table, separate from `verification`, with `readRecoveryToken()`.
- **3.1b.2** The two halves, marked against one challenge, and the grant that only exists when both are.
- **3.1b.3** The OTP sender interface, the recording fake, and Twilio Verify behind it.
- **3.1b.4** Passkey registration from a grant, per the ruling in §0.
- **3.1b.5** The end-to-end path test from every credential removed, ending in a passkey that authenticates.
- **3.1b.6** The 3x3 matrix.

---

## 5. The controls, each attempting the forbidden thing

| Attempt | Required result |
|---|---|
| Magic link alone, then register a passkey | refused, and **no session exists** |
| Phone OTP alone, then register a passkey | refused, and no session exists |
| **Magic link for A plus OTP for B** | refused, and no grant exists for either |
| Both halves met, grant used twice | second use refused |
| Both halves met, grant expired, then used | refused |
| Grant used for anything other than registering a passkey | refused |
| A recovery token presented to the sign-in endpoint | refused **on purpose**, not by absence |
| A sign-in token presented to the recovery consumer | refused on purpose |
| Recovery completed, then the new passkey used to sign in | **succeeds**, or the path recovered nothing |

The last row is the success case that stops the rest being a system that refuses everything.

---

## 6. What this closes

- The recovery half of §1, and the `lost every device` path as a path.
- 3.2c's recovery column, and the `3.2c-second-pass` open item if 3.5 has landed.
- The last piece of M3 before 3.3 (phone rules), 3.4 (recent auth), 3.5 (invitations) and 3.6.

## 7. The verification test, applied

Every control above attempts the forbidden operation. The cross-account case is the one this plan is built around, because it is the only one that distinguishes two factors from two unrelated checks, and it is the one a passing implementation is most likely to get wrong quietly.
