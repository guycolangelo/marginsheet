-- Reverses 0021_rule_one_fully_enforced.sql.
-- Documentation only. The recent-auth window is application code and its tests
-- are unaffected; what is lost is the record that rule 1 is now whole.
COMMENT ON COLUMN "members"."phone" IS NULL;
