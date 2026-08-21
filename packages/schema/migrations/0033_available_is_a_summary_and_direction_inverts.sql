-- =========================================================================
-- TWO RULINGS FROM 21 AUG 2026, both correcting comments 0032 wrote hours
-- earlier. THEY GO FORWARD RATHER THAN INTO 0032, which is merged and
-- therefore frozen: an edit would reach only the databases that have not
-- applied it yet, leaving identical ledgers and different schemas.
--
-- ONE: DEPOSITORY available_balance HAS NO CONSUMER, AND NOW WITH A REASON.
--
-- 0032 recorded it as NO CONSUMER DECLARED and sent readers to
-- current_balance, which was the safe direction to be wrong in and was not a
-- ruling. Guy ruled it, and the reason is arithmetic rather than preference.
--
-- `available` subtracts holds. A HOLD IS A PENDING TRANSACTION, AND PENDING
-- TRANSACTIONS ARE ALREADY IN THE LEDGER: `transactions.pending` is written by
-- the sync, and Checking carries one right now. So a projection reading
-- available AND counting the pending row SUBTRACTS THE SAME MONEY TWICE.
--
-- current_balance plus the ledger's pending rows is the complete picture.
-- available_balance is A SUMMARY OF THE SAME FACT, and holding both is how the
-- same dollar leaves twice. That is why it has no consumer.
--
-- TWO: THE SIGN OF `amount` INVERTS ACROSS ACCOUNT TYPE. See the comment on
-- transactions.direction below.
-- =========================================================================

COMMENT ON COLUMN "financial_accounts"."available_balance" IS
  'NO CONSUMER, ON EITHER ACCOUNT TYPE. CREDIT: a limit. It touches nothing, not cash, not the P&L, not Cash Flow, because how much more a household could borrow is not a fact about their money. DEPOSITORY: RULED 21 AUG 2026, and the reason is arithmetic. `available` subtracts holds; a hold is a PENDING TRANSACTION; pending transactions are already in this ledger under transactions.pending. A consumer reading available AND counting the pending row subtracts the same money twice. current_balance plus the ledger''s pending rows is the complete picture, and available_balance is a SUMMARY OF THAT SAME FACT rather than an addition to it. Read current_balance. This supersedes 0032''s NO CONSUMER DECLARED, which recorded it as an open question.';

COMMENT ON COLUMN "account_balance_snapshots"."available_balance" IS
  'No consumer, for the same reason as financial_accounts.available_balance: on a card it is a limit, and on a depository account it is a summary of current_balance minus pending rows this ledger already holds. Captured for symmetry with the live column.';

-- THE DIRECTION RULE (Guy, 21 Aug 2026).
--
-- THE INSTRUMENT DOES NOT CHANGE WHAT A TRANSACTION MEANS. A purchase is
-- spending on a card and spending on a debit card. What the instrument changes
-- is WHEN it is recognised, which is already ruled: card purchases at
-- transaction, installment loans as payments land.
--
--   Card, not a payment or refund   -> spending
--   Depository debit, not a payment -> spending
--   Depository credit               -> income, unless refund or reimbursement
--   Card credit                     -> NEVER income. Payment (transfer) or
--                                      refund (nets against spending).
--
-- THE LAST LINE IS THE HAZARD, AND IT IS NOT HYPOTHETICAL. A card payment
-- appears TWICE: a debit on checking and a credit on the card. Both are
-- transfer. Applied BY SIGN ALONE the same event registers as spending and
-- income simultaneously, inflating both sides of the P&L and leaving Kept
-- unchanged, WHICH IS THE VERSION THAT LOOKS PLAUSIBLE, because the number the
-- household reads does not move.
--
-- Same shape as the balance finding one migration ago: a rule correct within
-- one account type, inverting across another, with a column name that reads as
-- uniform.
COMMENT ON COLUMN "transactions"."direction" IS
  'THE SIGN OF PLAID''S amount DOES NOT DETERMINE THIS, and deriving it from the sign alone is wrong on every credit account. Plaid signs money leaving an account positive, so on a DEPOSITORY account a negative is income. ON A CARD a negative is a PAYMENT or a REFUND and is NEVER income: a payment is a transfer, and a refund nets against spending. A card payment appears twice, as a debit on checking and a credit on the card, and both sides are transfer; scored by sign alone it books as spending and income at once, which inflates both sides of the P&L while leaving Kept unchanged and therefore looks right. THE ENUM HAS THREE VALUES AND transfer IS ONE OF THEM. Any writer of this column must know the account TYPE, and the payment-versus-refund distinction is M5''s filing decision rather than the pipeline''s.';
