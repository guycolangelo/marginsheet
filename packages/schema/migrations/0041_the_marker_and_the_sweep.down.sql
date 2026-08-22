-- The enum label cannot be removed; a value nothing writes is inert. Rows
-- holding 'swept' would be unrepresentable after a rebuild, so this refuses
-- rather than rewriting them to idle, which would erase the distinction the
-- value exists to carry.
DO $$
DECLARE swept int;
BEGIN
  SELECT count(*) INTO swept FROM plaid_items WHERE sync_status = 'swept';
  IF swept > 0 THEN
    RAISE EXCEPTION 'plaid_items holds % swept rows; reversing 0041 would rewrite them to idle and erase the distinction between a clean finish and a sweep', swept;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "plaid_items" DROP COLUMN "sync_started_at";--> statement-breakpoint
COMMENT ON TYPE "public"."sync_status" IS NULL;
