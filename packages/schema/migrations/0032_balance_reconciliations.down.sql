-- Reverting removes the only check that compares our ledger against the
-- institution. An enum value cannot be removed in Postgres, so
-- insight_source keeps 'reconciliation'; a value nothing writes is inert.
DROP TABLE IF EXISTS "balance_reconciliations";
