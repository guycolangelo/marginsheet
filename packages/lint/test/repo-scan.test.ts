// The CI gate: our own source, prompts, and app copy must pass the universal
// rules clean. Specs and docs are excluded (they are fixtures and internal
// records, not output). This test IS the lint job; a violation anywhere in
// the scanned trees blocks the merge.

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { scanFiles } from "../src/index.js";

const ROOT = join(import.meta.dirname, "../../..");

// The whole lint package is deliberately absent: rules.ts must contain the
// banned tokens to define them, and the tests quote them as fixtures. The
// engine's correctness is proven by its own test suite, not by self-scan.
// Specs and docs are fixtures and records, not output.
const TARGETS = [
  "services/api",
  "services/conversation",
  "packages/schema",
  "packages/shared",
  "packages/fact-packages",
  "apps/web/public",
  "prompts",
  "scripts",
].map((p) => join(ROOT, p)).filter((p) => existsSync(p));

describe("repo scan: universal rules over source, prompts, and copy", () => {
  it("finds no violations", () => {
    const findings = scanFiles(TARGETS);
    const report = findings
      .map((f) => `${f.file}:${f.line} [${f.ruleId}] ${JSON.stringify(f.match)}`)
      .join("\n");
    expect(findings, `\n${report}`).toEqual([]);
  });
});

// Household-facing trees carry the household_copy context as well as universal.
//
// SCOPED RATHER THAN UNIVERSAL, because the category canon scopes it: the ban
// on "financial" is on "any household-facing string", and this repo uses
// "financial data" correctly in seven internal comments describing what it
// protects. A universal rule would fire on privacy code doing exactly what
// doctrine asks, which is how a rule gets suppressed rather than obeyed.
describe("repo scan: household-facing trees carry household_copy", () => {
  const COPY_TREES = ["apps/web", "prompts"]
    .map((p) => join(ROOT, p))
    .filter((p) => existsSync(p));

  it("scans a real tree, so this is not vacuous", () => {
    // apps/web is an M0 placeholder and prompts/ is a .gitkeep. This assertion
    // is what stops the suite reporting clean over nothing once both fill up.
    expect(COPY_TREES.length).toBeGreaterThan(0);
  });

  it("finds no violations", () => {
    const findings = scanFiles(COPY_TREES, ["universal", "household_copy"]);
    const report = findings
      .map((f) => `${f.file}:${f.line} [${f.ruleId}] ${JSON.stringify(f.match)}`)
      .join("\n");
    expect(findings, `\n${report}`).toEqual([]);
  });
});

describe("repo scan: prompts tree carries every context, strict", () => {
  // Prompt files are outbound-adjacent: everything the doctrine bans in any
  // register is banned here. When real prompts arrive (M10+) and need to
  // quote banned vocabulary to forbid it, the engine grows a suppression
  // syntax; until then, strict.
  it("finds no violations in prompts/", () => {
    const findings = scanFiles([join(ROOT, "prompts")], [
      "universal",
      "analytical",
      "correction",
      "follow_up",
      "decision_commentary",
    ]);
    const report = findings
      .map((f) => `${f.file}:${f.line} [${f.ruleId}] ${JSON.stringify(f.match)}`)
      .join("\n");
    expect(findings, `\n${report}`).toEqual([]);
  });
});
