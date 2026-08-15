// Canon status, nullability, and invariant 4's application half.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "../src/fixtures/index.js";
import { assertGoldenEligible, goldenEligible } from "../src/canon.js";
import { NULL_BEHAVIOR, NULLABLE_FIELDS } from "../src/null-behavior.js";
import { knownContextQuery, KNOWN_CONTEXT_SOURCE } from "../src/assembler.js";
import { MESSAGE_CLASSES } from "../src/core.js";

describe("canon status is typed, so a partial cannot be promoted by forgetting", () => {
  it("refuses to golden-test a PARTIAL fixture, naming what is missing", () => {
    const partial = FIXTURES.find((f) => f.status === "partial")!;
    expect(() => assertGoldenEligible(partial)).toThrow(/PARTIAL/);
    expect(() => assertGoldenEligible(partial)).toThrow(/certify whatever the model produced/);
  });

  it("refuses to golden-test an OWED fixture, naming the owner and risk", () => {
    const owed = FIXTURES.find((f) => f.status === "owed")!;
    expect(() => assertGoldenEligible(owed)).toThrow(/OWED/);
    expect(() => assertGoldenEligible(owed)).toThrow(/Owner Guy/);
  });

  it("permits a FULL fixture", () => {
    const full = FIXTURES.find((f) => f.status === "full")!;
    expect(() => assertGoldenEligible(full)).not.toThrow();
  });

  it("goldenEligible returns only the fixtures with real canon", () => {
    const eligible = goldenEligible(FIXTURES);
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((f) => f.status === "full")).toBe(true);
    expect(eligible.length).toBeLessThan(FIXTURES.length);
  });

  it("every full fixture actually carries expected output, and no other kind does", () => {
    for (const f of FIXTURES) {
      if (f.status === "full") {
        expect(f.expectedOutput.length, f.name).toBeGreaterThan(20);
      } else if (f.status === "partial") {
        expect(f.missing.length, f.name).toBeGreaterThan(20);
      } else {
        expect(f.owed.owner, f.name).toBeTruthy();
        expect(f.owed.why.length, f.name).toBeGreaterThan(40);
      }
    }
  });
});

describe("owed canon is ordered by risk, not listed flat", () => {
  it("the five owed classes carry distinct ascending risk ranks", () => {
    const owed = FIXTURES.filter((f) => f.status === "owed");
    expect(owed).toHaveLength(5);
    const risks = owed.map((f) => f.owed.risk).sort((a, b) => a - b);
    expect(risks).toEqual([1, 2, 3, 4, 5]);
  });

  it("FraudReply is rank 1, because a wrong sentence there is a forbidden adjudication", () => {
    const fraud = FIXTURES.find((f) => f.messageClass === "FraudReply")!;
    expect(fraud.status).toBe("owed");
    if (fraud.status === "owed") {
      expect(fraud.owed.risk).toBe(1);
      expect(fraud.owed.why).toContain("COMPLIANCE BOUNDARY");
    }
  });

  it("prints the owed canon so the debt is visible in every run", () => {
    const owed = FIXTURES.filter((f) => f.status === "owed").sort(
      (a, b) => (a.status === "owed" ? a.owed.risk : 0) - (b.status === "owed" ? b.owed.risk : 0)
    );
    const lines = owed.map((f) =>
      f.status === "owed"
        ? `  ${f.owed.risk}. ${f.messageClass} -> ${f.owed.owner}: ${f.owed.why}`
        : ""
    );
    console.log("\nCANON OWED (no canonical example; ordered by risk):\n" + lines.join("\n") + "\n");
    expect(lines).toHaveLength(5);
  });
});

describe("every message class has a fixture", () => {
  it("all sixteen classes are represented", () => {
    const covered = new Set(FIXTURES.map((f) => f.messageClass));
    const missing = MESSAGE_CLASSES.filter((c) => !covered.has(c));
    expect(missing, `classes with no fixture: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("rule 2: nullability is doctrine", () => {
  it("every nullable field declares what null composes", () => {
    const missing = NULLABLE_FIELDS.filter((p) => !NULL_BEHAVIOR[p]);
    expect(
      missing,
      `nullable fields with no declared behavior: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("declares no behavior for a field that is not nullable", () => {
    const declared = Object.keys(NULL_BEHAVIOR);
    const extra = declared.filter((p) => !(NULLABLE_FIELDS as readonly string[]).includes(p));
    expect(extra, `declared but not nullable: ${extra.join(", ")}`).toEqual([]);
  });

  it("only two kinds exist, because the third kind is guessing", () => {
    for (const [path, behavior] of Object.entries(NULL_BEHAVIOR)) {
      expect(["compose_fallback", "omit_topic"], path).toContain(behavior.kind);
    }
  });

  it("the transaction_count fallback is the spec's exact words", () => {
    const behavior = NULL_BEHAVIOR["IntroMyKeeper.transaction_count"];
    expect(behavior.kind).toBe("compose_fallback");
    if (behavior.kind === "compose_fallback") {
      expect(behavior.text).toBe("several thousand");
    }
  });
});

describe("invariant 4's application half: the assembler reads the view", () => {
  it("the query names known_context_composable", () => {
    const { text } = knownContextQuery({ householdId: "hh_1" });
    expect(KNOWN_CONTEXT_SOURCE).toBe("known_context_composable");
    expect(text).toContain("known_context_composable");
  });

  it("NO assembly path queries the base table directly", () => {
    // Static check over the package source. This is the test M1's manifest
    // assigned to M2: a view nobody is required to use is a suggestion.
    const srcDir = join(import.meta.dirname, "..", "src");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const contents = readFileSync(full, "utf8");
        // Any mention of the base table that is not the composable view.
        const bare = contents.match(/known_context(?!_composable)/g);
        if (!bare) continue;
        // Comments are allowed to discuss it; SQL context is not.
        for (const line of contents.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          if (/known_context(?!_composable)/.test(line) && /from|join|update|insert|delete/i.test(line)) {
            offenders.push(`${entry.name}: ${trimmed}`);
          }
        }
      }
    };
    walk(srcDir);

    expect(
      offenders,
      `Assembly paths reading known_context directly (invariant 4):\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("the static check can actually fail, so it is not passing vacuously", () => {
    // The same predicate applied to a deliberately offending line.
    const offending = `  const sql = "select * from known_context where household_id = $1";`;
    const matches =
      /known_context(?!_composable)/.test(offending) &&
      /from|join|update|insert|delete/i.test(offending);
    expect(matches).toBe(true);

    const clean = `  const sql = "select * from known_context_composable where household_id = $1";`;
    const cleanMatches =
      /known_context(?!_composable)/.test(clean) &&
      /from|join|update|insert|delete/i.test(clean);
    expect(cleanMatches).toBe(false);
  });
});
