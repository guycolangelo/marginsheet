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
// AND THE BASELINE MOVES WITH EACH OBSERVATION, WHICH MAKES THE SETTLE CHEAPER
// THAN THE PARAGRAPH ABOVE IMPLIES. Every observation records the reported
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
 *  NEITHER NUMBER HAS AN OBSERVATION BEHIND IT, unlike the 30 second Plaid
 *  deadline which had five production syncs. Three is chosen so read skew has
 *  two chances to clear. The six hour span exists because COUNTING SYNCS ALONE
 *  IS DEFECTIVE: three hand-run syncs in a minute would confirm a drift that a
 *  single settle would have cleared. Both should move the moment real data
 *  disagrees with them. */
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
}

/** Reconciles every account of one household and records one row each.
 *
 *  Runs INSIDE the sync's transaction, after the streams and the balances have
 *  been applied, so the reported balance and the transactions it is checked
 *  against come from the same sync rather than from two moments. */
export async function reconcileBalances(
  tx: Tx,
  householdId: string
): Promise<ReconciliationOutcome> {
  const accounts = (await tx`
    select fa.id, fa.type, fa.current_balance::text as current_balance
      from financial_accounts fa
     where fa.household_id = ${householdId} and fa.is_active
     order by fa.id
  `) as { id: string; type: string | null; current_balance: string | null }[];

  const out: AccountReconciliation[] = [];

  for (const row of accounts) {
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
      await record(tx, householdId, row.id, null, null, null, false);
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
      await record(tx, householdId, row.id, reported, null, null, false);
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
      await record(tx, householdId, row.id, reported, null, null, false);
      continue;
    }

    const difference = round(reported - expected);
    await record(tx, householdId, row.id, reported, expected, difference, true);

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

  return { accounts: out, driftingAccounts: out.filter((a) => a.drift).map((a) => a.accountId) };
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
