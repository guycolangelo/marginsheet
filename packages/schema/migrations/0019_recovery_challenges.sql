-- =========================================================================
-- 0019_recovery_challenges: the lost-every-device path (M3 task 3.1b).
--
-- THE RULE (identity-onboarding-spec §1): recovery requires a magic link AND
-- a phone OTP. Both required, neither sufficient. It ends in a newly
-- registered passkey, because recovery that leaves someone still without a
-- credential is not recovery.
--
-- WHY A TABLE OF ITS OWN RATHER THAN `verification`.
--
-- Better Auth's magic-link plugin SIGNS A USER IN on verification. That is its
-- entire purpose, and `confirmSignIn()` depends on it in production today. If
-- recovery reused it, clicking the emailed link would create a session and the
-- phone OTP would become a formality after the fact. Single-factor recovery is
-- exactly what §1 forbids, so recovery gets its own token kind, its own store
-- and its own consumers. Two tokens that look similar and mean different
-- things is how "both required" quietly becomes "either will do".
--
-- !!! THE TWO HALVES ARE NOT BOOLEANS. !!!
--
-- Both are marked on THIS ROW, which belongs to exactly one auth user. A
-- naive implementation asks "is there a met email half?" and "is there a met
-- phone half?", finds both true, and issues a grant: that is two unrelated
-- checks wearing the costume of two factors, and it means whoever controls any
-- inbox plus any phone recovers any account. There is no query in this feature
-- that asks whether a half is met without asking whose.
--
-- WHY NO RLS. Recovery runs before anyone is authenticated and before any
-- household is known: the whole point is that the member has no credential.
-- A policy filtering by the household GUC would make recovery depend on
-- knowing the answer recovery produces. Same reasoning as 0011's Better Auth
-- tables. The control here is that marginsheet_app is the only role with any
-- privilege, and that the writable columns are enumerated below.
--
-- marginsheet_sync gets nothing.
-- =========================================================================

CREATE TABLE recovery_challenges (
  "id"                uuid PRIMARY KEY DEFAULT uuidv7(),

  -- Who is being recovered. IMMUTABLE after insert, enforced by the column
  -- grant below: a caller who could re-point a challenge at another user would
  -- turn one met half into a recovery of somebody else's account.
  "auth_user_id"      text NOT NULL,

  -- The bearer token, carrying its purpose prefix (ms_recover_...). Emailed,
  -- and required by every subsequent step, which is what binds the OTP to
  -- THIS challenge rather than to any challenge.
  "token"             text NOT NULL UNIQUE,

  -- The two halves. NULL means not met. Neither alone is a grant.
  "email_half_met_at" timestamptz,
  "phone_half_met_at" timestamptz,

  -- Consumed by registering a passkey, and by nothing else.
  "spent_at"          timestamptz,

  -- IMMUTABLE after insert, same reasoning as auth_user_id: a caller who could
  -- push this forward would hold an unexpiring recovery.
  "expires_at"        timestamptz NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "recovery_challenges_user_idx"
  ON recovery_challenges ("auth_user_id", "created_at" DESC);

COMMENT ON TABLE recovery_challenges IS
  'One row per recovery attempt, belonging to exactly one auth user. Both halves of the §1 challenge are marked HERE, so a grant can only be assembled from halves that belong together. Asking whether a half is met without asking whose is what turns two factors into two unrelated checks, and lets whoever controls any inbox plus any phone recover any account.';

COMMENT ON COLUMN recovery_challenges."auth_user_id" IS
  'Immutable after insert by column grant. Re-pointing a challenge at another user would convert one met half into a recovery of somebody else account.';

COMMENT ON COLUMN recovery_challenges."expires_at" IS
  'Immutable after insert by column grant. A caller able to move this holds a recovery that never expires.';

-- Privileges. UPDATE is enumerated to the three columns that legitimately
-- change, and withholds the two that must not. Enumerating rather than
-- granting all-minus-some means a column added later is not silently writable:
-- the same posture as the Plaid token grant in 0002, account.password in 0011,
-- and auth_send_attempts in 0017.
GRANT SELECT, INSERT, DELETE ON TABLE recovery_challenges TO marginsheet_app;
GRANT UPDATE ("email_half_met_at", "phone_half_met_at", "spent_at")
  ON TABLE recovery_challenges TO marginsheet_app;
