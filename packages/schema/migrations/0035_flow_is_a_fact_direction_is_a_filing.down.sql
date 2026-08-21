-- Restores M4's sign-derived direction and removes the fact column.
--
-- IT CAN DO THIS EXACTLY, for the same reason the up migration could: the
-- mapping is a pure function both ways. What it CANNOT restore is any filing
-- M5 wrote, and it does not try: if this is reversed after M5 has filed
-- anything, the assertion below refuses rather than overwriting real filings
-- with a sign.
DO $$
DECLARE filed int;
BEGIN
  SELECT count(*) INTO filed FROM "transactions" WHERE "direction" IS NOT NULL;
  IF filed > 0 THEN
    RAISE EXCEPTION 'transactions holds % filed rows; reversing 0035 would overwrite M5 filings with a sign-derived value', filed;
  END IF;
END $$;--> statement-breakpoint

UPDATE "transactions"
   SET "direction" = CASE WHEN "flow" = 'outflow' THEN 'expense'::"public"."transaction_direction"
                          ELSE 'income'::"public"."transaction_direction" END;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "direction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "flow";--> statement-breakpoint
DROP TYPE "public"."money_flow";--> statement-breakpoint

COMMENT ON COLUMN "transactions"."direction" IS NULL;
