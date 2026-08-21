ALTER TABLE "plaid_items" DROP COLUMN "history_complete_at";--> statement-breakpoint
COMMENT ON COLUMN "households"."first_sync_completed_at" IS NULL;
