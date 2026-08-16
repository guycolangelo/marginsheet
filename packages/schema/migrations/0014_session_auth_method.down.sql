-- Reverses 0014_session_auth_method.sql.
-- Reversing this removes the only signal the §1 phone-change tightening has.
-- Without it every session looks alike and the guard cannot distinguish a
-- passkey session from a magic-link one, so it must fail closed rather than
-- fall back to allowing the change.
ALTER TABLE "session" DROP COLUMN IF EXISTS "auth_method";
DROP TYPE IF EXISTS auth_method;
