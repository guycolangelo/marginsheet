-- Reverses 0018_auth_household_resolver.sql.
--
-- Dropping this closes the only path from a session to a household, so every
-- request-scoped read of a policied table stops working. That is the correct
-- direction for a down migration: it removes access rather than widening it.
DROP FUNCTION IF EXISTS public.auth_household_id(text);
