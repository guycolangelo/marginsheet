ALTER TABLE "plaid_items" DROP COLUMN "liabilities_enabled_at";--> statement-breakpoint
ALTER TABLE "financial_accounts" DROP COLUMN "liability_coverage";--> statement-breakpoint
DROP TYPE "public"."liability_coverage";--> statement-breakpoint
ALTER TABLE "liability_details" DROP CONSTRAINT IF EXISTS "liability_details_account_id_unique";
