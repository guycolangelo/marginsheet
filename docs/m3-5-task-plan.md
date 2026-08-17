# M3 Task 3.5, Member Invitations
## Drafted for Guy's approval, 17 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §7, conversation-service-spec (no secrets between principals), migration 0001's `invitations` table.

---

## 0. What invitations touch that nothing else has

**A second member in one household.** Every test in M3 so far has had exactly one member per household, and that is not a detail.

`household_isolation` filters on `household_id`. Two members of the same household **should** see each other's rows; members of different households should not. Only the second half has ever been tested, because until now no household had two members. **If the policy were accidentally per-member rather than per-household, every isolation test written so far would still pass.**

So 3.5 is the first task that can prove the household is the unit. That assertion goes in this pass:

| Attempt | Required result |
|---|---|
| Member A reads member B's row, same household | **succeeds.** The household is the unit, and this has never been asserted |
| Member A reads a member's row in another household | refused, as already tested |
| The invitee's first authenticated read | resolves through `auth_household_id()` and lands in the right household |

That third one is the resolver's first use by somebody who was not present when the household was created, which is the case it was written for and has never served.

**Downstream, and out of scope here:** a two-member household is also the first time question routing, closure receipts and per-member preferences have anything to route *between*. None of that is built. What 3.5 owes them is the data shape and the proof that two members coexist correctly under RLS, so M13 inherits a fact rather than an assumption.

---

## 1. The invitee path, as a path

§7: *"Primary adds a member: name + phone (+ optional email) → invitation with unguessable token, 14-day expiry. Invitee path: link → passkey/magic-link identity → phone OTP → joined as `full_member`."*

1. The primary creates an invitation. Name and phone required, email optional.
2. The invitation is delivered. Token is `ms_invite_<64 hex>`, 14-day expiry.
3. The invitee opens the link. **It spends nothing**, same ruling as the sign-in and recovery links: a scanner must not consume an invitation.
4. The invitee establishes identity, by passkey or magic link. Both paths tested.
5. The invitee verifies their phone by OTP, through 3.3's flow, so rule 2 and rule 3 apply unchanged.
6. They are joined as `full_member`, and the invitation is marked accepted.

### The end-to-end test, as ruled

One test from **the invitation email** through to a member who **can sign in and be reached on a verified phone**. Not "a member row exists": the same standard as recovery, where a passkey row that cannot authenticate is not a recovery. A member who cannot sign in has not joined, and a member whose phone is unverified cannot be reached by anything MyKeeper sends, which makes them a member in name only.

So the closing assertions are: they sign in, `mayReachMember()` returns true, and both members of the household see each other.

---

## 2. The no-secrets statement, before joining

§7: *"No secrets between principals is stated in the invite email, before joining, not after."* The conversation spec gives the substance: *"Nothing a member tells the brains is confidential from the other full members."*

**Before joining is the whole requirement.** Someone deciding whether to join a household's financial life needs to know that what they tell MyKeeper is visible to the other members, at the moment they are deciding, not once they are in.

Testable, and tested the way journey tests are: the assertion reads **the delivered email body** and requires the statement present. Not a unit test on a template function, which would pass with the template unwired.

The test asserts the substance rather than an exact sentence, so copy can be improved without breaking it, and fails if the meaning goes missing.

---

## 3. The last token kind, and the matrix closing for real

Invitations mint `ms_invite_` tokens for the first time. `readInvitationToken()` has existed since 3.2c's first pass with no issuer, which is precisely the narrowing recorded on the open item.

This pass closes it:

- The **issuer** exists: invitations are minted through `mintToken(TOKEN_PURPOSES.invitation)`.
- The **consumer** has a route: the redemption endpoint.
- The matrix is nine real cells with a real endpoint behind each consumer, and the `3.2c-second-pass` open item **closes rather than narrowing again.**

### The CHECK constraint, owed since 16 August

`invitations.token` has no constraint requiring the prefix, so domain separation is advisory for this kind: an issuer could write an unprefixed token and every existing test would pass. On the open items list with 3.5 as owner.

A new migration adds `CHECK (token LIKE 'ms_invite_%')`, and the test attempts to insert an unprefixed token and requires refusal. That makes the format structural for the one kind whose rows we write ourselves. Sign-in tokens live in Better Auth's `verification` and recovery tokens in our own table with the same opportunity, which is worth noting as a follow-up rather than doing here.

---

## 4. Delivery, and the constraint that shapes it

§7: *"Until A2P clears, the invitation SMS rides the transactional path; the brains' messages wait for their own numbers. If both are blocked, invitations fall back to email, degraded, documented, temporary."*

Both are blocked today: A2P is unsubmitted and the Twilio account is on trial. **So invitations ship email-first, and that is the documented degraded path rather than a design choice.** The plan records it as temporary with the SMS path built behind the same sender interface, so the switch is configuration rather than a rewrite.

An invitation to a number Twilio refuses must produce the honest refusal 3.3 built, not a silent failure. The invitation is not created if it cannot be delivered, because an invitation nobody receives is a row that makes a household think they invited somebody.

---

## 5. Who may invite, and one question for you

The primary adds members. `members.is_primary` exists and nothing reads it yet, which makes this its first enforcement.

**The question:** §1 lists four sensitive actions requiring recent-auth, and **member removal is one while member addition is not.** Adding a member grants a stranger access to the household's entire financial life, which is at least as consequential as removing one. I can see the argument both ways: addition is invited and expected, removal is adversarial and often contested.

I have not added it to `SENSITIVE_ACTIONS`, because the spec is explicit and I do not think a plan should quietly extend it. If you want invitation creation behind recent-auth, that is a one-line change to the list plus a guard, and the enumeration test will then require it.

---

## 6. The controls, each attempting the violation

| Attempt | Required result |
|---|---|
| Redeem an invitation twice | second refused, one member row exists |
| Redeem an expired invitation (clock moved) | refused |
| Redeem an invitation for a household while acting in another | refused |
| Present an invitation token to the **sign-in** endpoint | refused **on purpose**, not by absence |
| Present a sign-in or recovery token to the redemption endpoint | refused on purpose |
| Insert an unprefixed token into `invitations` | refused by the CHECK constraint |
| A non-primary member creates an invitation | refused |
| Invite a phone already **verified** by another member | refused with support routing, per rule 2 |
| Join without verifying the phone | the member exists but `mayReachMember()` is false, so nothing about their money reaches them |
| Two members, same household, read each other | **succeeds.** The assertion nothing has made |

---

## 7. Sub-tasks

- **3.5.1** Invitation creation: primary only, token minted with its purpose, 14-day expiry, delivery-or-nothing.
- **3.5.2** The migration adding the `ms_invite_` CHECK constraint.
- **3.5.3** The invitation email, carrying the no-secrets statement, and the link that spends nothing.
- **3.5.4** Redemption: identity by either path, phone OTP, joined as `full_member`.
- **3.5.5** The end-to-end path test, ending in sign-in and a reachable member.
- **3.5.6** The two-member RLS assertions, and the 3x3 matrix closed with real endpoints.

## 8. The verification test, applied

The two-member assertion is the one to judge this by. Every other control here fails when the code is wrong. That one fails when an assumption nobody stated has been wrong since M1, and it is only checkable now because 3.5 is what finally creates a household with two people in it.
