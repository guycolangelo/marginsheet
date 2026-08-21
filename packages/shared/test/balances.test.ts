// The accessors, and the brand that stops one consumer's figure reaching
// another.
//
// THE FIXTURE HAS TO CONTAIN THE FAILING SHAPE OR IT PROVES ONE BRANCH. Every
// case below mixes account types deliberately, because a fixture of only
// depository accounts cannot tell a correct cashPosition from one that sums
// everything, which is this codebase's ninth finding.

import { describe, it, expect } from "vitest";
import {
  cashPosition, owed, creditBalanceHeld, forReconciliation, committedOutflow,
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

  it("returns null for a depository account rather than its balance", () => {
    // A number here would be a cash figure wearing a reconciliation brand,
    // which is the exact confusion the brand exists to prevent.
    expect(forReconciliation({ type: "depository", currentBalance: "1539.96" })).toBeNull();
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
