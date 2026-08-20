// FORCING FIELDS: a flag that obligates content elsewhere in the message.
//
// THE PATTERN, AND WHY IT NEEDED A TEST RATHER THAN A COMMENT.
//
// `ledgers_diverge` has carried the comment "true FORCES the two-ledger answer
// shape" since M2, and it forced nothing. `honored_fully` sits beside
// `not_honored_part`, whose own comment says it composes "that one I don't
// split", and nothing required it to be there.
//
// Both are the OMISSION FAILURE (CLAUDE.md): a message where every word is
// permitted, every rule is satisfied, and it still misleads by what is missing.
// Answering one ledger is not a banned word, it is a missing half. Confirming a
// preference while omitting the part not honored is not a banned word, it is a
// household reading full agreement into a partial one.
//
// THE DUAL, stated because it is the clearest form of the gap:
//
//   NULL_BEHAVIOR governs what a null composes.
//   Nothing governs what a populated flag obligates.
//   Its own cash_ledger entry points at an enforcement that does not exist.
//
// This file is that enforcement, for the two flags whose obligated fields
// already exist. `tender: "installment"` is the third and cannot be checked,
// because its term fields are owed to M2.

import { describe, it, expect } from "vitest";
import { FIXTURES } from "../src/fixtures/index.js";
import type { ScenarioAnswer, PreferenceConfirm } from "../src/classes.js";

/** Every forcing field the contract declares and this suite can check. */
const FORCING_FIELDS = [
  {
    messageClass: "ScenarioAnswer" as const,
    flag: "ledgers_diverge",
    obligates: "cash_ledger",
    declaredBy: 'its own comment: "true FORCES the two-ledger answer shape"',
    /** Does this block violate the obligation? */
    violates: (b: unknown) => {
      const x = b as ScenarioAnswer;
      return x.ledgers_diverge && x.cash_ledger === null;
    },
    why:
      "A scenario claiming the ledgers diverge and carrying no cash ledger describes an answer that cannot be composed. The composer never computes, so a cash-timing claim with no cash facts is a hard failure rather than a thin answer, and the household hears yes when the honest answer is the tension between the two.",
  },
  {
    messageClass: "PreferenceConfirm" as const,
    flag: "honored_fully",
    obligates: "not_honored_part",
    declaredBy: 'not_honored_part composes "that one I don\'t split"',
    violates: (b: unknown) => {
      const x = b as PreferenceConfirm;
      return !x.honored_fully && x.not_honored_part === null;
    },
    why:
      "A confirmation that was not honored fully and does not name the part left out says the preference was recorded and omits that it was not. Every word true, and the household reads full agreement into a partial one.",
  },
];

describe("forcing fields obligate their content, and the obligation is checked", () => {
  it("the suite covers a forcing field that exists in the fixtures", () => {
    // Guards against the whole file becoming vacuous if the classes are
    // renamed: a suite that walks zero fixtures reports clean over nothing.
    const covered = FORCING_FIELDS.filter((f) =>
      FIXTURES.some((x) => x.messageClass === f.messageClass)
    );
    expect(covered.length).toBe(FORCING_FIELDS.length);
  });

  // TITLES ARE LITERAL, NOT GENERATED. A template literal reads fine and the
  // register's existence check cannot find it in the source, so an entry naming
  // it would match nothing, run zero tests, and the harness would read zero
  // tests as a pass. The harness itself was happy, because `vitest -t` matches
  // the RESOLVED name at runtime: the register check is the stricter of the two
  // and it caught this.
  const check = (field: (typeof FORCING_FIELDS)[number]) => {
    const fixtures = FIXTURES.filter((f) => f.messageClass === field.messageClass);
    expect(fixtures.length, `no ${field.messageClass} fixture to check`).toBeGreaterThan(0);
    for (const f of fixtures) {
      const block = f.package.block as unknown;
      expect(
        field.violates(block),
        `${f.name}: ${field.flag} obligates ${field.obligates} (${field.declaredBy}). ${field.why}`
      ).toBe(false);
    }
  };

  it("ScenarioAnswer.ledgers_diverge obligates cash_ledger", () => {
    check(FORCING_FIELDS[0]);
  });

  it("PreferenceConfirm.honored_fully obligates not_honored_part", () => {
    check(FORCING_FIELDS[1]);
  });
});

describe("the obligation is real, not a restatement of the fixture data", () => {
  // A test asserting "no fixture violates this" passes trivially if no fixture
  // could violate it. These assert the CHECK can distinguish, by running the
  // predicate against a constructed violation rather than against the fixtures.
  it("the ledgers_diverge predicate catches a constructed violation", () => {
    const violating = { ledgers_diverge: true, cash_ledger: null } as ScenarioAnswer;
    const honest = { ledgers_diverge: true, cash_ledger: {} } as ScenarioAnswer;
    const single = { ledgers_diverge: false, cash_ledger: null } as ScenarioAnswer;
    expect(FORCING_FIELDS[0].violates(violating)).toBe(true);
    expect(FORCING_FIELDS[0].violates(honest)).toBe(false);
    // A non-diverging scenario answering on one ledger is CORRECT. The rule is
    // "wherever they diverge", not "always", and a check that reddened here
    // would force a padding paragraph onto every debit purchase.
    expect(FORCING_FIELDS[0].violates(single)).toBe(false);
  });

  it("the honored_fully predicate catches a constructed violation", () => {
    const violating = { honored_fully: false, not_honored_part: null } as PreferenceConfirm;
    const honest = { honored_fully: false, not_honored_part: "the split transactions" } as PreferenceConfirm;
    const full = { honored_fully: true, not_honored_part: null } as PreferenceConfirm;
    expect(FORCING_FIELDS[1].violates(violating)).toBe(true);
    expect(FORCING_FIELDS[1].violates(honest)).toBe(false);
    // Fully honored with nothing left out is the ordinary case.
    expect(FORCING_FIELDS[1].violates(full)).toBe(false);
  });
});

describe("the third forcing field, named so its absence is deliberate", () => {
  it("tender obligates term and total, and cannot be checked because the fields are owed", () => {
    const scenario = FIXTURES.find((f) => f.messageClass === "ScenarioAnswer")!;
    const block = scenario.package.block as ScenarioAnswer;
    // Asserted rather than commented: when M2 adds the fields this goes red and
    // sends the author here, which is where the third entry belongs.
    expect("tender" in block, "tender now exists; add the third forcing field").toBe(false);
  });
});
