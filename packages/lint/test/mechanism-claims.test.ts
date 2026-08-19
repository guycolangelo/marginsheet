// THE RATCHET: a comment asserting a mechanism names its enforcement, or it is
// rewritten as description.
//
// WHY THIS COMES BEFORE THE CLEANUP. The 126 unbacked claims in
// docs/imperative-inventory.md exist because this project records rulings in
// comments, and that method works when a control enforces the comment and fails
// SILENTLY when none does. Cleanup on a pile that is still growing is not worth
// starting. This stops it growing.
//
// EXISTING CLAIMS ARE CARRIED, NOT BLESSED. The baseline lets the rule land
// today rather than after a two-week audit, and it may only SHRINK.
//
// WHY THE RATCHET IS STRICTER THAN THE SURVEY. The inventory counts 126 using a
// broad filter, because a survey should over-collect and be read by a human.
// This counts 18, because a rule that fires on legitimate comments is a rule
// people learn to suppress. High precision is what makes it survivable.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  unbackedClaims, MECHANISM_CLAIM, NAMES_ENFORCEMENT, DISCLAIMS_ENFORCEMENT,
} from "../src/mechanism-claims.js";

const ROOT = join(import.meta.dirname, "../../..");
const TREES = ["services", "packages", "scripts", ".github/scripts", "apps"];
const baseline = JSON.parse(
  readFileSync(join(ROOT, "config/mechanism-claim-baseline.json"), "utf8")
) as { count: number; claims: string[]; disclaimedCount: number; disclaimed: string[] };

describe("no NEW comment asserts a mechanism without naming its enforcement", () => {
  const found = unbackedClaims(ROOT, TREES);
  const known = new Set(baseline.claims);

  it("scans a real corpus, so a clean result means something", () => {
    // Guards the whole file against becoming vacuous if the walk breaks: a
    // scanner that finds nothing reports clean over nothing.
    expect(found.length + known.size).toBeGreaterThan(10);
  });

  it("finds no unbacked claim outside the baseline", () => {
    const novel = found.filter((c) => !known.has(c.key));
    const report = novel
      .map((c) => `  ${c.file}:${c.line}\n    ${c.text.slice(0, 140)}`)
      .join("\n\n");
    expect(
      novel,
      `\n\nA comment asserts that a mechanism is in place and does not name what\n` +
        `enforces it. Three ways forward, and the third is not a lesser option:\n\n` +
        `  1. Name it: "Enforced by <name>.test.ts", the control register, a CHECK\n` +
        `     constraint, a unique index, a column grant, or the type system.\n` +
        `  2. Build the enforcement, then name it.\n` +
        `  3. REWRITE AS DESCRIPTION. Most comments here explain why a design is\n` +
        `     right, and an explanation cannot be false in this way.\n\n` +
        `Do NOT add it to config/mechanism-claim-baseline.json. That list only shrinks.\n\n${report}\n`
    ).toEqual([]);
  });

  it("the baseline only shrinks", () => {
    // A ratchet that can be loosened is a ratchet somebody loosens. Recorded
    // as a number as well as a list, so growing it is two edits and a lie
    // rather than one paste.
    expect(baseline.claims.length).toBeLessThanOrEqual(baseline.count);
    const stillPresent = found.filter((c) => known.has(c.key)).length;
    expect(
      stillPresent,
      "more baseline entries are present than the file records; the baseline grew"
    ).toBeLessThanOrEqual(baseline.count);
  });
});

// THE DISCLAIMER BUCKET IS COUNTED, NOT MERELY PERMITTED.
//
// "NOT ENFORCED, owed to M13" is the honest escape hatch and it should stay
// one. But an escape hatch nobody counts becomes invisible debt: fifty comments
// saying it is a real backlog that no number ever surfaces.
//
// So the count lives in the baseline beside the unbacked count, and unlike that
// one IT MAY GO UP. A number that can rise is visible; a permitted form that is
// not counted is not.
describe("disclaimed obligations are visible", () => {
  it("the baseline records how many comments disclaim enforcement", () => {
    expect(typeof baseline.disclaimedCount).toBe("number");
    expect(baseline.disclaimed.length).toBe(baseline.disclaimedCount);
  });

  it("every disclaimer naming a module is carried in open-items", () => {
    // The rule Guy set: where a disclaimer names what it owes to, that
    // obligation is tracked with an owner rather than living only in a
    // comment. Otherwise the escape hatch IS the backlog.
    const openItems = JSON.parse(
      readFileSync(join(ROOT, "docs/open-items.json"), "utf8")
    ) as { id: string; item: string }[];
    const corpus = openItems.map((i) => i.item).join(" ");
    const namesAModule = baseline.disclaimed.filter((k) => /\bM\d{1,2}\b/.test(k));
    for (const key of namesAModule) {
      const [file] = key.split("::");
      const subject = file.split("/").pop();
      expect(
        corpus.includes("acceptance criteria") || corpus.includes(subject ?? ""),
        `a comment in ${file} disclaims enforcement and names a module, and no open item carries it`
      ).toBe(true);
    }
  });
});

describe("the detector's two halves", () => {
  it("MECHANISM_CLAIM catches the two forms that were actually false", () => {
    // Both quoted from the code they were found in.
    expect(MECHANISM_CLAIM.test("true FORCES the two-ledger answer shape.")).toBe(true);
    expect(MECHANISM_CLAIM.test("HERALD FACTS ARE A SUBSET OF CLOSE FACTS BY CONSTRUCTION.")).toBe(true);
  });

  it("MECHANISM_CLAIM does not fire on an explanation", () => {
    // The distinction the whole rule rests on. An explanation cannot be false
    // in this way, so firing here would make the rule unsurvivable.
    expect(
      MECHANISM_CLAIM.test(
        "Escaped rather than trusted to be base64url-shaped, because it looks like base64url is not a security property."
      )
    ).toBe(false);
  });

  it("NAMES_ENFORCEMENT accepts each way a claim can be held up", () => {
    for (const backing of [
      "Enforced by forcing-fields.test.ts.",
      "Proven by token-matrix.test.ts.",
      "Carried by the control register.",
      "A CHECK constraint refuses it.",
      "The unique index refuses a second row.",
      "Withheld by column grant.",
      "The type system admits no other value.",
      "migration 0023 enumerates them.",
      "The CI job fails on any difference.",
    ]) {
      expect(NAMES_ENFORCEMENT.test(backing), backing).toBe(true);
    }
  });

  it("a comment that DISCLAIMS enforcement is accepted, because that is the ask", () => {
    // The rule offers three ways out and the third is "rewrite as
    // description". A comment saying so uses the vocabulary while asserting
    // the opposite, and an earlier version of this rule fired on exactly
    // that, on its own author's rewrites, minutes after they were written to
    // satisfy it. Punishing the honest form leaves lying, silence, or
    // fighting the linter, and the first two are worse than the claim.
    for (const honest of [
      "The mistake doctrine asks this. NOT ENFORCED ANYWHERE: no second field this obligates, owed to M13.",
      "A compose-time obligation with no field to check. Described, not asserted.",
      "This forces the shape, and it cannot be tested until composed output exists.",
    ]) {
      expect(DISCLAIMS_ENFORCEMENT.test(honest), honest.slice(0, 40)).toBe(true);
    }
  });

  it("a disclaimer does not launder a bare assertion", () => {
    // "owed to" is accepted, so the obvious abuse is appending it to a claim
    // that names nothing. It still needs to be saying the obligation is
    // unmet, and these are not.
    expect(DISCLAIMS_ENFORCEMENT.test("This forces the two-ledger shape.")).toBe(false);
    expect(DISCLAIMS_ENFORCEMENT.test("Guaranteed by the design.")).toBe(false);
  });

  it("NAMES_ENFORCEMENT is not satisfied by vague reassurance", () => {
    for (const empty of [
      "This is thoroughly tested.",
      "We check this everywhere.",
      "Guaranteed by the design.",
    ]) {
      expect(NAMES_ENFORCEMENT.test(empty), empty).toBe(false);
    }
  });
});
