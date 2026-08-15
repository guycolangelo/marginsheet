-- Reverses 0003_ledger.sql, including the constraints added to 1.2's tables.
-- Composite FKs drop before the unique keys they depend on.
ALTER TABLE "financial_accounts" DROP CONSTRAINT IF EXISTS "financial_accounts_item_same_household_fk";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_account_same_household_fk";

DROP TABLE IF EXISTS "source_renames";
DROP TABLE IF EXISTS "category_rules";
DROP TABLE IF EXISTS "merchant_corrections";
DROP TABLE IF EXISTS "transactions";

ALTER TABLE "financial_accounts" DROP CONSTRAINT IF EXISTS "financial_accounts_household_id_key";
ALTER TABLE "plaid_items" DROP CONSTRAINT IF EXISTS "plaid_items_household_id_key";

DROP TYPE IF EXISTS "public"."rule_source";
DROP TYPE IF EXISTS "public"."correction_source";
DROP TYPE IF EXISTS "public"."reimbursement_status";
DROP TYPE IF EXISTS "public"."confidence_level";
DROP TYPE IF EXISTS "public"."queue_reason";
DROP TYPE IF EXISTS "public"."review_state";
DROP TYPE IF EXISTS "public"."transaction_direction";
