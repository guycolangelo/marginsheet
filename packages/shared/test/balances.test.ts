// The accessors, and the brand that stops one consumer's figure reaching
// another.
//
// THE FIXTURE HAS TO CONTAIN THE FAILING SHAPE OR IT PROVES ONE BRANCH. Every
// case below mixes account types deliberately, because a fixture of only
// depository accounts cannot tell a correct cashPosition from one that sums
// everything, which is this codebase's ninth finding.

import { describe, it, expect } from "vitest";
import {
  cashPosition, owed, creditBalanceHeld, forReconciliation, committedOutflow, expectedBalance,
} from "../src/balances.js";

// The real shape, from production on 21 Aug 2026, including the two cases that
// would be invented otherwise: a card carrying a CREDIT balance, and a
// depository available that differs from current by a live hold.
const ACCOUNTS = [
  { type: "depository", currentBalance: "1539.96" },   // SoFi Checking
  { type: "depository", currentBalance: "100.00" },    // Taxes
  { type: "credit", currentBalance: "3055.45" },       // Chase 0574
  { type: "credit", currentBalance: "5470.54" },       // Amex Blue Business
  { type: "credit", currentBalance: "-1305.28" },      // Amex Business Gold, IN CREDIT
  { type: "investment", currentBalance: "0.00" },      // reports 0.00 and holds real money
];

describe("cashPosition", () => {
  it("sums depository current and nothing else", () => {
    expect(cashPosition(ACCOUNTS)).toBe(1639.96);
  });

  it("is not the total of everything, which is what a type-blind sum would give", () => {
    // THE ASSERTION THAT MAKES THE FIRST ONE MEAN SOMETHING. Without a card and
    // an investment account in the fixture, a function that summed every row
    // would pass the test above.
    const naive = ACCOUNTS.reduce((t, a) => t + Number(a.currentBalance), 0);
    expect(cashPosition(ACCOUNTS)).not.toBe(round(naive));
  });

  it("ignores investment accounts, which report 0.00 while holding real money", () => {
    expect(cashPosition([{ type: "investment", currentBalance: "50000.00" }])).toBe(0);
  });
});

describe("owed", () => {
  it("sums credit current as a POSITIVE debt", () => {
    expect(owed(ACCOUNTS)).toBe(8525.99);
  });

  it("EXCLUDES a card in credit rather than netting it", () => {
    // A -1305.28 card is money the ISSUER holds. Netting it would state that
    // one card's overpayment reduces another card's bill, which is not true of
    // any payment anybody will make.
    expect(owed(ACCOUNTS)).toBe(3055.45 + 5470.54);
    expect(creditBalanceHeld(ACCOUNTS)).toBe(1305.28);
  });

  it("never combines with cash", () => {
    // Doctrine, asserted rather than described. A household holding 1,639.96
    // and owing 8,525.99 is not at -6,886.03, and no function here produces it.
    expect(cashPosition(ACCOUNTS) + owed(ACCOUNTS)).not.toBe(0);
    expect(Object.keys({ cashPosition, owed })).toHaveLength(2);
  });
});

describe("forReconciliation", () => {
  it("returns a card's live running total", () => {
    expect(forReconciliation({ type: "credit", currentBalance: "3055.45" })).toBe(3055.45);
  });

  it("returns a depository balance TOO, because 4.6 reconciles both", () => {
    // THIS ASSERTION WAS THE OPPOSITE YESTERDAY and the change is recorded
    // rather than quietly made. The first version refused depository accounts
    // on the grounds that depository current belongs to the cash position.
    // 4.6's first consumer showed that reconciliation reads BOTH types: the
    // observation the whole design rests on is SoFi Checking, a depository
    // account, moving by exactly one transaction.
    //
    // Reconciliation is not a second consumer of the MEANING. It reads the
    // column to VERIFY it, never to interpret it, and the brand is what keeps
    // that from becoming a back door: the returned value still cannot be passed
    // anywhere a cash figure is expected.
    expect(forReconciliation({ type: "depository", currentBalance: "1539.96" })).toBe(1539.96);
  });

  it("returns null for a missing or unparseable balance rather than 0", () => {
    // 0 would be a claim. A zero we cannot substantiate is worse than nothing,
    // which is the investment-balance rule applied one column over.
    expect(forReconciliation({ type: "credit", currentBalance: null })).toBeNull();
    expect(forReconciliation({ type: "credit", currentBalance: "n/a" })).toBeNull();
  });
});

describe("expectedBalance inverts with the account type", () => {
  const brand = (n: number) => n as never;

  it("DEPOSITORY: an outflow decreases it", () => {
    // The production observation the design rests on: SoFi Checking 1731.96 to
    // 1579.96 against one transaction of 152.00, reconciling to the cent.
    expect(expectedBalance({ type: "depository", currentBalance: null }, brand(1731.96), 152, 0))
      .toBe(1579.96);
  });

  it("CREDIT: an outflow INCREASES it, because the balance is a debt", () => {
    expect(expectedBalance({ type: "credit", currentBalance: null }, brand(3000), 100, 0))
      .toBe(3100);
  });

  it("CREDIT: an inflow decreases it, because a payment reduces the debt", () => {
    expect(expectedBalance({ type: "credit", currentBalance: null }, brand(3100), 0, 500))
      .toBe(2600);
  });

  it("the two types produce OPPOSITE results from identical inputs", () => {
    // THE ASSERTION THAT MAKES THE OTHERS MEAN SOMETHING. Each case above would
    // pass against a function that ignored type and happened to match one
    // convention; only comparing the two proves the inversion exists.
    const dep = expectedBalance({ type: "depository", currentBalance: null }, brand(1000), 200, 0);
    const cred = expectedBalance({ type: "credit", currentBalance: null }, brand(1000), 200, 0);
    expect(dep).toBe(800);
    expect(cred).toBe(1200);
    expect(dep).not.toBe(cred);
  });

  it("refuses an investment account rather than computing on a balance we distrust", () => {
    // Plaid reports 0.00 for investment accounts holding real money, so an
    // expected figure computed from it is arithmetic on a number already known
    // not to be the balance.
    expect(expectedBalance({ type: "investment", currentBalance: null }, brand(0), 10, 10)).toBeNull();
  });
});

describe("committedOutflow", () => {
  it("pairs the statement balance with its due date", () => {
    expect(committedOutflow({ lastStatementBalance: "412.10", nextPaymentDueDate: "2026-09-15" }))
      .toEqual({ amount: 412.10, dueDate: "2026-09-15" });
  });

  it("returns null when either half is missing", () => {
    // BOTH HALVES OR NEITHER. An amount with no date cannot be placed on a
    // calendar and Cash Flow's whole question is WHEN, so a partial pair is a
    // figure a surface would render and could not commit.
    expect(committedOutflow({ lastStatementBalance: "412.10", nextPaymentDueDate: null })).toBeNull();
    expect(committedOutflow({ lastStatementBalance: null, nextPaymentDueDate: "2026-09-15" })).toBeNull();
  });

  it("returns null for an unparseable amount rather than NaN", () => {
    expect(committedOutflow({ lastStatementBalance: "n/a", nextPaymentDueDate: "2026-09-15" })).toBeNull();
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
