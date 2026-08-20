-- Restores the unconstrained sync policy. Reverting this REOPENS four confirmed
-- cross-household write paths; it exists because every migration here has a
-- down file, not because reverting is advisable.

DROP POLICY IF EXISTS "sync_worker_read" ON "members";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "members";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "members" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "invitations";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "invitations";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "invitations" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "trial_records";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "trial_records";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "trial_records" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "consent_records";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "consent_records";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "consent_records" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "plaid_items";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "plaid_items";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "plaid_items" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "financial_accounts";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "financial_accounts";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "financial_accounts" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "account_balance_snapshots";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "account_balance_snapshots";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "account_balance_snapshots" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "liability_details";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "liability_details";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "liability_details" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "categories";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "categories";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "categories" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "transactions";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "transactions";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "transactions" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "merchant_corrections";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "merchant_corrections";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "merchant_corrections" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "category_rules";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "category_rules";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "category_rules" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "source_renames";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "source_renames";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "source_renames" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "commitments";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "commitments";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "commitments" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "household_goals";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "household_goals";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "household_goals" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "threads";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "threads";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "threads" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "messages";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "messages";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "messages" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "question_dispatches";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "question_dispatches";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "question_dispatches" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "known_context";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "known_context";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "known_context" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "tombstones";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "tombstones";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "tombstones" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "standing_instructions";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "standing_instructions";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "standing_instructions" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "tags";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "tags";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "tags" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "tag_members";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "tag_members";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "tag_members" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "decision_journal";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "decision_journal";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "decision_journal" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "handoffs";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "handoffs";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "handoffs" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "condition_states";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "condition_states";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "condition_states" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "calibration_bands";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "calibration_bands";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "calibration_bands" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "insight_ledger";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "insight_ledger";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "insight_ledger" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "receivables";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "receivables";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "receivables" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "artifacts";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "artifacts";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "artifacts" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "exports";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "exports";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "exports" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "llm_call_logs";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "llm_call_logs";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "llm_call_logs" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "llm_cache";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "llm_cache";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "llm_cache" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "stripe_subscriptions";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "stripe_subscriptions";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "stripe_subscriptions" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "households";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "households";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "households" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_read" ON "provider_events";--> statement-breakpoint
DROP POLICY IF EXISTS "sync_worker_write" ON "provider_events";--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "provider_events" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint