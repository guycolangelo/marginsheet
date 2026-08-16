-- Reverses 0011_better_auth.sql.
-- Order matters: passkey, session and account all reference "user".
DROP TABLE IF EXISTS "passkey";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "user";
