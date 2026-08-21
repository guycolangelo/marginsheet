-- =========================================================================
-- `undetermined` IS A FOURTH DIRECTION, AND IT IS THE ACCURATE VALUE RATHER
-- THAN A MISSING ANSWER (Guy, 21 Aug 2026).
--
-- IT FOLLOWS FROM DOCTRINE THIS PIPELINE ALREADY STATES. M4 stores FACTS AND
-- NOTHING DERIVED. A card credit's direction is NOT A FACT M4 HOLDS: it is a
-- filing decision requiring context M5 has and M4 does not, because a credit to
-- a card is a PAYMENT or a REFUND and only the filing layer can tell which.
--
-- So `undetermined` is not a gap and this comment must not imply one. It is the
-- pipeline saying exactly what it knows and stopping there.
--
-- WHY IT WAS NEEDED. apply-streams.ts derived `direction` from the SIGN of
-- Plaid's amount, which inverts across account type: on a depository account a
-- negative is income, and on a card a negative is a payment or a refund and is
-- NEVER income. The two other options both produce a value that READS AS A
-- DETERMINATION, which is the whole objection: `transfer` for every card credit
-- is wrong for refunds, and a nullable column merges "not yet filed" with "no
-- value". Only a named fourth value leaves a consumer unable to silently
-- inherit a guess.
--
-- IT ALSO RESOLVES A CONFLICT THAT WAS ALREADY HERE. This type's comment has
-- said since 0004 that resolveDirection is THE SINGLE SOURCE OF TRUTH for the
-- stored value. M4 wrote the column anyway, with its own rule, which made two
-- writers of one fact. With `undetermined`, M4 records what it observed and M5
-- determines, and the single-source claim becomes true rather than aspirational.
--
-- `undetermined` IS NOT `unclassified`, AND THE TWO ARE NEAR-SYNONYMS IN
-- ENGLISH, WHICH IS THE HAZARD. `unclassified` is a Base44 legacy value that
-- was never set, is banned by invariant 9, and is rewritten by the M9 migration.
-- `undetermined` is deliberate, written by the pipeline, and means the filing
-- decision has not been made yet. Confusing them would reintroduce the value
-- invariant 9 exists to remove.
--
-- ADDED IN ITS OWN MIGRATION BECAUSE POSTGRES WILL NOT LET THE NEW LABEL BE
-- USED IN THE TRANSACTION THAT ADDS IT. The repair of the stored rows is
-- therefore a separate migration, which it had to be anyway: it is gated on
-- reading which sign Plaid gives a card credit in production, since Sandbox's
-- dataset holds no card payment and cannot answer it.
-- =========================================================================

ALTER TYPE "public"."transaction_direction" ADD VALUE IF NOT EXISTS 'undetermined';--> statement-breakpoint

COMMENT ON TYPE "public"."transaction_direction" IS
  'Four values since 0034. "unclassified" is deliberately ABSENT and is NOT the same thing as "undetermined": it existed in Base44 as a legacy value that was never set, and the M9 migration rewrites any survivor through resolveDirection (invariant 9). "undetermined" is DELIBERATE AND ACCURATE rather than missing: M4 stores facts and nothing derived, and a card credit''s direction is not a fact M4 holds, because a credit to a card is a payment or a refund and only the filing layer has the context to tell which. A pipeline that guessed would produce a value that reads as a determination. NOTE: this is NOT commitment_direction, which is inflow or outflow. resolveDirection IS THE SINGLE SOURCE OF TRUTH for the stored value, applied last in the per-transaction pipeline (categorization-spec section 8): transfer if is_transfer; income if the category line is income; expense for all other categorized transactions; income for UNCATEGORIZED INFLOWS; expense for uncategorized outflows. THAT CLAIM WAS ASPIRATIONAL UNTIL 0034, because M4 wrote this column with its own sign rule, making two writers of one fact; M4 now records undetermined where it cannot know and M5 determines. THE INCLUSION DOCTRINE, the rule a reader will most want to argue with: an unconfirmed inflow counts as INCOME while it awaits review. It is labeled, and the MarginSheet shows the transparency counterfactual (what Kept and Margin would be if every uncategorized inflow turned out to be a transfer). Holding inflows out until confirmed would understate income and make the household total wrong in the direction that flatters. Right in total, pending in breakdown. ONE DELIBERATE CARVE-OUT: unresolved inflows count on the MarginSheet but are excluded from the materiality floor, which requires review_state != needs_review. A floor inflated by unresolved deposits would suppress the very questions that resolve them.';
