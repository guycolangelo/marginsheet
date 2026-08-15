-- =========================================================================
-- 0008_rls: row-level security, and the table grants the app role needs.
--
-- Policies attach to the roles created in migration 0002 (marginsheet_app,
-- marginsheet_sync), per the instruction in that migration's header. No new
-- roles: two overlapping role sets is how a policy ends up protecting a role
-- nothing connects as.
--
-- GRANTS: migration 0002 granted the app role privileges on the tables that
-- existed then. Everything created in 0003 through 0007 had none, so the app
-- role could not read them at all. This migration closes that. plaid_items is
-- DELIBERATELY EXCLUDED from the blanket SELECT: 0002 granted it column by
-- column so access_token_ciphertext stays unreachable, and a table-level
-- GRANT here would hand the app role the ciphertext and silently undo
-- invariant 2.
--
-- ENABLE, NOT FORCE, and this is a deliberate trade recorded here rather than
-- discovered later. With FORCE the table OWNER is also subject to policies.
-- The owner is the migration identity, so FORCE would require every migration
-- and every introspection to set the household GUC, and would filter the
-- schema test suite itself. Without FORCE the owner bypasses.
--
-- WHAT THAT COSTS, stated plainly: a job connecting as the OWNER is not
-- filtered by these policies. The mitigation is deployment discipline rather
-- than schema: the application connects as marginsheet_app, the sync worker
-- as marginsheet_sync, and neither is the owner. Nothing in the running
-- system should hold owner credentials. If that stops being true, FORCE plus
-- a GUC-aware migration harness is the hardening, and it is real work rather
-- than a one-line change.
--
-- FAIL-CLOSED BY DEFAULT: enabling RLS with no matching policy denies all
-- rows to a non-owner role. The predicate wraps current_setting in btrim and
-- nullif so an UNSET session, an EMPTY-STRING session, and a WHITESPACE-only
-- session all behave identically: all yield NULL, NULL = uuid is NULL rather than true, and the session sees zero
-- rows. Without them, an app that set the GUC to a blank value would raise a
-- cast error instead of failing closed, which is a worse failure to debug
-- under pressure than a quiet zero-row result.
-- =========================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON "members" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "members" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "invitations" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "trial_records" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "trial_records" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "consent_records" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "consent_records" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "financial_accounts" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "financial_accounts" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_balance_snapshots" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "account_balance_snapshots" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "liability_details" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "liability_details" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "provider_events" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "provider_events" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "categories" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "categories" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transactions" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "transactions" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "merchant_corrections" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "merchant_corrections" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "category_rules" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "category_rules" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "source_renames" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "source_renames" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "commitments" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "commitments" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "household_goals" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "household_goals" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "threads" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "threads" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "messages" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "question_dispatches" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "question_dispatches" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "known_context" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "known_context" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tombstones" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tombstones" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "standing_instructions" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "standing_instructions" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tags" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tags" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tag_members" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tag_members" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "decision_journal" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "decision_journal" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "handoffs" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoffs" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "condition_states" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "condition_states" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "calibration_bands" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "calibration_bands" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "insight_ledger" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "insight_ledger" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "receivables" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "receivables" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "artifacts" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "artifacts" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "exports" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "exports" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "llm_call_logs" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "llm_call_logs" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "llm_cache" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "llm_cache" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stripe_subscriptions" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stripe_subscriptions" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "households" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "households" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT ON "global_merchant_facts" TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "global_merchant_facts" TO marginsheet_sync;--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "members" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "members" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "invitations" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "invitations" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "trial_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "trial_records" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "trial_records" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "consent_records" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "consent_records" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "plaid_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "plaid_items" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "plaid_items" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "financial_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "financial_accounts" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "financial_accounts" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "account_balance_snapshots" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "account_balance_snapshots" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "liability_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "liability_details" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "liability_details" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "provider_events" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "provider_events" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "categories" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "categories" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "transactions" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "transactions" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "merchant_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "merchant_corrections" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "merchant_corrections" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "category_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "category_rules" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "category_rules" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "source_renames" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "source_renames" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "source_renames" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "commitments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "commitments" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "commitments" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "household_goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "household_goals" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "household_goals" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "threads" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "threads" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "messages" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "messages" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "question_dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "question_dispatches" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "question_dispatches" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "known_context" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "known_context" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "known_context" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "tombstones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "tombstones" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "tombstones" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "standing_instructions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "standing_instructions" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "standing_instructions" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "tags" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "tags" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "tag_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "tag_members" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "tag_members" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "decision_journal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "decision_journal" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "decision_journal" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "handoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "handoffs" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "handoffs" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "condition_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "condition_states" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "condition_states" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "calibration_bands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "calibration_bands" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "calibration_bands" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "insight_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "insight_ledger" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "insight_ledger" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "receivables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "receivables" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "receivables" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "artifacts" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "artifacts" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "exports" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "exports" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "llm_call_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "llm_call_logs" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "llm_call_logs" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "llm_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "llm_cache" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "llm_cache" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "stripe_subscriptions" FOR ALL TO marginsheet_app
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "stripe_subscriptions" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "households" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "households" FOR ALL TO marginsheet_app
  USING (id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_access" ON "households" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);--> statement-breakpoint
COMMENT ON POLICY "household_isolation" ON "transactions" IS
  'THE PREDICATE: household_id must equal the session household, set by the app as marginsheet.household_id at the start of each request. Every household-scoped table carries this same policy shape.

   WHAT HAPPENS WITHOUT IT: one household reads another household bank transactions. That is the worst failure this system can have, worse than any amount of downtime. Downtime is an outage a household forgives; a stranger reading their ledger is a breach they never do, and it cannot be undone by fixing the bug afterward.

   The policy is the thing standing between those two outcomes, and it is deliberately NOT the only thing: application queries still scope by household. This exists because one forgotten WHERE clause, in one query, on one code path, is otherwise sufficient. Defense in depth means the forgotten clause is a bug rather than a disclosure.

   FAIL-CLOSED: the predicate wraps current_setting in btrim and nullif, so an unset session, an empty-string session, and a whitespace-only session all behave identically. All yield NULL, NULL = uuid is NULL rather than true, and the session SEES ZERO ROWS. Without them a blank value would raise a cast error rather than failing closed, which is a worse failure to debug under pressure than a quiet zero-row result.

   marginsheet_sync holds a separate permissive policy because the sync worker operates across households by design. It gains nothing here that widens its column privileges: the Plaid token remains reachable only through the column grant from migration 0002.';--> statement-breakpoint
COMMENT ON POLICY "household_isolation" ON "provider_events" IS
  'Note the interaction with a nullable household_id: an unattributed callback (a Stripe event for an unknown customer, a Plaid webhook ahead of item attribution) has household_id NULL, so this predicate is NULL and the row is INVISIBLE to marginsheet_app. That is intended. Unattributed events are webhook plumbing handled by the sync worker under its own policy, not household-facing data.';
