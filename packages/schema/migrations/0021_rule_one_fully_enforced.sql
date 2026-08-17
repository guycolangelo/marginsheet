-- =========================================================================
-- 0021_rule_one_fully_enforced: rule 1 is no longer half a rule (M3 task 3.4).
--
-- APPEND-ONLY. 0020's comment said "PARTIALLY ENFORCED as of 0020: the
-- credential-class half is live, the 10-minute recent-auth half is a tested
-- function wired by 3.4." 3.4 wired it, so that sentence is now false and is
-- corrected forward rather than edited.
--
-- Recording the shape of the gap, because it is the second time this week the
-- same one appeared: `withinRecentAuthWindow()` was correct, tested, and had no
-- caller. So was `mayChangePhone()` for 2 days before it. A control that exists
-- and is not called cannot go red however broken it is, and both were found by
-- trying to use them rather than by reading them.
--
-- What now stops the third instance is not vigilance. It is
-- services/api/src/sensitive-actions.ts, which enumerates all four actions §1
-- names, and a test that checks BOTH directions: no sensitive route outside the
-- list, and every entry marked built is REACHABLE by a real fetch. The second
-- direction is the one that catches "decides correctly, nobody calls it".
-- =========================================================================

COMMENT ON COLUMN "members"."phone" IS
  'A security primitive, never a login method (identity-onboarding-spec §1). Three rules keep the SIM-swap surface small, enforced in application code and each proven by a test that ATTEMPTS the violation.

1. NO WRITE PATH FROM ANY CHANNEL. Phone changes happen in-app only, behind a fresh auth challenge. No SMS, no email, no brain conversation, no support tool may alter this value. There is exactly ONE writer, and a static test enumerates writers and fails on a second. FULLY ENFORCED as of 0021: the credential-class half (a passkey is required when the member has one) since 3.2b, and the 10-minute recent-auth window since 3.4. The window is proven against a 29-day-old session that Better Auth has rolling-refreshed, because a refresh that reset the authentication time would make the window decorative.

2. ONE VERIFIED PHONE GLOBALLY, enforced by members_verified_phone_unique. A number already VERIFIED by another member in any household is refused with support routing, never silently reassigned. The refusal arrives at CONFIRM rather than at send, because this table is household-scoped and a pre-check cannot see another household row: the CONSTRAINT enforces the rule and the application translates the violation into an honest message. Ruled acceptable 17 Aug 2026 rather than widening the RLS boundary for it. Unverified duplicates are permitted on purpose: two people may begin signup with the same typo.

3. Verification is Twilio Verify OTP. A number Twilio refuses produces an honest message naming the number, never a 500 and never a hang: a refusal the household cannot act on is indistinguishable from a bug.';
