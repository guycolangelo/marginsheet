-- =========================================================================
-- 0016_network_identity_asymmetry: record what 0012 actually protects.
--
-- WHY THIS IS A MIGRATION AND NOT AN EDIT TO 0012's HEADER.
--
-- Guy asked for this asymmetry to be written into the migration header and
-- the custody doc. 0012 is merged, and CLAUDE.md now says migrations are
-- append-only after merge, enforced by the migrations-append-only CI job. The
-- rule applies to a comment exactly as it applies to a schema change: the file
-- is frozen. So the correction goes forward, which is the rule working rather
-- than the rule being inconvenient.
--
-- MEASURED 16 August 2026, with the 0012 trigger DISABLED, driving a real
-- magic-link sign-in over HTTP carrying a real User-Agent and a real client IP
-- (both x-forwarded-for and cf-connecting-ip):
--
--   ip_address  ''    no address recorded. advanced.ipAddress.disableIpTracking
--                     is doing its job. Better Auth writes an EMPTY STRING
--                     rather than NULL when getIp returns null.
--   user_agent  the exact header value. Better Auth has NO configuration for
--               user agent and reads the header unconditionally.
--
-- THE ASYMMETRY, stated plainly:
--
--   IP address:  two layers. A config gate (disableIpTracking) AND the trigger.
--   User agent:  ONE layer. The trigger, and nothing else.
--
-- For user agent, migration 0012's trigger is NOT defence in depth. It is the
-- SOLE defence. The thing that would break it is a Better Auth upgrade that
-- changes its insert behaviour for the session row, and nothing in the
-- application would report that; the column would simply start holding data
-- the household never agreed to have kept.
--
-- WHY THE TEST ASSERTS user_agent IS POPULATED. With the trigger enabled both
-- columns are null, so asserting null proves nothing about layer 1: it would
-- pass identically with disableIpTracking deleted. The proof disables the
-- trigger, and then the user_agent assertion is the tripwire. If a change ever
-- stopped the request context reaching the session write, user_agent would go
-- null and the test fails, which is the only way to tell "suppressed" apart
-- from "never arrived". The thing that would hollow out the proof is the thing
-- that trips it. See services/api/test/real-sign-in.test.ts.
-- =========================================================================

COMMENT ON COLUMN "session"."ip_address" IS
  'Never stored. Two layers: advanced.ipAddress.disableIpTracking stops Better Auth collecting it, and the 0012 trigger nulls it on write regardless. Measured 16 Aug 2026 against a real HTTP sign-in with the trigger disabled: no address recorded (Better Auth writes an empty string, not NULL, when getIp returns null). MarginSheet holds no network identity for households; the cost accepted knowingly is no new-device detection, no IP anomaly signals, and weaker forensics on a compromised account.';

COMMENT ON COLUMN "session"."user_agent" IS
  'Never stored, but protected by ONE layer only. Better Auth has NO configuration for user agent and reads the header unconditionally, so the 0012 trigger is the SOLE defence here rather than defence in depth. Measured 16 Aug 2026 with the trigger disabled: the exact header value was written. A Better Auth upgrade that changes its session insert behaviour is what would break this, and nothing in the application would report it. Do not drop the trigger.';
