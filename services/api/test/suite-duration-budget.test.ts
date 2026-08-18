// The duration budget's own shape (17 Aug 2026).
//
// The budget replaced what the raised testTimeout gave up, so the ways it can
// quietly stop meaning anything are worth closing here rather than discovering
// later. Needs no database, so it runs on every PR.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const budget = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "config", "suite-duration.json"), "utf8")
) as { maxMs: number; observedBand: { minMs: number; maxMs: number } };

describe("the suite duration budget is set outside the jitter it exists to ignore", () => {
  it("sits above the top of the observed band, or it is flaky by construction", () => {
    // A budget inside the characterised spread reddens on provisioning jitter,
    // which is the exact failure that caused the timeout to be raised in the
    // first place. Setting one is how this control would become the next
    // flaky check.
    expect(
      budget.maxMs,
      `maxMs ${budget.maxMs} is not above the observed top of ${budget.observedBand.maxMs}. ` +
        `A budget inside the known band fires on jitter and teaches re-running.`
    ).toBeGreaterThan(budget.observedBand.maxMs);
  });

  it("leaves real headroom rather than sitting on the band's edge", () => {
    expect(budget.maxMs).toBeGreaterThanOrEqual(budget.observedBand.maxMs * 1.5);
  });

  it("is not so loose that a genuine regression passes", () => {
    // The other direction. A budget of an hour would never be flaky and would
    // never catch anything either.
    expect(budget.maxMs).toBeLessThanOrEqual(budget.observedBand.maxMs * 3);
  });

  it("records the band it was characterised against", () => {
    expect(budget.observedBand.minMs).toBeGreaterThan(0);
    expect(budget.observedBand.maxMs).toBeGreaterThan(budget.observedBand.minMs);
  });
});
