-- M4 task 4.1: narrow marginsheet_sync from 39 tables to the 9 it needs.
--
-- WHY. The custody doc describes this role as "The Plaid sync worker. The only
-- place TOKEN_ENCRYPTION_KEY is used to decrypt." It held INSERT, SELECT and
-- UPDATE on 39 tables, including messages, threads, known_context,
-- decision_journal, insight_ledger and every LLM log. A component with one job
-- and a role that can read every household's conversation history are
-- different things wearing the same sentence.
--
-- A ROLE'S DOCUMENTATION IS A SECURITY CLAIM, AND THE GRANT IS WHAT IS TRUE.
-- Two roles have now been found wider than the thing describing them, and both
-- were found by looking rather than by anything failing.
--
-- Not exploitable on the day this is written, because no connection string for
-- this role exists yet. That is precisely why it is fixed BEFORE 4.1 issues the
-- credential: the moment one exists, a compromised sync worker reads every
-- household's conversation history.
--
-- SHAPE: revoke everything, then enumerate. Not grant-and-subtract. Revoking
-- the tables that look sensitive today fails open on the thirty-first table
-- somebody adds next month; naming the nine the pipeline needs fails closed on
-- everything unanticipated. Same shape as the enumerated column grants in
-- 0002, 0011, 0017 and 0019, and as allowlisting the rotation target.
--
-- APPEND-ONLY: this migration corrects 0008 going forward. 0008 is on main and
-- is frozen.

-- Everything goes, including the column-level grants underneath. What the
-- pipeline needs is re-granted below, by name.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM marginsheet_sync;--> statement-breakpoint

-- 1. plaid_items. The reason this role exists. It is the ONLY role holding
--    access_token_ciphertext, and INSERT is needed because the token is
--    encrypted where the key lives, which is here and nowhere else.
GRANT SELECT, INSERT, UPDATE ON "plaid_items" TO marginsheet_sync;--> statement-breakpoint

-- 2 through 8. The pipeline's own tables.
GRANT SELECT, INSERT, UPDATE ON "institutions" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "financial_accounts" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "account_balance_snapshots" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "liability_details" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "transactions" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "provider_events" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "commitments" TO marginsheet_sync;--> statement-breakpoint

-- 9. schema_migrations, SELECT only, restored deliberately rather than by
--    accident. 0010 granted it so /health can report the applied migration
--    count, and the deploy check fails when that count does not match the
--    files in the deployed commit. The sync Worker is a deploy target like any
--    other, so it needs this to report. Never grant write: a role that can
--    write this table can forge the schema version the deploy check trusts.
GRANT SELECT ON "schema_migrations" TO marginsheet_sync;--> statement-breakpoint

COMMENT ON ROLE marginsheet_sync IS
  'The Plaid sync worker role. The only role granted plaid_items.access_token_ciphertext, and the only place the token is decrypted (data-model-spec invariant 2). Narrowed in 0023 from 39 tables to 9: plaid_items, institutions, financial_accounts, account_balance_snapshots, liability_details, transactions, provider_events, commitments, and SELECT on schema_migrations for /health. ENUMERATED, NOT GRANT-AND-SUBTRACT: a table added later is not silently reachable by this role. If the pipeline needs a tenth table, add it here by name and add it to the negative control''s knowledge, because the test that proves this boundary works by attempting tables it must not reach.';--> statement-breakpoint
