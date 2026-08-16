-- Reverses 0016_network_identity_asymmetry.sql.
-- This removes documentation, not protection: the 0012 trigger is untouched.
COMMENT ON COLUMN "session"."ip_address" IS NULL;
COMMENT ON COLUMN "session"."user_agent" IS NULL;
