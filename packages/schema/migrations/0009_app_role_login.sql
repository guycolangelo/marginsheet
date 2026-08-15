-- =========================================================================
-- 0009_app_role_login: the application connects as a non-owner role.
--
-- WHY THIS EXISTS, and a correction to migration 0008's reasoning.
--
-- 0008 recorded that RLS was ENABLED but not FORCED because "with FORCE the
-- table OWNER is also subject to policies", which would filter migrations and
-- the schema test suite. A spike on 15 Aug 2026 proved that reasoning WRONG:
-- neondb_owner already holds the BYPASSRLS role attribute, and BYPASSRLS
-- supersedes FORCE. Under FORCE the owner still saw every row. So FORCE was
-- always free to enable, and it was never what stood between us and
-- household isolation.
--
-- THE SAME SPIKE FOUND SOMETHING WORSE. 0008's mitigation was "the
-- application connects as marginsheet_app, and nothing in the running system
-- holds owner credentials." That was not true. Every Worker environment's
-- NEON_DATABASE_URL was issued for neondb_owner in Task 0.3, so the whole
-- system was one query away from reading across households, past every policy,
-- via BYPASSRLS. Nothing was broken only because no application code queried
-- yet.
--
-- WHAT THIS MIGRATION DOES:
--   1. Grants LOGIN to marginsheet_app and marginsheet_sync so the
--      application can actually connect as a non-owner role. Passwords are
--      set operationally, per deployed environment, and never appear here:
--      a password in a migration is a password in git.
--   2. Enables FORCE on every policied table. Nearly cosmetic given
--      BYPASSRLS, but correct, and it closes the future case where a
--      non-bypass role owns a table.
--
-- WHAT CLOSES THE GAP is neither of those: it is the connection string the
-- application actually uses, checked in the isolation suite. See the
-- rls-not-forced entry in the invariant manifest.
--
-- BYPASSRLS IS DELIBERATELY LEFT ON neondb_owner (ruled 15 Aug 2026).
-- Revoking it would make isolation structural rather than
-- configuration-dependent, but it is Neon's default posture and the migration
-- path depends on it. That is a bet against a vendor default to close a gap
-- the connection-string check already closes, and a verifiable check beats an
-- unverified bet. Recorded as a decision, not an omission.
-- =========================================================================

ALTER ROLE marginsheet_app LOGIN;--> statement-breakpoint
ALTER ROLE marginsheet_sync LOGIN;--> statement-breakpoint
COMMENT ON ROLE marginsheet_app IS
  'The API and app role, member-scoped. Created in migration 0002; granted LOGIN in 0009 so the application connects as a non-owner role rather than as the owner. Holds no BYPASSRLS, so every household_isolation policy applies to it. Row policies attach to THIS role; do not create a parallel app role.';--> statement-breakpoint

ALTER TABLE "members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trial_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plaid_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "financial_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "liability_details" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_corrections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_renames" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commitments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "threads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "known_context" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tombstones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "standing_instructions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tag_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision_journal" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoffs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "condition_states" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calibration_bands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insight_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receivables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_call_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_cache" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "households" FORCE ROW LEVEL SECURITY;
