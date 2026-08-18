// The MyCFO ban: a FIXTURE PAIR, because a rule stated in prose is not
// teachable and this one has a real boundary.
//
// CLAUDE.md claimed since 15 Aug 2026 that this was enforced by packages/lint.
// It was not: the only rule naming MyCFO caught "MyCFO AI" and permitted bare
// "MyCFO" everywhere. A constitution that tells readers a check exists is worse
// than one that admits a gap, because it stops anyone looking.
//
// THE PAIR IS THE POINT. One example that must fail and one that must pass,
// side by side, so the line is teachable to whoever tunes this next: the ban is
// on COMPOSED OUTPUT, not on the string. MyCFO stays a legitimate internal
// designation.

import { describe, it, expect } from "vitest";
import { lint } from "../src/index.js";

const fires = (text: string, contexts: Parameters<typeof lint>[1]) =>
  lint(text, contexts).some((f) => f.ruleId === "no-mycfo-in-composed-output");

describe("the failing half: MyCFO reaching a household", () => {
  it("fires on a bare mention in a composed artifact", () => {
    expect(fires("MyCFO looked at your month and here is what stands out.", ["composed_artifact"])).toBe(true);
  });

  it("fires even when it reads like a helpful handoff", () => {
    // The exact sentence the two-staff model would have produced, and the one
    // the single-assistant ruling exists to prevent.
    expect(fires("I'll have MyCFO take a look at that for you.", ["composed_artifact"])).toBe(true);
  });

  it("fires with the trademark attached", () => {
    expect(fires("Your MyCFO™ Briefing is ready.", ["composed_artifact"])).toBe(true);
  });
});

describe("the passing half: the legitimate internal uses", () => {
  // The ban is on composed output. These are the surfaces the ruling
  // explicitly permits, and a rule that fired here would be wrong in the
  // other direction and would train people to suppress it.
  const internal = [
    'routing config: { "brain": "MyCFO", "jurisdiction": "prospective" }',
    "fact package field: mycfo_scenario_inputs, attributed to MyCFO",
    "QA harness: assert the MyCFO golden set passes before the MyKeeper one",
    "instrumentation: llm_call_logs.brain = MyCFO",
  ];

  for (const text of internal) {
    it(`permits ${text.slice(0, 34)}...`, () => {
      // Not a composed artifact, so the rule does not bind.
      expect(fires(text, ["universal"])).toBe(false);
      expect(fires(text, ["analytical"])).toBe(false);
    });
  }

  it("MyKeeper is never flagged, since it is the household-facing name", () => {
    expect(fires("MyKeeper has your books up to date.", ["composed_artifact"])).toBe(false);
  });
});
