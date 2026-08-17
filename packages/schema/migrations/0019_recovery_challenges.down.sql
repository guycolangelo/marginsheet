-- Reverses 0019_recovery_challenges.sql.
--
-- Dropping this removes the recovery path entirely. A member who has lost
-- every device has no way back in, which is a loss of function rather than a
-- loss of protection, and is the safe direction for a down migration.
DROP TABLE IF EXISTS recovery_challenges;
