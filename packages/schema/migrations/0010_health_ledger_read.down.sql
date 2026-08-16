-- Reverses 0010_health_ledger_read.sql.
-- Reversing this makes /health unable to report the applied migration count,
-- which fails the deploy verification rather than passing it quietly.
REVOKE SELECT ON TABLE schema_migrations FROM marginsheet_app, marginsheet_sync;
COMMENT ON TABLE schema_migrations IS NULL;
