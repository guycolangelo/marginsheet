-- =========================================================================
-- 0020_channel_gate_scope: what phone_verified_at actually gates (M3 task 3.3).
--
-- APPEND-ONLY. 0001's comment is frozen; this replaces it going forward rather
-- than editing it, per the migrations rule in CLAUDE.md.
--
-- WHY THIS AMENDMENT EXISTS. 0001 said "no channel message of any kind reaches
-- this member: no SMS, no email, no brain intro, no alert, no broadcast". Read
-- literally that gates the sign-in link too, and a member cannot verify a phone
-- without first getting into the product. The spine's own abandonment table
-- contradicts the literal reading: a household who stops after step 1 is
-- recovered by "magic link back in", and phone verification comes later. Under
-- the literal rule, a household who abandons at step 1 could never come back.
--
-- Ruled by Guy, 17 Aug 2026, and written here rather than left to be
-- re-litigated by whoever next reads the original sentence.
--
-- THE DISTINCTION THAT MAKES IT A RULE RATHER THAN AN EXCEPTION:
--
--   GATED mail is about the household's MONEY.
--   UNGATED mail is about the household's ACCESS.
--
-- Everything MyKeeper sends is money, and money waits for a verified phone.
-- Sign-in links, recovery, and the day-12 pre-charge notice are access and
-- billing, which is MarginSheet speaking as itself rather than a brain.
--
-- That framing is what stops this becoming a list of exemptions that grows. A
-- new send path does not ask "is this like a sign-in link", it asks "is this
-- about their money or their access", and the answer decides.
-- =========================================================================

COMMENT ON COLUMN "members"."phone_verified_at" IS
  'THE GATE ON ALL HOUSEHOLD-FACING CHANNEL ACCESS. Null means no message about the household''s MONEY reaches this member: nothing from MyKeeper, no digest, no alert, no statement, no question, no broadcast (identity-onboarding-spec invariant 3). Every such send path checks THIS COLUMN, not the presence of a phone number: a member with an unverified number does have a number, so checking for one passes every functional test while the gate is absent.

It does NOT gate transactional mail about ACCESS: sign-in links, recovery, and the day-12 pre-charge notice. That mail is how a member reaches the state where a phone can be verified at all, and gating it would mean a household who abandons at step 1 can never come back, contradicting the spine''s own recovery path. Amended by 0020 (ruled by Guy, 17 Aug 2026); 0001''s literal wording predates the question being asked.

The line is MONEY versus ACCESS, not a list of exemptions. A new send path asks which of the two it is, and the answer decides.

Set only by completing Twilio Verify OTP; cleared only by an in-app phone change, which restarts verification and therefore re-closes the gate.';

-- 0001's rule 1 named a recent-auth window as the first half of the
-- no-write-path defence. Recording here that it is KNOWN to be unenforced as
-- of 0020: the credential-class tightening from 3.2b is live, the 10-minute
-- window is not. A tested `withinRecentAuthWindow()` exists from 3.3 and is
-- wired to nothing until 3.4. Tracked in docs/open-items.json with 3.4 as
-- owner, because a control that exists and is not called must not be mistaken
-- for a control that is enforced.
COMMENT ON COLUMN "members"."phone" IS
  'A security primitive, never a login method (identity-onboarding-spec §1). Three rules keep the SIM-swap surface small, enforced in application code and each proven by a test that ATTEMPTS the violation (3.3).

1. NO WRITE PATH FROM ANY CHANNEL. Phone changes happen in-app only, behind a fresh auth challenge. No SMS, no email, no brain conversation, no support tool may alter this value. There is exactly ONE writer, and a static test enumerates writers and fails on a second. PARTIALLY ENFORCED as of 0020: the credential-class half is live (a passkey is required when the member has one), the 10-minute recent-auth half is a tested function wired by 3.4.

2. ONE VERIFIED PHONE GLOBALLY, enforced by members_verified_phone_unique. A number already VERIFIED by another member in any household is refused with support routing, never silently reassigned. Unverified duplicates are permitted on purpose: two people may begin signup with the same typo, and locking a household out over somebody else''s typo is the failure the partial index avoids.

3. Verification is Twilio Verify OTP. A number Twilio refuses produces an honest message naming the number, never a 500 and never a hang: a refusal the household cannot act on is indistinguishable from a bug.';
