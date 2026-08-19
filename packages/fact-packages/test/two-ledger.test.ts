// The two-ledger rule (category canon v3.1, 18 Aug 2026).
//
// "Any scenario answer covers both ledgers wherever they diverge, because the
// household is asking two questions and only knows they asked one."
//
// WHAT THESE TESTS ASSERT AND WHAT THEY DELIBERATELY DO NOT.
//
// The rule is doctrine and is stated in the canon. It is NOT in the
// conversational spec under that name, and no canonical exchange demonstrates
// it. So these tests assert the CONTRACT INVARIANT the fact package already
// carries, and do not assert composed text: asserting on invented output would
// certify whatever a model produced against words nobody wrote, which is the
// exact failure `assertGoldenEligible` exists to refuse.
//
// The fact package already models the rule. ScenarioAnswer carries
// margin_ledger, cash_ledger and `ledgers_diverge`, whose own comment reads
// "true FORCES the two-ledger answer shape". That predates the canon and
// agrees with it, which is why this needed no contract change.
//
// TWO THIRDS OF THE CANON'S SCENARIO RULE IS NOT TESTABLE HERE, and that is
// reported rather than routed around. See docs/open-items.json:
//   two-ledger-spec-amendment-owed        the spec text, owed to Guy
//   scenario-tender-not-in-fact-package   tender has no field
//   financing-term-not-in-fact-package    term and total have no fields

import { describe, it, expect } from "vitest";
import { FIXTURES } from "../src/fixtures/index.js";
import type { ScenarioAnswer } from "../src/classes.js";

const scenarios = FIXTURES.filter((f) => f.messageClass === "ScenarioAnswer");
const blockOf = (f: (typeof FIXTURES)[number]) => f.package.block as ScenarioAnswer;

describe("the two-ledger invariant, on the contract that exists", () => {
  it("there are scenario fixtures at all, so this suite is not vacuous", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it("a diverging scenario MUST carry the cash ledger", () => {
    // The invariant the canon states, expressed against the field whose own
    // comment already says it forces the two-ledger shape. A fixture claiming
    // divergence with cash_ledger null describes an answer that cannot be
    // composed: the composer never computes, so a cash-timing claim with no
    // cash facts is a hard failure rather than a thin answer.
    for (const f of scenarios) {
      const block = blockOf(f);
      if (block.ledgers_diverge) {
        expect(
          block.cash_ledger,
          `${f.name} claims the ledgers diverge and carries no cash ledger, so the cash half cannot be composed`
        ).not.toBeNull();
      }
    }
  });

  it("a non-diverging scenario is permitted to answer on one ledger", () => {
    // The rule is "wherever they diverge", not "always". Debit and cash have a
    // gap of zero, and forcing a cash paragraph there would be padding.
    const single = scenarios.filter((f) => !blockOf(f).ledgers_diverge);
    for (const f of single) {
      expect(blockOf(f).margin_ledger, `${f.name} carries no Margin ledger`).toBeTruthy();
    }
  });
});

describe("the existing fixtures, flagged", () => {
  // The task asked for every existing fixture answering on one ledger to be
  // flagged. There is exactly one scenario fixture and it answers on one.
  it("inventories which scenario fixtures answer on a single ledger", () => {
    const single = scenarios.filter((f) => !blockOf(f).ledgers_diverge).map((f) => f.name);
    expect(single).toEqual(["the-car-decision"]);
  });

  it("the-car-decision declares no divergence for a purchase whose TENDER IS UNSTATED", () => {
    // THE FLAG THAT MATTERS, and it is a finding rather than a failure.
    //
    // The fixture sets ledgers_diverge false, so answering on Margin alone is
    // correct BY ITS OWN DATA. But the canon says divergence is decided by the
    // tender: debit is a gap of zero, a credit card is a one-cycle gap, an
    // installment has no lump at all. A car is the archetypal financed
    // purchase, and nothing in this fixture records how it is paid for.
    //
    // So the fixture is internally consistent and its `false` is an assumption
    // nobody stated. It is left as it is: changing it would be inventing the
    // tender, and the canon says the tender cannot be inferred and must be
    // asked. The asking beat does not exist in the conversational spec yet.
    const car = scenarios.find((f) => f.name === "the-car-decision")!;
    const block = blockOf(car);
    expect(block.ledgers_diverge).toBe(false);
    expect(block.cash_ledger).toBeNull();
    // Recorded so the assumption is visible rather than inherited: there is no
    // tender field to check, which is why this asserts its absence.
    expect(Object.keys(block).sort()).toEqual([
      "cash_ledger",
      "ledgers_diverge",
      "margin_ledger",
      "question_as_parsed",
    ]);
  });

  it("no scenario fixture is golden-eligible yet, so no text is being certified", () => {
    // Every scenario fixture is partial or owed, so the golden harness refuses
    // them. Asserted here so a future full fixture cannot quietly acquire
    // two-ledger expectations nobody wrote.
    expect(scenarios.every((f) => f.status !== "full")).toBe(true);
  });
});

describe("what the contract cannot express, asserted so the gap is visible", () => {
  it("carries no tender field, so 'establish tender before a cash claim' is untestable", () => {
    const car = blockOf(scenarios[0]);
    expect("tender" in car).toBe(false);
  });

  it("carries no term or total field, so a financing verdict cannot be composed", () => {
    // The canon: "$104 a month for 24 months is not '3 points this month'. It
    // is $2,496 through August 2028." CLAUDE.md: "every number traces to a
    // fact-package field or it is a hard failure." Both cannot hold at once
    // with this contract, and adding the fields is a fact-package change,
    // which this task refuses by default.
    const block = blockOf(scenarios[0]);
    expect("term_months" in block).toBe(false);
    expect("total_of_payments" in block).toBe(false);
    expect(Object.keys(block.margin_ledger).sort()).toEqual([
      "kept_after",
      "kept_before",
      "margin_after",
      "margin_before",
    ]);
  });
});
