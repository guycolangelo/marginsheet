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
const BANK = "01998888-3002-7000-8000-00000000d1f7";
const CARD = "01998888-3003-7000-8000-00000000d1f7";

async function run() {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    return reconcileBalances(tx as never, HOUSEHOLD);
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
    // Backdated so the span is real. The observations are already there and
    // already non-zero; only their spread was missing.
    // Spread the three non-zero observations the previous test created, so the
    // window has a real span. Only their spread was missing.
    await sql`
      update balance_reconciliations
         set observed_at = observed_at - interval '9 hours'
       where household_id = ${HOUSEHOLD}
         and id in (select id from balance_reconciliations
                     where account_id = ${BANK} and comparable and difference <> 0
                     order by observed_at desc limit 2)`;
    await setBalance(BANK, "1100.00");
    const r = await run();
    expect(of(r, BANK).drift, "the window has 3 non-zero observations spanning 9 hours").toBe(true);
    expect(r.driftingAccounts).toContain(BANK);
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
