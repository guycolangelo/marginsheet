-- Restores 0008's grants for marginsheet_sync.
--
-- Deliberately reconstructs the WIDE grant, because a down migration's job is
-- to return the branch to the state the previous migration left, not to a
-- state somebody prefers. A down that "succeeds" while leaving a narrower
-- grant than 0008 made would pass the migrate job's down-then-up cycle and
-- hide a difference between environments.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM marginsheet_sync;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON
  "account_balance_snapshots", "artifacts", "calibration_bands", "categories",
  "category_rules", "commitments", "condition_states", "consent_records",
  "decision_journal", "exports", "financial_accounts", "global_merchant_facts",
  "handoffs", "household_goals", "households", "insight_ledger", "institutions",
  "invitations", "known_context", "liability_details", "llm_cache",
  "llm_call_logs", "members", "merchant_corrections", "messages",
  "provider_events", "question_dispatches", "receivables", "source_renames",
  "standing_instructions", "stripe_subscriptions", "tag_members", "tags",
  "threads", "tombstones", "transactions", "trial_records"
  TO marginsheet_sync;--> statement-breakpoint

GRANT SELECT, UPDATE ON "plaid_items" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT ON "schema_migrations" TO marginsheet_sync;--> statement-breakpoint

COMMENT ON ROLE marginsheet_sync IS
  'The Plaid sync worker role. The only role granted plaid_items.access_token_ciphertext, and the only place the token is decrypted (invariant 2). Created in migration 0002 alongside marginsheet_app.';--> statement-breakpoint
