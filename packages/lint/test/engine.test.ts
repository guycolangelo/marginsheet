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
