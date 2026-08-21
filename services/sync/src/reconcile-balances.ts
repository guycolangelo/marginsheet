// 4.6: what the institution says against what our ledger says.
//
// WHAT IS COMPARED, AND WHY IT IS A CHANGE RATHER THAN A BALANCE. We hold 730
// days of transactions and no opening balance, so an absolute figure is not
// derivable. The CHANGE is: between two syncs, the reported balance must move
// by exactly the sum of the transactions written in that interval.
//
// ZERO TOLERANCE, WITH A SETTLING WINDOW. A tolerance is a claim about how
// wrong a figure may be before we stop trusting it, and any non-zero number is
// a guess about an error nobody has observed. Every failure we expect is TIMING
// rather than MAGNITUDE, so a dollar threshold answers the wrong axis: it hides
// small real errors permanently while doing nothing about the transient ones it
// was chosen for.
//
// THE LIMITATION, WITH ITS CONSEQUENCE, BECAUSE THE CONSEQUENCE IS WHAT A
// READER NEEDS (Guy, 21 Aug 2026).
//
// The sum is keyed on transactions.created_at, so it counts rows WRITTEN since
// the last observation. A transaction created BEFORE that observation and
// MODIFIED after it, which is a pending amount changing, moves the reported
// balance without moving the sum. IT THEREFORE REGISTERS AS DRIFT, for up to
// three observations, before the window clears it.
//
// SO THE FIRST DRIFT MOST HOUSEHOLDS EVER SEE WILL BE A SETTLE RATHER THAN AN
// ERROR, and whoever reads the first alert should know that before they
// diagnose it. Chasing it would be tuning for the case the window already
// covers, which is why the design stands and this paragraph exists instead.
//
// AND THE BASELINE MOVES WITH EACH OBSERVATION, WHICH IS WHY THE SETTLE NEVER
// REACHES THE WINDOW AT ALL. Every observation records the reported
// balance, so the next comparison starts from it: an unexplained jump disagrees
// EXACTLY ONCE and the following interval is clean. A settle therefore clears
// after one observation rather than needing all three.
//
// The window is not there for the settle. It is there for the case where EVERY
// interval disagrees, which is a systematic fault rather than a moment of skew,
// and that distinction is what makes three consecutive non-zero differences
// mean something rather than being three views of one event.
//
// THIS WAS FOUND BY A TEST FAILING AND THE CODE WAS RIGHT. The test moved a
// balance once and expected the disagreement to persist. Recorded because the
// first reading of a non-zero difference will otherwise be "it will keep
// disagreeing until somebody fixes it", which is false.
//
// THAT IS NOW TESTABLE RATHER THAN THEORETICAL. transactions.settled_at exists
// as of 0037, nine pending rows existed across three institutions when this was
// written, and webhooks are live on all three so the settle fires unattended.
// THE FIRST REAL DRIFT AND THE FIRST REAL SETTLE ARE PLAUSIBLY THE SAME EVENT,
// and the window absorbing it is the acceptance test for both.

import { expectedBalance, forReconciliation, type BalanceBearingAccount } from "@marginsheet/shared/balances";

/** The same narrow slice apply-streams declares, imported rather than restated:
 *  two modules with their own idea of what a transaction handle is drift by
 *  default, and the sync passes ONE handle to both. */
import type { Tx } from "./apply-streams.js";

/** Three consecutive comparable observations, spanning at least six hours.
 *
 *  THE NUMBERS WERE CHOSEN AGAINST THE WRONG CASE, AND THIS IS THE CORRECTED
 *  ARGUMENT RATHER THAN A CLARIFICATION OF THE OLD ONE (Guy, 21 Aug 2026).
 *
 *  AS RULED: the window absorbs transients, three gives read skew two chances
 *  to clear, and settles are the case it exists for. THAT REASONING IS WRONG.
 *  The baseline moves with every observation, so a settle disagrees exactly
 *  once and the next interval is clean: it never needed a window at all.
 *
 *  WHAT THE WINDOW IS ACTUALLY FOR: a SYSTEMATIC fault, where every interval
 *  disagrees. Transactions we never receive, a fee or interest the institution
 *  applies outside the feed, a removed row we mishandle, a sign that is wrong
 *  for a type. Those do not clear, because each interval brings a fresh
 *  disagreement rather than one event seen repeatedly.
 *
 *  SO THE QUESTION CHANGED. Not "how long does a transient take to clear" but
 *  "how many intervals make a fault persistent rather than coincidental".
 *
 *  THREE SURVIVES THE NEW ARGUMENT AND FOR A DIFFERENT REASON, which is the
 *  distinction worth keeping: since a settle clears in one, a second
 *  consecutive non-zero means two INDEPENDENT transients, and on an account
 *  with six pending rows that is unremarkable. A third makes coincidence a
 *  poor explanation. Two arguments, one number, and only one of them true.
 *
 *  THE SPAN ALSO SURVIVES AND ALSO GUARDS SOMETHING ELSE. It no longer buys
 *  time for a transient to clear. It stops an institution FLAPPING inside a
 *  short period from confirming a fault: a balance alternating between two
 *  values across rapid reads produces a non-zero difference every time,
 *  because the baseline chases it, and three of those are one condition rather
 *  than three intervals of activity.
 *
 *  NEITHER NUMBER IS MEASURED, and that was true under the old argument too.
 *  The 30 second Plaid deadline had five production syncs behind it; these have
 *  reasoning behind them and should move the moment real data disagrees. */
export const DRIFT_OBSERVATIONS = 3;
export const DRIFT_SPAN_MS = 6 * 60 * 60 * 1000;

export interface AccountReconciliation {
  accountId: string;
  type: string | null;
  reported: number | null;
  expected: number | null;
  difference: number | null;
  comparable: boolean;
  /** Confirmed by the window, not by this observation alone. */
  drift: boolean;
  note: string;
}

export interface ReconciliationOutcome {
  accounts: AccountReconciliation[];
  driftingAccounts: string[];
  /** ROWS ACTUALLY WRITTEN to balance_reconciliations, named because nothing
   *  named it before and a reading was built on that absence.
   *
   *  IT IS NOT EQUAL TO accountsRefreshed AND THE DIFFERENCE IS EXACT: this is
   *  the refreshed accounts MINUS the investment ones, which are refreshed and
   *  deliberately never reconciled because Plaid reports 0.00 for them while
   *  they hold real money. Any other gap between the two numbers is a defect.
   *
   *  WHY IT DID NOT EXIST BEFORE. balanceWritesIssued counts
   *  account_balance_snapshots upserts and reconciliation rows live in
   *  balance_reconciliations, so reading one against the other compared a count
   *  to a population it was never counting. Naming this makes the comparison
   *  possible instead of tempting. */
  observationsWritten: number;
}

/** Reconciles the accounts OF ONE ITEM and records one row each.
 *
 *  Runs INSIDE the sync's transaction, after the streams and the balances have
 *  been applied, so the reported balance and the transactions it is checked
 *  against come from the same sync rather than from two moments.
 *
 *  SCOPED TO THE ITEM, AND THE FIRST VERSION WAS NOT. It took only a household
 *  and reconciled every account the household holds, so a run over three Items
 *  produced three verdicts on all eighteen accounts and Chase's block rendered
 *  judgements on SoFi's cards.
 *
 *  MISATTRIBUTION IS THE SMALL HALF. THE LARGE HALF IS THAT A RECONCILIATION
 *  ONLY MEANS ANYTHING FOR AN ACCOUNT WHOSE BALANCE WAS JUST READ. The check
 *  asks whether a reported balance moved by the transactions we saw. An account
 *  belonging to an Item that did not sync has a balance from some earlier
 *  moment and no new transactions, so `expected` equals `previous` equals
 *  `reported` and it reconciles to zero. THAT IS A MEASUREMENT OF NOTHING
 *  RECORDED AS A PASSING OBSERVATION.
 *
 *  AND A PASSING OBSERVATION IS NOT INERT. The window confirms drift across
 *  three consecutive NON-ZERO differences, so a zero written by an Item that
 *  never looked at the account BREAKS THE RUN. A healthy Item's sync could
 *  clear a real drift signal on an account it does not own, which is the
 *  failure that made this worth fixing rather than tidying: an account under a
 *  needs_reauth Item was reconciled inside a healthy Item's sync and read as
 *  fine.
 *
 *  IT ALSO INFLATED THE WINDOW. Three Items meant three rows per account per
 *  household sync, so DRIFT_OBSERVATIONS was reachable within a single run and
 *  only the six hour span stopped it. The span was load-bearing against an
 *  artifact of our own loop rather than against an institution flapping, which
 *  is not what it was reasoned for.
 *
 *  WHY SCOPING RATHER THAN RESTRUCTURING THE READOUT. Moving reconciliation out
 *  of the per-Item loop and running it once per household would fix the nesting
 *  and keep the defect: it would still evaluate accounts whose balances were not
 *  refreshed in that run. Nesting under an itemId is CORRECT once the scope is
 *  correct, because a reconciliation observation genuinely belongs to the sync
 *  that produced the balance it reads. */
export async function reconcileBalances(
  tx: Tx,
  householdId: string,
  /** OUR row id for the Item, not Plaid's item_id. The caller already holds it:
   *  runSyncForItem takes it as a parameter and passed only the household. */
  itemRowId: string,
  /** The accounts applyBalances actually refreshed on this sync, accumulated
   *  across pages.
   *
   *  SCOPING TO THE ITEM WAS NOT ENOUGH, AND THE REASON IS THE ONE THAT MADE
   *  HOUSEHOLD SCOPE WRONG. /transactions/sync returns ONLY ACCOUNTS THAT HAVE
   *  TRANSACTIONS on a page, so a quiet account on a syncing Item is never
   *  refreshed and its balance is from some earlier moment. Reconciling it
   *  compares that stale figure against no new transactions, produces a zero,
   *  and writes a passing observation into the window.
   *
   *  IT IS NOT A RARE EDGE IN THIS HOUSEHOLD, IT IS MOST OF IT. Chase 7956 last
   *  saw a transaction in October 2025. Xmas Gifts and both investment accounts
   *  hold zero rows. Vacation holds one. Most of the eighteen accounts are quiet
   *  most of the time, so the drift criterion was being fed almost entirely by
   *  observations of accounts nobody looked at. */
  refreshedAccountIds: readonly string[]
): Promise<ReconciliationOutcome> {
  const refreshed = new Set(refreshedAccountIds);
  const accounts = (await tx`
    select fa.id, fa.type, fa.current_balance::text as current_balance
      from financial_accounts fa
     where fa.household_id = ${householdId}
       and fa.plaid_item_id = ${itemRowId}
       and fa.is_active
     order by fa.id
  `) as { id: string; type: string | null; current_balance: string | null }[];

  const out: AccountReconciliation[] = [];
  let written = 0;

  for (const row of accounts) {
    // NOT REFRESHED MEANS NOT RECONCILED, AND NO ROW AT ALL. Not a row saying
    // zero: a zero is a passing observation and the window confirms across
    // three CONSECUTIVE non-zero differences, so one breaks a real run.
    //
    // IT IS STILL REPORTED, with a note saying why, because silence and a clean
    // verdict must not look the same. That is the same treatment investment
    // accounts already get and the same failure species this module keeps
    // meeting: an absence that renders identically to an answer.
    if (!refreshed.has(row.id)) {
      out.push({ accountId: row.id, type: row.type, reported: null, expected: null, difference: null,
        comparable: false, drift: false,
        note: "not reconciled: this account's balance was not refreshed on this sync, so there is nothing new to compare. Plaid returns only accounts that have transactions on a page." });
      continue;
    }

    const account: BalanceBearingAccount = { type: row.type, currentBalance: row.current_balance };
    const reported = forReconciliation(account);

    // INVESTMENT ACCOUNTS ARE NOT RECONCILED AND THAT IS NOT AN OMISSION.
    // Plaid reports 0.00 for two of them here while they hold real money, so a
    // difference computed against that figure would be arithmetic on a number
    // already known not to be the balance, and it would drift forever.
    if (row.type !== "depository" && row.type !== "credit") {
      out.push({ accountId: row.id, type: row.type, reported, expected: null, difference: null,
        comparable: false, drift: false,
        note: "not reconciled: only depository and credit accounts carry a balance we trust" });
      continue;
    }

    if (reported === null) {
      out.push({ accountId: row.id, type: row.type, reported: null, expected: null, difference: null,
        comparable: false, drift: false,
        note: "no reported balance to compare, so this observation is not comparable" });
      await record(tx, householdId, row.id, null, null, null, false); written += 1;
      continue;
    }

    const previous = (await tx`
      select reported_balance::text as reported, (observed_at)::text as observed_at
        from balance_reconciliations
       where account_id = ${row.id} and household_id = ${householdId}
         and reported_balance is not null
       order by observed_at desc
       limit 1
    `) as { reported: string; observed_at: string }[];

    if (previous.length === 0) {
      // A FIRST OBSERVATION IS NOT A DRIFT. Absence of a prior reading is not
      // disagreement, and counting it as one would make every new account fail
      // on connection.
      out.push({ accountId: row.id, type: row.type, reported, expected: null, difference: null,
        comparable: false, drift: false,
        note: "first observation for this account: nothing to compute a change from" });
      await record(tx, householdId, row.id, reported, null, null, false); written += 1;
      continue;
    }

    const since = previous[0].observed_at;
    const moved = (await tx`
      select
        (coalesce(sum(amount) filter (where flow = 'outflow'), 0))::text as outflow,
        (coalesce(sum(amount) filter (where flow = 'inflow'), 0))::text as inflow
      from transactions
     where household_id = ${householdId} and account_id = ${row.id}
       and not removed
       and created_at > ${since}::timestamptz
    `) as { outflow: string; inflow: string }[];

    const expected = expectedBalance(
      account,
      Number(previous[0].reported) as never,
      Number(moved[0].outflow),
      Number(moved[0].inflow)
    );
    if (expected === null) {
      out.push({ accountId: row.id, type: row.type, reported, expected: null, difference: null,
        comparable: false, drift: false, note: "no expected balance for this account type" });
      await record(tx, householdId, row.id, reported, null, null, false); written += 1;
      continue;
    }

    const difference = round(reported - expected);
    await record(tx, householdId, row.id, reported, expected, difference, true); written += 1;

    const drift = difference === 0 ? false : await windowConfirms(tx, householdId, row.id);
    out.push({
      accountId: row.id, type: row.type, reported, expected, difference, comparable: true, drift,
      note:
        difference === 0
          ? "reconciled to the cent"
          : drift
            ? "CONFIRMED DRIFT: the ledger and the institution disagree about what happened in this account, across the whole window. We do not know which is wrong, so every figure derived from this account is under the same doubt rather than only the balance line."
            : "disagrees, and the window has not confirmed it. THE FIRST DISAGREEMENT A HOUSEHOLD SEES IS USUALLY A SETTLE: a pending transaction whose amount changed moves the balance without moving the created_at sum, and clears within three observations.",
    });
  }

  return {
    accounts: out,
    driftingAccounts: out.filter((a) => a.drift).map((a) => a.accountId),
    observationsWritten: written,
  };
}

/** Does the window confirm? Both halves required, and the span is why. */
async function windowConfirms(tx: Tx, householdId: string, accountId: string): Promise<boolean> {
  const recent = (await tx`
    select difference::text as difference, (observed_at)::text as observed_at
      from balance_reconciliations
     where account_id = ${accountId} and household_id = ${householdId} and comparable
     order by observed_at desc
     limit ${DRIFT_OBSERVATIONS}
  `) as { difference: string | null; observed_at: string }[];

  if (recent.length < DRIFT_OBSERVATIONS) return false;
  if (!recent.every((r) => r.difference !== null && Number(r.difference) !== 0)) return false;

  const newest = Date.parse(recent[0].observed_at);
  const oldest = Date.parse(recent[recent.length - 1].observed_at);
  return newest - oldest >= DRIFT_SPAN_MS;
}

async function record(
  tx: Tx, householdId: string, accountId: string,
  reported: number | null, expected: number | null, difference: number | null, comparable: boolean
): Promise<void> {
  await tx`
    insert into balance_reconciliations
      (household_id, account_id, reported_balance, expected_balance, difference, comparable)
    values (${householdId}, ${accountId}, ${reported}, ${expected}, ${difference}, ${comparable})
  `;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
