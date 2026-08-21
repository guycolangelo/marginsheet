// ONE CONSUMER PER BALANCE COLUMN, enforced by reach rather than by wording.
//
// THE RULE (Guy, 21 Aug 2026, CLAUDE.md). Each balance column has exactly one
// consumer, and THE HAZARD IS A COLUMN BEING READ BY SOMETHING THAT WANTS A
// DIFFERENT ONE.
//
//   current (depository)    -> the cash position, Cash Flow's starting point
//   current (credit)        -> reconciliation only
//   last_statement_balance  -> Cash Flow's committed outflow, with its due date
//   available (credit)      -> nothing
//   available (depository)  -> nothing; it is a SUMMARY of current minus the
//                              pending rows this ledger already holds, so a
//                              consumer reading both subtracts the same money
//                              twice (0033)
//
// WHY THIS EXISTS AS A MODULE AND NOT AS A CONVENTION. The first draft of the
// rule was a vocabulary ban: never combine cash and owed, never present cash as
// spendable. Both true, and both a rule a reader has to remember. IT NAMED THE
// FAILURE INSTEAD OF LOCATING IT. Saying where each column may be read is a
// thing a type can carry, and this file is the top rung of the ladder this
// codebase states everywhere else: type, then runtime check, then comment.
//
// WHAT THE TYPE CANNOT DO, SAID PLAINLY. SQL is a string and no type reaches
// inside it, so a route can still write `select current_balance` and never
// touch this module. That half is a repo scan, and the two together are the
// control; neither is sufficient and saying so is part of the design rather
// than an apology for it.
//
// THE ARITHMETIC IS WHY A TYPE-BLIND CONSUMER COMPUTES WRONGLY rather than
// merely misleading. Depository spending DECREASES current; credit spending
// INCREASES it. A reconciliation that subtracts before knowing the type reports
// permanent drift on every card, AND THE DRIFT LOOKS LIKE A SYNC FAULT RATHER
// THAN A SIGN ERROR, which is what makes it expensive.

/** The account shape these accessors need. Deliberately minimal: anything
 *  wider invites a caller to pass a row through and read a column off it. */
export interface BalanceBearingAccount {
  type: string | null;
  /** Raw, and it means money HELD on a depository account and money OWED on a
   *  card, which is why every consumer goes through an accessor below rather
   *  than reading it. Enforced by balance-columns-have-one-reader.test.ts for
   *  SQL sites and by the branded return types here for TypeScript callers. */
  currentBalance: string | null;
}

export interface LiabilityStatement {
  lastStatementBalance: string | null;
  nextPaymentDueDate: string | null;
}

declare const brand: unique symbol;
/** A figure tagged with the ONE consumer entitled to it. Two branded values
 *  with different consumers do not unify, so a reconciliation figure cannot be
 *  passed where a cash figure is expected even though both are numbers. */
export type For<C extends string> = number & { readonly [brand]: C };

/** Cash the household HOLDS. Depository `current`, summed.
 *
 *  A POSITION, NOT SPENDING POWER. What is spendable depends on what is
 *  committed against it and on when, which is Cash Flow's question and is
 *  answered by a path rather than by a number. Nothing here answers "can I
 *  afford this" and the type name does not pretend otherwise. */
export function cashPosition(accounts: readonly BalanceBearingAccount[]): For<"cash-position"> {
  let total = 0;
  for (const a of accounts) {
    if (a.type !== "depository") continue;
    total += Number(a.currentBalance ?? 0);
  }
  return round(total) as For<"cash-position">;
}

/** What the household OWES on cards. Credit `current`, summed, rendered
 *  POSITIVE as a debt.
 *
 *  NEVER COMBINED WITH CASH into a single figure: not as net worth, not as
 *  total balance, not as spending power. A household holding $1,539 and owing
 *  $3,055 is not at negative $1,516; those are two facts with two different
 *  consequences.
 *
 *  A NEGATIVE CARD BALANCE IS A CREDIT BALANCE AND IS NOT OWED. Production
 *  carries one: a Business Gold Card at -1305.28, which is money the issuer
 *  holds for the household. It is excluded rather than netted, because netting
 *  it against another card's debt would state that one card's overpayment
 *  reduces another card's bill, which is not true of any payment anybody will
 *  make. */
export function owed(accounts: readonly BalanceBearingAccount[]): For<"owed"> {
  let total = 0;
  for (const a of accounts) {
    if (a.type !== "credit") continue;
    const v = Number(a.currentBalance ?? 0);
    if (v > 0) total += v;
  }
  return round(total) as For<"owed">;
}

/** Credit balances the ISSUER holds for the household, rendered positive.
 *
 *  Separate from `owed` for the reason above, and reported rather than netted
 *  so a surface can say which it is. Zero for almost every household. */
export function creditBalanceHeld(accounts: readonly BalanceBearingAccount[]): For<"credit-balance-held"> {
  let total = 0;
  for (const a of accounts) {
    if (a.type !== "credit") continue;
    const v = Number(a.currentBalance ?? 0);
    if (v < 0) total += -v;
  }
  return round(total) as For<"credit-balance-held">;
}

/** The raw `current` of ANY account, for RECONCILIATION AND NOTHING ELSE.
 *
 *  ITS FIRST CONSUMER FOUND A GAP IN THE ONE-CONSUMER TABLE, and the fix is a
 *  word rather than an exception. The table reads "current (credit) ->
 *  reconciliation only" and "current (depository) -> the cash position", which
 *  is right about what each figure MEANS. 4.6 reconciles depository accounts
 *  too: the observation the whole design rests on is SoFi Checking moving
 *  1731.96 to 1579.96 against one transaction of 152.00.
 *
 *  SO RECONCILIATION IS NOT A SECOND CONSUMER OF THE MEANING. It reads the
 *  column to VERIFY it and never to interpret it, which is a different act from
 *  reading depository current AS CASH. The brand is what keeps them apart: a
 *  reconciliation figure cannot be passed anywhere a cash figure is expected,
 *  so this function cannot become a back door to the column.
 *
 *  On a card this is the live running total, statement plus everything charged
 *  since, which is the right thing to check a running total against and the
 *  wrong thing for anything else BECAUSE IT IS NOT WHAT ANY PAYMENT WILL BE.
 *  Cash Flow wants committedOutflow. */
export function forReconciliation(account: BalanceBearingAccount): For<"reconciliation"> | null {
  if (account.currentBalance == null) return null;
  const v = Number(account.currentBalance);
  if (!Number.isFinite(v)) return null;
  return round(v) as For<"reconciliation">;
}

/** What `current` SHOULD read, given where it was and what moved since.
 *
 *  THE SIGN INVERTS ACROSS ACCOUNT TYPE AND THAT IS WHY THIS IS HERE RATHER
 *  THAN IN A TERNARY AT THE CALL SITE. Depository spending DECREASES current;
 *  credit spending INCREASES it, because the card's balance is a debt. A
 *  reconciliation that subtracts before knowing the type reports permanent
 *  drift on every card, AND THE DRIFT LOOKS LIKE A SYNC FAULT RATHER THAN A
 *  SIGN ERROR, which is what makes it expensive rather than merely wrong.
 *
 *  `outflow` and `inflow` are sums of transactions.amount, which is stored
 *  absolute, grouped by transactions.flow. Both are positive magnitudes here
 *  and the direction is supplied entirely by the account type. */
export function expectedBalance(
  account: BalanceBearingAccount,
  previous: For<"reconciliation">,
  outflow: number,
  inflow: number
): For<"reconciliation"> | null {
  if (account.type === "depository") {
    return round(previous + inflow - outflow) as For<"reconciliation">;
  }
  if (account.type === "credit") {
    return round(previous + outflow - inflow) as For<"reconciliation">;
  }
  // Investment and anything else: no reconciliation. Plaid reports 0.00 for
  // investment accounts holding real money, so an expected figure computed from
  // it would be arithmetic on a number we already know is not the balance.
  return null;
}

/** Cash Flow's COMMITTED OUTFLOW: a known amount on a known date.
 *
 *  This is what the payment will be, which is why it renders as COMMITTED
 *  rather than estimated, and it is why the cards were connected. It comes from
 *  Plaid Liabilities.
 *
 *  BOTH HALVES OR NEITHER. An amount with no date and a date with no amount are
 *  both uncommittable, and Cash Flow's whole question is WHEN. Returning null
 *  rather than a partial pair is what stops a surface rendering a figure it
 *  cannot place on a calendar. */
export function committedOutflow(
  statement: LiabilityStatement
): { amount: For<"committed-outflow">; dueDate: string } | null {
  if (statement.lastStatementBalance == null || statement.nextPaymentDueDate == null) return null;
  const amount = Number(statement.lastStatementBalance);
  if (!Number.isFinite(amount)) return null;
  return { amount: round(amount) as For<"committed-outflow">, dueDate: statement.nextPaymentDueDate };
}

// NO ACCESSOR EXISTS FOR available_balance ON EITHER TYPE, OR FOR credit_limit,
// AND THAT ABSENCE IS THE CONTROL.
//
// On a card, `available` is a limit: how much more a household could borrow is
// not a fact about their money, and rendering it near a cash figure would imply
// otherwise. On a depository account it is `current` minus holds, and A HOLD IS
// A PENDING TRANSACTION THIS LEDGER ALREADY CARRIES, so a consumer reading both
// subtracts the same money twice.
//
// A consumer that wants either has to ADD a function here, which is a diff
// somebody reviews, rather than reading a column that was already in scope.
// That is the whole difference between this module and a comment.

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
