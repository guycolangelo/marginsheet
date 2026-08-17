# M3 Task 3.3, The Three Phone Rules
## Drafted for Guy's approval, 17 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §1 and invariant 3, migration 0001's `members.phone` and `members.phone_verified_at` column comments.

---

## 0. Where the rules actually live

The three rules are written verbatim in migration 0001's column comment, which says of itself: *"They are enforced in application code; this comment exists so no one reconstructs the column without them."*

That sentence is the task. A rule enforced in application code that no test attempts to violate is a rule enforced nowhere, and this week has been a catalogue of what that looks like. **Each rule below is proven by attempting the violation, never by reading the enforcement.**

---

## 1. Rule 1: no write path from any channel

> "Phone changes happen in-app only, behind a fresh auth challenge (10-minute recent-auth window). No SMS, no email, no brain conversation, no support tool may alter this value."

### Two halves, and only one is enforced today

3.1a built `POST /auth/phone` and the §1 credential-class tightening. **The recent-auth window is not enforced at all.** Nothing checks session age; a session created 29 days ago satisfies the endpoint exactly as one created a minute ago.

So rule 1 is currently half-enforced, and the half that is missing is the half the comment names first. Recent-auth is 3.4's, which means one of two things, and it is a scope question rather than a technicality:

- **3.3 enforces it**, taking the recent-auth window from 3.4, because a phone change without it is the exact hole the comment describes.
- **3.4 enforces it**, and 3.3 records rule 1 as knowingly half-enforced with an open item, so the gap is tracked rather than assumed closed.

I recommend the second, narrowly: build the *check* here as a function with its own tests, and have 3.4 wire it to every sensitive action rather than only this one. Wiring it to one endpoint now and re-wiring it in 3.4 is two implementations of one control, which is the drift shape from 3.1b.

### The violation attempts

| Attempt | Required result |
|---|---|
| Change a phone with no session | refused, row unchanged |
| Change a phone on a stale session past the recent-auth window | refused **once the check exists**; recorded as owed until then |
| **Static: any module other than the phone-change handler writing `members.phone`** | none exist. The test enumerates writers and fails on a second one |
| A brain-shaped caller (conversation service credentials) attempting the change | refused: `marginsheet_sync` holds no privilege, and the conversation Worker has no route |

The static test is the one that matters for the future. Rule 1 is not "the current endpoint is careful", it is "there is one path". A second writer added in M13 by someone who never read this comment is exactly what it warns about, and only an enumeration catches that.

---

## 2. Rule 2: one verified phone, globally

> "A number already verified by another member in ANY household is rejected at signup with support routing, never silently reassigned; enforced by `members_verified_phone_unique`."

The index exists and works. **What does not exist is the honest failure.** Today a collision surfaces as a unique-violation error from Postgres, which reaches the household as a 500. "Rejected with support routing" is not implemented, and "never silently reassigned" is true only by accident of the index.

### The violation attempts

| Attempt | Required result |
|---|---|
| Verify a number already **verified** by a member in another household | refused, with support routing, and no row changed anywhere |
| Verify a number another member holds **unverified** | **succeeds.** The index permits unverified duplicates on purpose: two people may begin signup with the same typo |
| The refusal is a 500 | fails. The household must see an explanation, not a stack trace's public face |
| A collision silently reassigns the number away from the verified holder | fails, asserted on both members' rows |

The second row is the one that stops this becoming "reject any duplicate", which would lock a household out over somebody else's typo.

---

## 3. Rule 3: `phone_verified_at` is the gate on all channel access

> "Null means no channel message of any kind reaches this member: no SMS, no email, no brain intro, no alert, no broadcast. **Every send path checks this column, not the presence of a phone number.**"

This is the broadest of the three and the one most likely to be violated by accident, because the wrong check is the natural one to write: a send path needs a number, so it checks that a number exists.

### The scope question I need ruled

Taken literally, "no channel message of any kind, no email" would gate the **auth** emails too, and that cannot be right: the spine's own abandonment table says a household who stops after step 1 is recovered by "magic link back in", and phone verification comes later. A member with `phone_verified_at IS NULL` must still be able to receive a sign-in link, or signup cannot complete.

So the boundary I propose, for your ruling:

- **Gated:** every household-facing channel message. Brain messages, intros, alerts, digests, broadcasts, SMS of any kind. Everything M13 onward sends.
- **Not gated:** transactional auth mail about access to the account, which `email.ts` already distinguishes as "MarginSheet speaking as itself about access to an account. It is not a brain and it is not commercial voice."

Recovery needs no exemption: it already requires a **verified** phone, so the gate is satisfied before it sends anything.

If you read the rule as absolute instead, then the spine has to verify the phone before the first email, and that is a change to the signup order rather than a change to a send path. Worth knowing which you mean before anything is built on it.

### How it is enforced, and the static test

One function, `mayReachMember(memberId)`, which reads `phone_verified_at` and nothing else. Every gated send goes through it.

**The static test Guy asked for:** it enumerates the send paths in `src/`, and for each one asserts the gate is consulted. It fails when a module reaches a channel sender without it, and it fails when a module gates on `phone` presence instead of `phone_verified_at`. That second failure is the whole point: checking the wrong column passes every functional test, because a member with an unverified number does have a number.

| Attempt | Required result |
|---|---|
| Send to a member with `phone_verified_at` null | refused, nothing sent, asserted on the recording sender |
| Send after verification | succeeds |
| Send after an in-app phone change, which clears the column | **refused again.** The gate re-closes, and this is the case a naive cache breaks |
| **Static: a send path checking `phone` rather than `phone_verified_at`** | the test names the file and fails |

The third row already works by accident: 3.1a's phone-change endpoint sets `phone_verified_at = null` on change. It has never been asserted, so it is accident rather than control until this task.

---

## 4. The trial caller-ID constraint, and the permanent error path

The Twilio account is on trial, so Verify reaches only numbers on the caller-ID allowlist. **That constraint disappears on upgrade. The error path it exposes does not**, because Twilio refuses numbers for reasons that outlive the trial: a landline, an unreachable carrier, an invalid number, a blocked region, a rate limit.

So this is designed for the failure a real household hits, not for the trial.

### What must not happen

- **A hang.** The send is awaited with a timeout, and a timeout is a refusal with an explanation rather than a request that never returns.
- **A silent success.** The current `twilioVerifySender` throws on a non-ok response, which is right, but nothing above it turns that into something a household can read. An unhandled throw at the route is a 500, which is a silent success from the household's point of view: they were told nothing and nothing happened.

### What must happen

A verification that cannot be sent produces an honest, actionable message naming what to do, and the member's `phone_verified_at` stays null so the gate stays closed. The distinction that matters for copy: *"we cannot text that number"* is about the number, and it invites correcting it. *"something went wrong"* invites nothing.

| Attempt | Required result |
|---|---|
| Verify a number Twilio refuses (the trial's non-allowlisted case) | refused with a message naming the number as the problem; `phone_verified_at` stays null |
| Twilio times out | refused, not hung, with the same shape |
| Twilio returns a 5xx | refused, and distinguishable in logs from a bad number, because those are different fixes |
| The refusal is a 500 or an empty response | fails |
| A refused verification leaves the number looking verified | fails |

**The live test is Guy's**, once against a non-allowlisted number, because only the real account can produce the real error body. The fake sender covers the shape; the live send confirms which error Twilio actually returns, and that is worth knowing before a household finds out. Tracked as an open item, same as the Postmark live send.

---

## 5. Sub-tasks

- **3.3.1** The OTP verification flow: send, check, and `phone_verified_at` set only on approval.
- **3.3.2** Rule 2's collision handling, with support routing rather than a unique-violation error.
- **3.3.3** `mayReachMember()` and the static send-path test.
- **3.3.4** The Twilio refusal path, with the honest message and no hang.
- **3.3.5** The recent-auth check as a tested function, wired by 3.4 (per §1's recommendation).

---

## 6. What this closes

- The three phone rules, each attempted rather than read.
- The `twilio-trial-caller-id` open item, in the sense of being designed for and tested against; the live confirmation stays Guy's.
- `recovery-twilio-credentials`: once credentials exist, recovery stops failing closed and becomes usable.

## 7. The verification test, applied

Rule 3's static test is the one to judge this task by. The other controls fail when the code is wrong; that one fails when the code is **plausible and wrong**, which is the only kind that ships.
