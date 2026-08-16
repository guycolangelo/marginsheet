-- Reverses 0012_no_network_identity.sql.
-- Reversing this lets the session table begin storing IP and user agent
-- again, which is a doctrine change and not a schema change. Do not run it to
-- fix a test.
DROP TRIGGER IF EXISTS session_no_network_identity ON "session";
DROP FUNCTION IF EXISTS strip_network_identity();
