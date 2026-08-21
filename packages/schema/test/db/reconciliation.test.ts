// The reconciler, EXECUTED, including the settle that looks like a drift.
//
// WHY A DATABASE TEST. Every branch here is a SQL statement against a table
// that did not exist until 0038, and a recorder proves a statement was
// constructed and nothing about whether it can execute. Three findings in one
// week in this repository had exactly that shape.
//
// IT IMPORTS reconcileBalances rather than restating its SQL, so it cannot end
// up agreeing with a copy of the queries instead of the queries.
//
// THE FIXTURE CONSTRUCTS BOTH ACCOUNT TYPES IN EVERY ARITHMETIC CASE, because
// the whole point is that the sign inverts, and a fixture of one type cannot
// tell a correct reconciliation from one that ignores type.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { reconcileBalances } from "../../../../services/sync/src/reconcile-balances.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-3000-7000-8000-00000000d1f7";
const ITEM = "01998888-3001-7000-8000-00000000d1f7";
/** A SECOND ITEM, in a needs_reauth state, holding the account that must never
 *  be judged by the first Item's sync. Without it the whole file exercises one
 *  Item and cannot tell a scoped query from an unscoped one. */
const OTHER_ITEM = "01998888-3005-7000-8000-00000000d1f7";
const OTHER_CARD = "01998888-3006-7000-8000-00000000d1f7";
const BANK = "01998888-3002-7000-8000-00000000d1f7";
const CARD = "01998888-3003-7000-8000-00000000d1f7";

async function run(itemRowId: string = ITEM) {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    return reconcileBalances(tx as never, HOUSEHOLD, itemRowId);
  }) as never as Promise<Awaited<ReturnType<typeof reconcileBalances>>>;
}

async function setBalance(id: string, v: string) {
  await sql`update financial_accounts set current_balance = ${v} where id = ${id}`;
}

async function addTxn(accountId: string, amount: string, flow: "inflow" | "outflow", id: string) {
  await sql`
    insert into transactions (household_id, account_id, plaid_transaction_id, date, amount, flow)
    values (${HOUSEHOLD}, ${accountId}, ${id}, current_date, ${amount}, ${flow}::money_flow)
    on conflict (plaid_transaction_id) do nothing`;
}

function of(r: Awaited<ReturnType<typeof reconcileBalances>>, id: string) {
  return r.accounts.find((a) => a.accountId === id)!;
}

beforeAll(async () => {
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'recon fixture') on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id) values (${ITEM}, ${HOUSEHOLD}, 'item-recon') on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id, status)
            values (${OTHER_ITEM}, ${HOUSEHOLD}, 'item-recon-other', 'needs_reauth') on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, subtype, current_balance)
            values (${OTHER_CARD}, ${HOUSEHOLD}, ${OTHER_ITEM}, 'acct-recon-other', 'Stale Card', 'credit', 'credit card', 4321.00)
            on conflict (id) do nothing`;
  await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, subtype, current_balance)
            values (${BANK}, ${HOUSEHOLD}, ${ITEM}, 'acct-recon-bank', 'Fixture Checking', 'depository', 'checking', 1731.96),
                   (${CARD}, ${HOUSEHOLD}, ${ITEM}, 'acct-recon-card', 'Fixture Card', 'credit', 'credit card', 3000.00)
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from balance_reconciliations where household_id = ${HOUSEHOLD}`;
  await sql`delete from transactions where household_id = ${HOUSEHOLD}`;
  await sql`delete from financial_accounts where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("reconcileBalances is scoped to one Item", () => {
  it("judges only the Item it was given, and never another Item's accounts", async () => {
    // THE ASSERTION THE FIX EXISTS FOR. The first version took only a household
    // and reconciled everything it held, so a run over three Items produced
    // three verdicts on all eighteen accounts.
    const r = await run(ITEM);
    const ids = r.accounts.map((a) => a.accountId);
    expect(ids).toContain(BANK);
    expect(ids).toContain(CARD);
    expect(
      ids,
      "an account belonging to a DIFFERENT Item was judged by this Item's sync"
    ).not.toContain(OTHER_CARD);
  });

  it("writes NO observation for the other Item's account, so nothing enters its window", async () => {
    // MISATTRIBUTION IS THE SMALL HALF. A zero written by an Item that never
    // read the account is a passing observation, and the window confirms drift
    // across three CONSECUTIVE non-zero differences, so one zero BREAKS THE
    // RUN. A healthy Item's sync could clear a real drift signal on an account
    // it does not own.
    const [c] = await sql<{ n: number }[]>`
      select count(*)::int as n from balance_reconciliations where account_id = ${OTHER_CARD}`;
    expect(c.n, "the other Item's account collected observations from this Item's sync").toBe(0);
  });

  it("still judges that account when ITS OWN Item syncs", async () => {
    // The scoping must not make an account unreachable. A needs_reauth Item
    // syncing is exactly when its accounts should be looked at.
    const r = await run(OTHER_ITEM);
    expect(r.accounts.map((a) => a.accountId)).toEqual([OTHER_CARD]);
  });
});

describe("reconcileBalances", () => {
  it("treats a first observation as NOT COMPARABLE and never as drift", async () => {
    // Absence of a prior reading is not disagreement. Counting it as one would
    // fail every account on the day it connects.
    const r = await run();
    expect(of(r, BANK).comparable).toBe(false);
    expect(of(r, BANK).drift).toBe(false);
    expect(of(r, BANK).difference).toBeNull();
    expect(r.driftingAccounts).toEqual([]);
  });

  it("reconciles a DEPOSITORY account to the cent when an outflow lands", async () => {
    // The production observation the design rests on: SoFi Checking 1731.96 to
    // 1579.96 against one transaction of 152.00.
    await addTxn(BANK, "152.00", "outflow", "recon-bank-1");
    await setBalance(BANK, "1579.96");
    const r = await run();
    expect(of(r, BANK).expected).toBe(1579.96);
    expect(of(r, BANK).difference).toBe(0);
    expect(of(r, BANK).drift).toBe(false);
  });

  it("reconciles a CREDIT account, where the same outflow moves the balance the OTHER WAY", async () => {
    // THE ASSERTION THAT MAKES THE PREVIOUS ONE MEAN SOMETHING. A reconciler
    // that ignored type would pass the depository case and report permanent
    // drift here, and the drift would read as a sync fault rather than a sign
    // error, which is what makes it expensive.
    await addTxn(CARD, "100.00", "outflow", "recon-card-1");
    await setBalance(CARD, "3100.00");
    const r = await run();
    expect(of(r, CARD).expected).toBe(3100);
    expect(of(r, CARD).difference).toBe(0);
  });

  it("a card PAYMENT reduces the balance", async () => {
    await addTxn(CARD, "500.00", "inflow", "recon-card-2");
    await setBalance(CARD, "2600.00");
    const r = await run();
    expect(of(r, CARD).difference).toBe(0);
  });

  it("A ONE-OFF DISCREPANCY SHOWS ONCE AND CLEARS, because the baseline moves with it", async () => {
    // FOUND BY THIS TEST FAILING, AND THE CODE WAS RIGHT. The first version
    // moved the balance once and expected the difference to stay non-zero
    // across four observations. It does not: each observation RECORDS the
    // reported balance, so the next comparison starts from it.
    //
    // THAT IS THE DESIGN AND IT IS A STRENGTH. The check compares the CHANGE
    // over an interval, so an unexplained jump disagrees exactly once and the
    // next interval is clean. A settle therefore clears after ONE observation
    // rather than needing all three, and the window is there for the case where
    // every interval disagrees, which is a systematic fault rather than a
    // moment of skew.
    await setBalance(BANK, "1500.00");
    const first = await run();
    expect(first.accounts.find((a) => a.accountId === BANK)!.difference).toBe(-79.96);
    expect(of(first, BANK).drift).toBe(false);

    const second = await run();
    expect(of(second, BANK).difference, "the baseline should have moved to 1500.00").toBe(0);
  });

  it("three observations inside one second do NOT confirm, however wrong each one is", async () => {
    // A GENUINE PERSISTENT DRIFT: the balance moves every interval with no
    // transactions to explain it, which is what a systematic fault looks like.
    // Three of them in a second must still not confirm, which is exactly why
    // the window has a SPAN and not only a count. Counting syncs alone would
    // let three hand-run syncs in a minute confirm a drift a settle would have
    // cleared.
    for (const v of ["1400.00", "1300.00", "1200.00"]) {
      await setBalance(BANK, v);
      const r = await run();
      expect(of(r, BANK).difference, "each interval should disagree").not.toBe(0);
      expect(
        of(r, BANK).drift,
        "three observations inside one second confirmed a drift; the 6 hour span is not being enforced"
      ).toBe(false);
    }
  });

  it("CONFIRMS once the window has both the count and the span", async () => {
    // THE WINDOW IS CONSTRUCTED EXPLICITLY RATHER THAN BY BACKDATING WHATEVER
    // ROWS HAPPENED TO EXIST. The first version backdated the two most recent
    // non-zero rows, which left an earlier ZERO-difference row inside the top
    // three, and the window correctly refused. That failure was the control
    // working; the fixture was the thing that could not express the case.
    // THE TRANSACTIONS GO TOO, and forgetting them is what the previous run
    // caught: the 152.00 outflow from an earlier test has created_at of NOW,
    // which is after a row backdated eight hours, so it was counted and the
    // difference came out -48 rather than -200. Backdating one side of a
    // comparison and not the other is a fixture that describes a moment that
    // never existed.
    await sql`delete from balance_reconciliations where account_id = ${BANK} and household_id = ${HOUSEHOLD}`;
    await sql`delete from transactions where account_id = ${BANK} and household_id = ${HOUSEHOLD}`;
    await sql`
      insert into balance_reconciliations
        (household_id, account_id, observed_at, reported_balance, expected_balance, difference, comparable)
      values
        (${HOUSEHOLD}, ${BANK}, now() - interval '9 hours', 1400.00, 1500.00, -100.00, true),
        (${HOUSEHOLD}, ${BANK}, now() - interval '8 hours', 1200.00, 1400.00, -200.00, true)`;

    // The third observation is REAL, through the module, so the confirmation
    // path is exercised rather than asserted about synthetic rows alone.
    await setBalance(BANK, "1000.00");
    const r = await run();
    expect(of(r, BANK).difference, "expected 1200 from the newest prior row").toBe(-200);
    expect(of(r, BANK).drift, "3 non-zero observations spanning 8 hours").toBe(true);
    expect(r.driftingAccounts).toContain(BANK);
  });

  it("REFUSES with three non-zero observations that do not span six hours", async () => {
    // THE MINIMAL MUTATION OF THE CASE ABOVE: same count, same non-zero
    // differences, only the span removed. Without this, the confirming test
    // passes against a window that checks the count alone.
    await sql`delete from balance_reconciliations where account_id = ${BANK} and household_id = ${HOUSEHOLD}`;
    await sql`delete from transactions where account_id = ${BANK} and household_id = ${HOUSEHOLD}`;
    await sql`
      insert into balance_reconciliations
        (household_id, account_id, observed_at, reported_balance, expected_balance, difference, comparable)
      values
        (${HOUSEHOLD}, ${BANK}, now() - interval '20 minutes', 1400.00, 1500.00, -100.00, true),
        (${HOUSEHOLD}, ${BANK}, now() - interval '10 minutes', 1200.00, 1400.00, -200.00, true)`;
    await setBalance(BANK, "1000.00");
    const r = await run();
    expect(of(r, BANK).difference).toBe(-200);
    expect(of(r, BANK).drift, "30 minutes is not 6 hours").toBe(false);
  });

  it("does not reconcile an investment account rather than drifting on a 0.00 it distrusts", async () => {
    const INV = "01998888-3004-7000-8000-00000000d1f7";
    await sql`insert into financial_accounts (id, household_id, plaid_item_id, plaid_account_id, name, type, subtype, current_balance)
              values (${INV}, ${HOUSEHOLD}, ${ITEM}, 'acct-recon-inv', 'Fixture IRA', 'investment', 'ira', 0.00)
              on conflict (id) do nothing`;
    const r = await run();
    expect(of(r, INV).comparable).toBe(false);
    expect(of(r, INV).drift).toBe(false);
  });
});
