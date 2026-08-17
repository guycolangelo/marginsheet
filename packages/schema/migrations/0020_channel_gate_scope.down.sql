-- Reverses 0020_channel_gate_scope.sql.
--
-- This removes DOCUMENTATION, not protection. The gate itself is application
-- code and the tests that attempt its violation are unaffected. What is lost by
-- reverting is the money-versus-access ruling, which is the part somebody would
-- otherwise re-litigate from 0001's literal wording.
COMMENT ON COLUMN "members"."phone_verified_at" IS NULL;
COMMENT ON COLUMN "members"."phone" IS NULL;
