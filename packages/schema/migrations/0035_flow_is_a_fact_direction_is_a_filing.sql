-- =========================================================================
-- `flow` IS A FACT AND `direction` IS A FILING. Ruled by Guy, 21 Aug 2026.
--
-- THE DEFECT, IN ONE SENTENCE: the enum conflated a fact with a filing.
-- Which way the money moved is a fact M4 holds. Whether that is income,
-- expense or transfer is a filing decision needing context M4 does not have.
-- A DEPOSIT FROM ADP AND A DEPOSIT FROM JOINT SAVINGS ARE THE SAME FACT AND
-- DIFFERENT FILINGS, and one column was trying to be both.
--
--   transactions.flow       inflow | outflow      M4 writes it. Always knowable.
--   transactions.direction  income | expense |    M5 writes it. NULL until filed.
--                           transfer | undetermined
--
-- WHY NOT JUST MARK THE BAD ROWS. `undetermined` on the 56 card credits we
-- noticed would have made the column MORE misleading, because it implies the
-- other 1,872 rows are filed correctly. 520 depository inflows are internal
-- SoFi vault moves ("From Joint Savings", "From Entertainment Vault") filed as
-- income, and some of the 1,042 outflows are card payments filed as spending.
-- A COLUMN THAT LOOKS REVIEWED IS WORSE THAN ONE THAT LOOKS RAW, which is the
-- same rule as never showing a figure the data does not support.
--
-- THE BACKFILL IS EXACT AND THAT IS THE BUG'S ONE GOOD CONSEQUENCE (Guy).
-- `direction` was a PURE FUNCTION OF PLAID'S SIGN: directionOf returned expense
-- for a positive amount and income otherwise, and `amount` was stored through
-- Math.abs, so `direction` is the ONLY SURVIVING RECORD of the sign. Because it
-- is a pure function, inverting it needs no judgement anywhere:
--   expense  <->  Plaid positive  <->  outflow
--   income   <->  Plaid negative  <->  inflow
-- Had M4 been filing with any real interpretation, this repair would have
-- required re-deriving every row from Plaid instead of one statement.
--
-- `direction` IS NOT DELETED, IT IS DEMOTED, which is why this is cheap.
-- Everything the specs say about resolveDirection stays true and becomes true
-- FOR THE FIRST TIME: 0004 claimed it was the single source of truth while M4
-- wrote the column anyway. `undetermined` from 0034 survives with a changed
-- owner, as M5's honest output for a card credit it cannot resolve into a
-- payment or a refund.
--
-- TWO DECISIONS RECORDED SO NOBODY REDISCOVERS THEM BY BREAKING SOMETHING.
--
-- ONE: transactions_merchant_key_idx STAYS KEYED ON `direction`, DELIBERATELY.
-- Its three uses, correction matching, recurrence inheritance and refund
-- matching, all probably want the FACT rather than the filing: a refund is an
-- inflow matching a prior outflow at the same merchant, and a household's
-- correction of "Amazon" applies to purchases rather than to refunds. IT
-- SHOULD PROBABLY KEY ON `flow`. It is not changed here because CHANGING AN
-- INDEX M5 WILL DESIGN AGAINST, BEFORE M5 HAS DESIGNED, IS GUESSING AT A
-- REQUIREMENT (Guy). M5 rules it with the rest of its filing design.
--
-- TWO: `money_flow` IS A NEW TYPE AND FOLDING IT INTO `commitment_direction`
-- WAS CONSIDERED AND REJECTED. The two share a vocabulary and are not the same
-- fact: a commitment's direction is a property of a RECURRING OBLIGATION, a
-- transaction's flow is a property of ONE MOVEMENT OF MONEY. Folding them makes
-- a future divergence expensive and buys nothing except one fewer type. This is
-- written down because the fold looks like an obvious tidy-up to anyone who
-- meets the two types cold.
--
-- GRANTS NEED NO CHANGE AND THAT IS NOT LUCK, IT IS WORTH STATING. 0008 and
-- 0023 grant transactions at TABLE level to both roles, and a table grant
-- covers columns added later. Had these been enumerated column grants, as
-- plaid_items is, `flow` would have been excluded BY DESIGN and the first sync
-- would have failed the way last_cursor_at did. A LATER NARROWING OF
-- transactions TO COLUMN GRANTS MUST INCLUDE `flow`.
-- =========================================================================

CREATE TYPE "public"."money_flow" AS ENUM('inflow', 'outflow');--> statement-breakpoint

ALTER TABLE "transactions" ADD COLUMN "flow" "money_flow";--> statement-breakpoint

-- ASSERTED BEFORE THE BACKFILL RUNS, not checked after. Only `expense` and
-- `income` can exist, because directionOf could return nothing else, and the
-- two-branch mapping below is exact ONLY under that. A row holding `transfer`
-- or `undetermined` would mean something wrote this column that this migration
-- does not know about, and mapping it silently is how a repair invents data.
DO $$
DECLARE unexpected int;
BEGIN
  SELECT count(*) INTO unexpected FROM "transactions"
   WHERE "direction" NOT IN ('expense', 'income');
  IF unexpected > 0 THEN
    RAISE EXCEPTION 'transactions holds % rows whose direction is neither expense nor income; the sign cannot be recovered from them and this backfill would invent it', unexpected;
  END IF;
END $$;--> statement-breakpoint

UPDATE "transactions"
   SET "flow" = CASE WHEN "direction" = 'expense' THEN 'outflow'::"public"."money_flow"
                     ELSE 'inflow'::"public"."money_flow" END;--> statement-breakpoint

ALTER TABLE "transactions" ALTER COLUMN "flow" SET NOT NULL;--> statement-breakpoint

-- The filing is nulled because NOTHING HAS FILED ANYTHING. Every value in this
-- column was written by M4 from the sign, which is not a filing, and leaving
-- them would leave 520 internal transfers asserting they are income.
ALTER TABLE "transactions" ALTER COLUMN "direction" DROP NOT NULL;--> statement-breakpoint
UPDATE "transactions" SET "direction" = NULL;--> statement-breakpoint

COMMENT ON TYPE "public"."money_flow" IS
  'Which way the money moved. A FACT, always knowable at sync time from the sign of Plaid''s amount, and never a filing. NOT commitment_direction, which is inflow/outflow on a recurring obligation: folding the two was considered on 21 Aug 2026 and rejected, because a commitment''s direction is a property of an obligation and a transaction''s flow is a property of one movement of money. They share a vocabulary and are not the same fact, and folding them would make a future divergence expensive to buy one fewer type.';--> statement-breakpoint

COMMENT ON COLUMN "transactions"."flow" IS
  'WRITTEN BY M4, always. inflow or outflow, derived from the sign of Plaid''s amount, which is positive for money leaving the account on BOTH depository and credit accounts. This is the fact half of what `direction` used to conflate. `amount` is stored through Math.abs, so THIS COLUMN AND direction ARE THE ONLY PLACES THE SIGN SURVIVES.';--> statement-breakpoint

COMMENT ON COLUMN "transactions"."direction" IS
  'WRITTEN BY M5, never by the pipeline. NULL means NOT YET FILED, which is every row as of 0035. income, expense, transfer or undetermined is a FILING DECISION requiring context M4 does not have: a deposit from ADP and a deposit from Joint Savings are the same fact and different filings, and a credit on a card is a payment or a refund and only the filing layer can tell which. M4 wrote this column from 0003 to 0035 using the sign alone, which is why 520 internal vault transfers were stored as income. THE FACT LIVES IN `flow` NOW. resolveDirection is the single source of truth for this value, as 0004 always claimed and as was not true until now.';
