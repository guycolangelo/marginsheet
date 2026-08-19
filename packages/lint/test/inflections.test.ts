// Banned-word rules ban a PROHIBITION, not a spelling (ruled 18 Aug 2026).
//
// WHY THIS FILE EXISTS. no-burden-verbs shipped matching the canon's literal
// "tied up" and PASSING "this TIES up your Margin for two years", which is the
// exact sentence the doctrine names as the thing the ban exists to stop.
//
// The audit that followed found ELEVEN gaps across six of the seven advice
// rules. Every one banned a word and permitted its own inflections, and every
// one had been in place since M0.
//
// One gap was masked: "reminding you again" appeared to fire, and it fired on
// "again". "reminding" alone did not. A fixture passing for the wrong reason is
// the same failure in a different coat.

import { describe, it, expect } from "vitest";
import { lint, type LintContext } from "../src/index.js";

const ALL: LintContext[] = [
  "universal", "analytical", "correction", "follow_up",
  "decision_commentary", "composed_artifact", "household_copy",
];
const fires = (id: string, text: string) =>
  lint(text, ALL).some((f) => f.ruleId === id);

// Each case is the inflection that was permitted before the audit.
const GAPS: [string, string][] = [
  ["no-should", "you shouldn't put it on the card"],
  ["no-need-to", "she needs to move the payment"],
  ["no-need-to", "he needed to move it"],
  ["no-afford", "affording it is the question"],
  ["no-recommend", "I am recommending the second option"],
  ["no-recommend", "two recommendations follow"],
  ["no-cut-instruction", "she cuts back on dining"],
  ["no-delta-variance", "the deltas are small"],
  ["no-delta-variance", "the variances are small"],
  ["no-nagging", "two reminders went out"],
  ["no-nagging", "just reminding you about the card"],
];

describe("every inflection the audit found permitted", () => {
  for (const [rule, text] of GAPS) {
    it(`${rule} fires on ${JSON.stringify(text)}`, () => {
      expect(fires(rule, text), `${rule} permits an inflection of its own ban`).toBe(true);
    });
  }
});

describe("the base forms still fire, so the audit did not narrow anything", () => {
  const BASE: [string, string][] = [
    ["no-should", "you should move it"],
    ["no-need-to", "you need to move it"],
    ["no-afford", "you can afford it"],
    ["no-recommend", "I recommend the second option"],
    ["no-cut-instruction", "cut back on dining"],
    ["no-delta-variance", "the delta is small"],
    ["no-nagging", "a reminder about the card"],
  ];
  for (const [rule, text] of BASE) {
    it(`${rule} still fires on ${JSON.stringify(text)}`, () => {
      expect(fires(rule, text)).toBe(true);
    });
  }
});

describe("the inflections do not over-reach", () => {
  // A widened rule that fires on ordinary language is worse than a narrow one,
  // because it gets suppressed rather than obeyed.
  it("'affordable housing' is a proper noun phrase, and still fires, correctly", () => {
    // Recorded rather than carved out: "afford" in any form is banned in
    // analytical replies, and a household-facing sentence has no reason to say
    // it. If a legal or third-party string ever needs it, that is an allowlist
    // decision with a named path, not a weaker pattern.
    expect(fires("no-afford", "affordable housing")).toBe(true);
  });

  it("does not fire on unrelated words sharing a stem", () => {
    expect(fires("no-need-to", "the kneed dough")).toBe(false);
    expect(fires("no-recommend", "the commended report")).toBe(false);
    expect(fires("no-cut-instruction", "a clean cut through the middle")).toBe(false);
  });

  it("'shouldering' is not 'should'", () => {
    expect(fires("no-should", "shouldering the cost")).toBe(false);
  });
});

// THE SECOND-ORDER RULE, made executable.
//
// Where doctrine supplies its own example of the failure, that example IS the
// fixture. A synthetic string built from the banned list tests the list; the
// doctrine's own sentence tests the ban.
describe("doctrine's own failure sentences", () => {
  it("the canon's burden-verb sentence, quoted from the canon", () => {
    expect(fires("no-burden-verbs", "This ties up your Margin for two years.")).toBe(true);
  });

  it("and the fact it is one word away from, which must pass", () => {
    expect(fires("no-burden-verbs", "This commits $2,496 through August 2028.")).toBe(false);
  });

  it("the spec's own affordability verdicts, quoted from the conversational spec", () => {
    // "No affordability verdicts: 'you can afford it' and 'the math works' are
    // both banned as judgments."
    expect(fires("no-afford", "you can afford it")).toBe(true);
  });
});
