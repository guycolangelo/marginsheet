import { describe, it, expect } from "vitest";
import { lint } from "../src/index.js";

const ids = (text: string, contexts?: Parameters<typeof lint>[1]) =>
  lint(text, contexts).map((f) => f.ruleId);

describe("universal rules", () => {
  it("flags em dashes anywhere, including code comments", () => {
    expect(ids("const x = 1; // fine — but this comment is not")).toContain("no-em-dash");
    expect(ids("no dashes here, commas do the work")).toEqual([]);
  });

  it("flags Commandments", () => {
    expect(ids("The Ten Commandments of money")).toContain("no-commandments");
  });

  it("requires quotation marks on budgeting apps", () => {
    expect(ids("unlike budgeting apps, we keep books")).toContain("budgeting-apps-quoted");
    expect(ids('unlike "budgeting apps", we keep books')).toEqual([]);
  });

  it("bans AI appended to the marks", () => {
    expect(ids("MyKeeper AI watches your books")).toContain("no-ai-on-marks");
    expect(ids("MyKeeper™ AI watches your books")).toContain("no-ai-on-marks");
    expect(ids("MyKeeper™ watches your books")).toEqual([]);
  });

  it("requires numerals for day counts", () => {
    expect(ids("the first fourteen days")).toContain("day-counts-numeric");
    expect(ids("the first 14 days")).toEqual([]);
  });

  it("enforces negative Margin parentheses", () => {
    expect(ids("Margin was -6%")).toContain("negative-margin-format");
    expect(ids("Margin was (6%)")).toEqual([]);
  });

  it("enforces positive Overspent rendering", () => {
    expect(ids("you kept -$120")).toContain("negative-dollar-format");
    expect(ids("Overspent $120")).toEqual([]);
  });

  it("requires the % symbol on Margin figures", () => {
    expect(ids("Margin of 6 this month")).toContain("margin-needs-percent");
    expect(ids("Margin of 6% this month")).toEqual([]);
  });
});

describe("analytical rules", () => {
  const analytical = ["universal", "analytical"] as const;

  it("bans should, need to, afford, recommend", () => {
    expect(ids("you should move the payment", [...analytical])).toContain("no-should");
    expect(ids("you need to slow down", [...analytical])).toContain("no-need-to");
    expect(ids("you can afford this", [...analytical])).toContain("no-afford");
    expect(ids("we recommend waiting", [...analytical])).toContain("no-recommend");
  });

  it("bans cut as instruction but not as noun", () => {
    expect(ids("cut back on dining", [...analytical])).toContain("no-cut-instruction");
    expect(ids("a clean cut between months", [...analytical])).toEqual([]);
  });

  it("does not apply analytical rules outside analytical context", () => {
    expect(ids("you should move the payment")).toEqual([]);
  });
});

describe("Net Worth Doctrine", () => {
  describe("rule 2: never celebrated, in any channel, ever", () => {
    for (const text of [
      "Congratulations, your net worth just crossed $500,000.",
      "Your net worth hit a new milestone this month.",
      "Great job, net worth is at an all-time high.",
      "Net worth reached a record high. Nice work.",
      "You've crossed a threshold and your net-worth is climbing. Well done.",
      "Proud of where your networth landed this quarter.",
    ]) {
      it(`flags: ${text.slice(0, 48)}`, () => {
        expect(ids(text)).toContain("no-net-worth-celebration");
      });
    }

    it("does not fire on neutral net worth reporting, which the Balance Sheet needs", () => {
      expect(ids("Net worth is $412,300 as of 15 August.")).toEqual([]);
      expect(ids("Assets $600,000, liabilities $187,700, net worth $412,300.")).toEqual([]);
    });

    it("does not fire on celebrating Margin, the one number that may be celebrated", () => {
      expect(ids("Margin was 22% in July, your best month yet.")).toEqual([]);
      expect(ids("Great job: you kept $2,140 in July.")).toEqual([]);
    });

    it("does not fire when celebration and net worth are in different sentences", () => {
      // The violation is praise ATTACHED to net worth. A digest may celebrate
      // Margin in one sentence and report net worth in another.
      expect(
        ids("Margin was 22% in July. Nice work. Net worth is reported below.")
      ).not.toContain("no-net-worth-celebration");
    });
  });

  describe("rule 1: never the lead figure of a composed deliverable", () => {
    const artifact = ["universal", "composed_artifact"] as const;

    it("flags net worth in the opening sentence", () => {
      expect(ids("Net worth is $412,300. You kept $2,140 in July.", [...artifact])).toContain(
        "no-net-worth-lead"
      );
    });

    it("flags a net worth heading", () => {
      expect(ids("# Net worth\n\nYou kept $2,140.", [...artifact])).toContain(
        "no-net-worth-lead"
      );
    });

    it("permits net worth reported after the opening", () => {
      expect(ids("You kept $2,140 in July. Net worth is $412,300.", [...artifact])).toEqual([]);
      expect(
        ids("You kept $2,140 in July.\n\nNet worth is $412,300.", [...artifact])
      ).toEqual([]);
    });

    it("does not bind outside composed artifacts", () => {
      // A schema comment or an internal note may open with the term.
      expect(ids("Net worth is a computed line on the Balance Sheet.")).toEqual([]);
    });
  });
});

describe("scoped rules", () => {
  it("correction context bans delta, variance, discrepancy", () => {
    expect(ids("a small variance in March", ["correction"])).toContain("no-delta-variance");
  });

  it("follow-up context bans nagging", () => {
    expect(ids("reminder: the form is open", ["follow_up"])).toContain("no-nagging");
    expect(ids("you still haven't filed it", ["follow_up"])).toContain("no-nagging");
  });

  it("decision commentary bans judgment", () => {
    expect(ids("good call on the refinance", ["decision_commentary"])).toContain("no-decision-judgment");
    expect(ids("that cost you $80", ["decision_commentary"])).toContain("no-decision-judgment");
  });
});
