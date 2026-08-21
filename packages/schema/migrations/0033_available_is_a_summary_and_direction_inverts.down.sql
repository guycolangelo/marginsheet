-- Restores 0032's comments. The direction comment had none before 0033, so it
-- returns to null rather than to an earlier sentence.
COMMENT ON COLUMN "financial_accounts"."available_balance" IS
  'CREDIT: NO CONSUMER. This is a limit. It touches nothing: not cash, not the P&L, not Cash Flow. How much more a household could borrow is not a fact about their money, and rendering it anywhere near a cash figure would imply otherwise. DEPOSITORY: NO CONSUMER DECLARED, which is not the same as none existing. Holds-adjusted cash is the single most tempting column in this table, because "available" is precisely the word every "budgeting app" puts on a balance, and a consumer for it is a ruling nobody has made. Until one is made, read current_balance.';
COMMENT ON COLUMN "account_balance_snapshots"."available_balance" IS
  'Captured for symmetry with the live column and read by nothing, for the same reason available_balance is read by nothing: on a card it is a limit, and on a depository account no consumer has been declared.';
COMMENT ON COLUMN "transactions"."direction" IS NULL;
