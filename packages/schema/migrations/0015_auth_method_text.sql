-- =========================================================================
-- 0015_auth_method_text: session.auth_method becomes text with a CHECK.
--
-- WHY THIS IS A NEW MIGRATION AND NOT AN EDIT TO 0014.
--
-- 0014 shipped session.auth_method as a Postgres ENUM. That is wrong: Better
-- Auth's generated Drizzle schema declares the column as `text` and binds a
-- text parameter, which an enum column rejects at insert time. CI caught it
-- in the adapter round trip:
--
--   BetterAuthError: The field "auth_method" does not exist in the "session"
--   Drizzle schema.
--
-- The first instinct was to edit 0014 in place. That failed, and the way it
-- failed is worth recording: CI reuses the ephemeral per-PR Neon branch across
-- runs, so its ledger already marked 0014 applied and the corrected SQL never
-- ran. The introspection step then tested a schema built by the OLD 0014 while
-- the repository contained the new one, and reported a missing constraint that
-- the file plainly declared.
--
-- The deeper reason is the one that matters beyond this PR: 0014 is merged to
-- main. Any environment that has applied it will never apply it again, so an
-- edit reaches only databases that have not seen it yet. Editing an applied
-- migration produces two databases with the same ledger and different schemas,
-- which is indistinguishable from correct until something reads the column.
-- Migrations are append-only after merge. Corrections go forward.
--
-- WHY TEXT WINS OVER THE HOUSE STYLE: the same reasoning already recorded in
-- 0011. A schema that disagrees with its adapter is a runtime failure wearing
-- a house style. The CHECK constraint does the constraining work the enum
-- would have done, and admits exactly two values so a third credential class
-- cannot appear without somebody writing a rule for it.
-- =========================================================================

ALTER TABLE "session" DROP COLUMN IF EXISTS "auth_method";
DROP TYPE IF EXISTS auth_method;

ALTER TABLE "session" ADD COLUMN "auth_method" text
  CONSTRAINT session_auth_method_known CHECK ("auth_method" IN ('passkey', 'magic_link'));

COMMENT ON COLUMN "session"."auth_method" IS
  'Which credential class established this session. SERVER-WRITTEN ONLY, from what the server itself verified at sign-in: never from a request body, header, cookie, or any other client-supplied field. A client-supplied value would make the §1 phone-change tightening ADVISORY, because an attacker holding a magic-link session would simply claim passkey and authorise their own phone change; the guard and its tests would still pass while enforcing nothing. NULL means a session predating this column and is treated as the WEAKEST class, never the strongest. Text rather than an enum because Better Auth binds a text parameter here; the CHECK constraint does the constraining.';

GRANT SELECT ("auth_method"), INSERT ("auth_method"), UPDATE ("auth_method")
  ON TABLE "session" TO marginsheet_app;
