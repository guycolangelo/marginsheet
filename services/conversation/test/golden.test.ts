// The golden gate (M0 plan Task 0.4). Empty now by design: the job exists
// and blocks from day one so M5 and M12 inherit a live gate, not a TODO.
// A fixture is { name, contexts, input, mustContain[], mustNotContain[] }.
// When prompt versions ship, every chain member gets fixtures here and no
// prompt version ships failing one.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface GoldenFixture {
  name: string;
  input: string;
  mustContain: string[];
  mustNotContain: string[];
}

const DIR = join(import.meta.dirname, "golden-fixtures");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

describe("golden fixtures", () => {
  it("suite is live (directory exists and is readable)", () => {
    expect(Array.isArray(files)).toBe(true);
  });

  for (const file of files) {
    const fixture: GoldenFixture = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    it(fixture.name, () => {
      // Real assertion arrives with the composer (M11+): run the fixture
      // input through the prompt under test and check the contains rules.
      // Until then a fixture's presence with no runner is itself a failure.
      expect.fail(`fixture ${fixture.name} exists but no runner is wired yet`);
    });
  }
});
