// The specs are the engine's first fixture set (M0 plan Task 0.4): a frozen
// corpus with known contents. They are fixtures, not lint targets. The specs
// legitimately contain banned vocabulary because they define it; what we
// assert is that the engine finds what is known to be there, and finds
// nothing where nothing is.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lint } from "../src/index.js";

const SPECS = join(import.meta.dirname, "../../../specs");
const read = (name: string) => readFileSync(join(SPECS, name), "utf8");

const emDashCount = (name: string) =>
  lint(read(name)).filter((f) => f.ruleId === "no-em-dash").length;

describe("spec corpus: em dash detection", () => {
  // Counts frozen 15 Aug 2026, spec phase complete. A change here means a
  // spec changed; verify with Guy before updating.
  //
  // plaid-pipeline-spec 8 -> 7, 17 Aug 2026. The section 3 serialization line
  // was rewritten under Guy's approved amendment (a Durable Object is not a
  // lock) and the replacement prose carries no em dash. The ratchet moved the
  // right way and the change is the approved one, which is exactly the case
  // this fixture exists to make somebody look at.
  const KNOWN: Record<string, number> = {
    "app-ui-spec.md": 33,
    "categorization-spec.md": 19,
    "conversation-service-spec.md": 0,
    "data-model-spec.md": 40,
    "identity-onboarding-spec.md": 19,
    "ledger-spec.md": 0,
    "migration-spec.md": 15,
    "mycfo-mykeeper-conversational-spec.md": 0,
    "plaid-pipeline-spec.md": 7,
    "projection-spec.md": 20,
    "spec-manifest-final.md": 1,
  };

  for (const [file, count] of Object.entries(KNOWN)) {
    it(`${file}: ${count}`, () => {
      expect(emDashCount(file)).toBe(count);
    });
  }
});

describe("spec corpus: banned vocabulary is detectable", () => {
  it("finds analytical banned words in the conversational spec", () => {
    const findings = lint(read("mycfo-mykeeper-conversational-spec.md"), [
      "universal",
      "analytical",
    ]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("finds analytical banned words in ledger-spec", () => {
    const findings = lint(read("ledger-spec.md"), ["universal", "analytical"]);
    expect(findings.length).toBeGreaterThan(0);
  });
});
