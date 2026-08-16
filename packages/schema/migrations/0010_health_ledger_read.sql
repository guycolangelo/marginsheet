-- =========================================================================
-- 0010_health_ledger_read: the application can read the migration ledger.
--
-- WHY THIS EXISTS.
--
-- /health returned green for ten merged PRs against databases that held zero
-- tables. It proved the Worker had booted and nothing else, so a Worker
-- deployed against a schema that did not exist was indistinguishable from a
-- working system. The health check now runs a real query against a real table
-- and reports how many migrations the connected database has applied, and the
-- deploy verification fails when that count does not match the number of
-- migration files in the commit being deployed. Code deployed against a
-- schema it does not match is now a failed deploy rather than a green one.
--
-- That check needs the application role to read schema_migrations. The ledger
-- is created by the migration runner (src/migrate.ts, ensureLedger) rather
-- than by a migration file, so it never passed through the grant blocks in
-- 0003 through 0007 and marginsheet_app had no privilege on it.
--
-- WHY SELECT IS SAFE HERE: the ledger holds migration filenames and applied
-- timestamps. It carries no household data, so it is outside the RLS story
-- entirely. The application gets SELECT and nothing more: INSERT or DELETE
-- would let a compromised application role forge its own schema version and
-- make the deploy check report whatever it liked.
-- =========================================================================

GRANT SELECT ON TABLE schema_migrations TO marginsheet_app, marginsheet_sync;

COMMENT ON TABLE schema_migrations IS
  'Migration ledger, written only by the migration runner. marginsheet_app and marginsheet_sync hold SELECT so /health can report the applied migration count; the deploy verification fails when that count does not match the migration files in the deployed commit. Never grant write here: a role that can write this table can forge the schema version the deploy check trusts.';
