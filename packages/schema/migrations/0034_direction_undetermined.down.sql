-- POSTGRES CANNOT REMOVE AN ENUM LABEL, so the type is rebuilt without it.
-- Both dependent columns are detoured through text and cast back.
--
-- IT FAILS LOUDLY IF ANY ROW HOLDS 'undetermined', because the cast has nowhere
-- to put that value, and that is the correct behaviour: a down migration that
-- silently discarded a filing state would be worse than one that refuses.
ALTER TABLE "transactions" ALTER COLUMN "direction" TYPE text;--> statement-breakpoint
ALTER TABLE "merchant_corrections" ALTER COLUMN "direction" TYPE text;--> statement-breakpoint
DROP TYPE "public"."transaction_direction";--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "direction" TYPE "public"."transaction_direction"
  USING "direction"::"public"."transaction_direction";--> statement-breakpoint
ALTER TABLE "merchant_corrections" ALTER COLUMN "direction" TYPE "public"."transaction_direction"
  USING "direction"::"public"."transaction_direction";--> statement-breakpoint
COMMENT ON TYPE "public"."transaction_direction" IS
  'Three values. "unclassified" is deliberately ABSENT: it existed in Base44 as a legacy value that was never set, and the M9 migration rewrites any survivor through resolveDirection (invariant 9). NOTE: this is NOT commitment_direction, which is inflow or outflow. resolveDirection IS THE SINGLE SOURCE OF TRUTH for the stored value, applied last in the per-transaction pipeline (categorization-spec §8): transfer if is_transfer; income if the category line is income; expense for all other categorized transactions; income for UNCATEGORIZED INFLOWS; expense for uncategorized outflows. THE INCLUSION DOCTRINE, the rule a reader will most want to argue with: an unconfirmed inflow counts as INCOME while it awaits review. It is labeled, and the MarginSheet shows the transparency counterfactual (what Kept and Margin would be if every uncategorized inflow turned out to be a transfer). Holding inflows out until confirmed would understate income and make the household total wrong in the direction that flatters. Right in total, pending in breakdown. ONE DELIBERATE CARVE-OUT: unresolved inflows count on the MarginSheet but are excluded from the materiality floor, which requires review_state != needs_review. A floor inflated by unresolved deposits would suppress the very questions that resolve them.';
