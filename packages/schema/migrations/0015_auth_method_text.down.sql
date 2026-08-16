-- Reverses 0015_auth_method_text.sql, returning the column to 0014's enum
-- form. Note that doing so re-breaks Better Auth's inserts: the adapter binds
-- a text parameter and an enum column rejects it. This down exists so the
-- migration is replayable, not because reverting is a sensible thing to do.
ALTER TABLE "session" DROP COLUMN IF EXISTS "auth_method";
CREATE TYPE auth_method AS ENUM ('passkey', 'magic_link');
ALTER TABLE "session" ADD COLUMN "auth_method" auth_method;
GRANT SELECT ("auth_method"), INSERT ("auth_method"), UPDATE ("auth_method")
  ON TABLE "session" TO marginsheet_app;
