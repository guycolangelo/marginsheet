-- Reverses 0017_auth_send_attempts.sql.
--
-- Dropping this table removes the per-email limit and the global send ceiling
-- along with it: the limiter counts rows here and has nowhere else to count.
-- A deploy that runs this down and leaves the send endpoint mounted is an
-- unlimited send endpoint, not a smaller one.
DROP TABLE IF EXISTS auth_send_attempts;
