-- =========================================================================
-- ONE CONSUMER PER BALANCE COLUMN (Guy, 21 Aug 2026)
--
-- EACH COLUMN BELOW HAS EXACTLY ONE CONSUMER, AND THE HAZARD IS A COLUMN
-- BEING READ BY SOMETHING THAT WANTS A DIFFERENT ONE.
--
--   current (depository)   -> cash position, Cash Flow's starting point
--   current (credit)       -> reconciliation only
--   last_statement_balance -> Cash Flow's committed outflow, with its due date
--   available (credit)     -> nothing
--
-- This was first written as a vocabulary rule about never combining figures.
-- The vocabulary was an attempt to NAME the failure; this is the mechanical
-- version, and it is narrower and enforceable. A rule that says "do not say
-- this" needs a reader to obey it. A rule that says "this column has one
-- consumer" can be enforced by an accessor, which is why the accessor
-- enforces reach rather than wording.
--
-- WHY current IS THE DANGEROUS ONE: THE NAME IS UNIFORM AND THE MEANING IS
-- NOT. On a depository account it is money HELD. On a card it is the live
-- running total, the statement plus everything charged since, moving with
-- every transaction. That makes it exactly right for reconciliation, which
-- checks a running total against a running total, and wrong for everything
-- else, because it is not what any payment will be.
--
-- The arithmetic follows the same split and is the reason a type-blind
-- consumer does not merely mislead, it computes wrongly: depository spending
-- DECREASES this column and credit spending INCREASES it. A reconciliation
-- that subtracts before knowing the type reports permanent drift on every
-- card, and the drift looks like a sync fault rather than a sign error.
-- =========================================================================

COMMENT ON COLUMN "financial_accounts"."current_balance" IS
  'TYPE-DEPENDENT. TWO CONSUMERS, ONE PER TYPE, AND NEITHER MAY READ THE OTHER''S ROWS. DEPOSITORY: money held right now, and Cash Flow''s starting point. CREDIT: the live running total, statement plus everything charged since, which moves with every transaction. That makes it the right thing for RECONCILIATION to check against and the wrong thing for anything else: it is not what the payment will be, and the payment is what Cash Flow needs. Read last_statement_balance for that. Spending DECREASES this on a depository account and INCREASES it on a card, so a consumer that computes before knowing the type is wrong by a sign rather than by a nuance. NEVER SUMMED ACROSS TYPES: the result is a number that looks right and means nothing.';

COMMENT ON COLUMN "financial_accounts"."available_balance" IS
  'CREDIT: NO CONSUMER. This is a limit. It touches nothing: not cash, not the P&L, not Cash Flow. How much more a household could borrow is not a fact about their money, and rendering it anywhere near a cash figure would imply otherwise. DEPOSITORY: NO CONSUMER DECLARED, which is not the same as none existing. Holds-adjusted cash is the single most tempting column in this table, because "available" is precisely the word every "budgeting app" puts on a balance, and a consumer for it is a ruling nobody has made. Until one is made, read current_balance.';

COMMENT ON COLUMN "financial_accounts"."credit_limit" IS
  'NO CONSUMER DECLARED. Written by the sync from Plaid and read by nothing. Its plausible use is utilization, which is a fact about a card rather than about the household''s money, and no surface has asked for it.';

COMMENT ON COLUMN "liability_details"."last_statement_balance" IS
  'CASH FLOW''S COMMITTED OUTFLOW. What the payment will be, paired with next_payment_due_date: a known amount on a known date, which is why it renders as COMMITTED rather than estimated. This is what the cards were connected for, and it comes from Plaid Liabilities rather than from the balance block. NOT WRITTEN YET: consent is declared in config/plaid-consent.json and the grant exists, and no code calls /liabilities. See docs/open-items.json.';

COMMENT ON COLUMN "liability_details"."next_payment_due_date" IS
  'The date half of Cash Flow''s committed outflow. Meaningless without last_statement_balance and never read apart from it: an amount with no date and a date with no amount are both uncommittable, and Cash Flow''s whole question is WHEN.';

COMMENT ON COLUMN "account_balance_snapshots"."current_balance" IS
  'The daily capture of financial_accounts.current_balance, and it carries that column''s type-dependence with it. The account''s type is not stored here, so a consumer of this table MUST join financial_accounts to know which of the two meanings it is holding. A snapshot series summed across types is the same error as the live column summed across types, repeated once per day.';

COMMENT ON COLUMN "account_balance_snapshots"."available_balance" IS
  'Captured for symmetry with the live column and read by nothing, for the same reason available_balance is read by nothing: on a card it is a limit, and on a depository account no consumer has been declared.';

-- card_state and carried_balance have no writer and no consumer. They have sat
-- two columns from the balance block since M6's design, which is the tell worth
-- recording: SOMEBODY KNEW CARDS WERE DIFFERENT, and the knowledge stopped at a
-- pair of unused columns while the block itself carried no comments at all.
-- That is why these comments are in the schema rather than in a document. A
-- reader meets the column; they do not necessarily meet the document.
COMMENT ON COLUMN "financial_accounts"."card_state" IS
  'NO WRITER AND NO CONSUMER since 0002. Not dead: it is the readable form of the distinction these comments draw, and whichever surface needs paid_in_full against revolving will want it. Leave it.';

COMMENT ON COLUMN "financial_accounts"."carried_balance" IS
  'NO WRITER AND NO CONSUMER since 0002. See card_state.';
