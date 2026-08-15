// The traceability validator, proven by fabrication.
//
// "Any number, date or name in output without a source field is a hard
// failure, same severity as an advice-gate failure."
//
// Every negative case here is deliberately wrong output that MUST fail. If
// the fabricated cases passed, the validator would be decorative and this
// file would be certifying nothing.

import { describe, it, expect } from "vitest";
import { validateTraceability, validatePatternClaims } from "../src/traceability.js";
import {
  introMyKeeper,
  digestCleanWeek,
  lifeEventReply,
  alertFirstFlag,
} from "../src/fixtures/index.js";

describe("positive control: canonical output passes against its own package", () => {
  it("the MyKeeper intro traces cleanly", () => {
    const findings = validateTraceability(
      introMyKeeper.status === "full" ? introMyKeeper.expectedOutput : "",
      introMyKeeper.package
    );
    expect(findings, findings.map((f) => f.message).join("\n")).toEqual([]);
  });

  it("the clean-week digest traces cleanly", () => {
    const findings = validateTraceability(
      digestCleanWeek.status === "full" ? digestCleanWeek.expectedOutput : "",
      digestCleanWeek.package
    );
    expect(findings, findings.map((f) => f.message).join("\n")).toEqual([]);
  });

  it("exchange #4, the gold standard, traces cleanly", () => {
    const findings = validateTraceability(
      lifeEventReply.status === "full" ? lifeEventReply.expectedOutput : "",
      lifeEventReply.package
    );
    expect(findings, findings.map((f) => f.message).join("\n")).toEqual([]);
  });
});

describe("fabrication must fail: numbers", () => {
  const pkg = digestCleanWeek.package;

  it("rejects a figure the package does not contain", () => {
    const findings = validateTraceability(
      "Good morning Guy. 214 transactions through the books this week.",
      pkg
    );
    expect(findings.some((f) => f.kind === "number" && f.token === "214")).toBe(true);
  });

  it("rejects a near-miss, because tolerance is for FORMAT and not for VALUE", () => {
    // The package holds 187. 189 is not 187 formatted differently.
    const findings = validateTraceability(
      "Good morning Guy. 189 transactions through the books this week.",
      pkg
    );
    expect(findings.some((f) => f.token === "189")).toBe(true);
  });

  it("accepts the same value formatted differently", () => {
    const money = {
      ...digestCleanWeek.package,
      block: { ...digestCleanWeek.package.block, txns_processed: 2140 },
    };
    // 2,140 and 2140 are the same number, differently written.
    const findings = validateTraceability("That came to 2,140 items.", money);
    expect(findings.filter((f) => f.kind === "number")).toEqual([]);
  });

  it("rejects an invented dollar amount in a life-event reply", () => {
    const findings = validateTraceability(
      "The household's income is now about $19,400 a month.",
      lifeEventReply.package
    );
    expect(findings.some((f) => f.kind === "number" && f.token.includes("19,400"))).toBe(true);
  });
});

describe("fabrication must fail: dates and names", () => {
  it("rejects a date not present in the package", () => {
    const findings = validateTraceability(
      "The payment lands on 2026-12-01.",
      alertFirstFlag.package
    );
    expect(findings.some((f) => f.kind === "date")).toBe(true);
  });

  it("rejects a name the package never supplied", () => {
    // Nobody named Sarah appears in this package. A composer that produces
    // her has invented a person into a household's books.
    const findings = validateTraceability(
      "Good morning Guy. Sarah answered the last one for you.",
      digestCleanWeek.package
    );
    expect(findings.some((f) => f.kind === "name" && f.token === "Sarah")).toBe(true);
  });

  it("accepts a name the package did supply", () => {
    const findings = validateTraceability(
      "Congratulations on the baby, Sam.",
      lifeEventReply.package
    );
    expect(findings.filter((f) => f.kind === "name")).toEqual([]);
  });

  it("does not flag the product's own vocabulary as an untraceable name", () => {
    const findings = validateTraceability(
      "Good morning Guy. MyKeeper has the books clean and your Margin held.",
      digestCleanWeek.package
    );
    expect(findings.filter((f) => f.kind === "name")).toEqual([]);
  });
});

describe("rule 3: a derived pattern is a computation, and the composer never computes", () => {
  it("rejects a pattern claim with no supplied string fact behind it", () => {
    const findings = validatePatternClaims(
      "That's larger than anything on that card in the year I can see.",
      [] // nothing supplied
    );
    // One claim may trip several markers; the count is not the assertion,
    // the refusal is.
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.every((f) => f.kind === "pattern_claim")).toBe(true);
  });

  it("accepts the same claim when code supplied it", () => {
    const findings = validatePatternClaims(
      "That's larger than anything on that card in the year I can see.",
      ["larger than anything on that card in the year I can see"]
    );
    expect(findings).toEqual([]);
  });

  it("rejects an invented superlative in an alert", () => {
    const findings = validatePatternClaims(
      "This is the highest your utilities have ever been.",
      alertFirstFlag.package.block.pattern_context
    );
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("the name check's known limitation, pinned rather than hidden", () => {
  it("false-positives on an uncommon sentence opener, and that trade is deliberate", () => {
    // "Yesterday" is not in the stoplist and is not a name. The validator
    // flags it. This test exists so the behavior is a maintained fact rather
    // than a surprise: when real canon opens a sentence this way, the word
    // joins SENTENCE_STARTERS and this test updates with it.
    //
    // The trade is asymmetric on purpose. A false positive costs one rewrite
    // and announces itself in CI. A false negative ships an invented person
    // into a household's books and announces nothing.
    const findings = validateTraceability(
      "Yesterday closed clean.",
      digestCleanWeek.package
    );
    expect(findings.some((f) => f.kind === "name" && f.token === "Yesterday")).toBe(true);
  });

  it("still catches the failure the limitation is traded for", () => {
    // The whole point: a fabricated person in sentence-initial position.
    const findings = validateTraceability(
      "Sarah answered that one for you.",
      digestCleanWeek.package
    );
    expect(findings.some((f) => f.kind === "name" && f.token === "Sarah")).toBe(true);
  });
});
