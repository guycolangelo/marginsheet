-- Reverses 0004_projections.sql. Restores transaction_direction's comment to
-- its 0003 text, since this migration amended it to cross-reference
-- commitment_direction.
DROP TABLE IF EXISTS "household_goals";
DROP TABLE IF EXISTS "commitments";

DROP TYPE IF EXISTS "public"."goal_set_with";
DROP TYPE IF EXISTS "public"."commitment_status";
DROP TYPE IF EXISTS "public"."commitment_source";
DROP TYPE IF EXISTS "public"."cadence";
DROP TYPE IF EXISTS "public"."commitment_direction";

COMMENT ON TYPE "public"."transaction_direction" IS
  'Three values. "unclassified" is deliberately ABSENT: it existed in Base44 as a legacy value that was never set, and the M9 migration rewrites any survivor through resolveDirection (invariant 9). resolveDirection IS THE SINGLE SOURCE OF TRUTH for the stored value, applied last in the per-transaction pipeline (categorization-spec §8): transfer if is_transfer; income if the category line is income; expense for all other categorized transactions; income for UNCATEGORIZED INFLOWS; expense for uncategorized outflows. THE INCLUSION DOCTRINE, the rule a reader will most want to argue with: an unconfirmed inflow counts as INCOME while it awaits review. It is labeled, and the MarginSheet shows the transparency counterfactual (what Kept and Margin would be if every uncategorized inflow turned out to be a transfer). Holding inflows out until confirmed would understate income and make the household total wrong in the direction that flatters. Right in total, pending in breakdown. ONE DELIBERATE CARVE-OUT: unresolved inflows count on the MarginSheet but are excluded from the materiality floor, which requires review_state != needs_review. A floor inflated by unresolved deposits would suppress the very questions that resolve them.';
