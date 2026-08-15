// Canon status, as a TYPED PROPERTY rather than a comment (ruled 15 Aug 2026).
//
// "A partial fixture that gets promoted by forgetting is how invented text
// becomes doctrine."
//
// M12's golden harness must be able to REFUSE to run a golden test against a
// partial or owed fixture. A comment cannot be refused; a type can.

import type { FactPackage } from "./classes.js";
import type { MessageClass } from "./core.js";

export type CanonStatus =
  /** Complete canonical text exists in a spec. Eligible for golden testing. */
  | "full"
  /** The spec describes structure and quotes fragments, but no whole message. */
  | "partial"
  /** No canonical example exists. The expected output is owed by a human. */
  | "owed";

interface FixtureBase<C extends MessageClass> {
  name: string;
  messageClass: C;
  /** Where the canon lives, cited so a reader can check the transcription. */
  source: string;
  package: FactPackage<C>;
}

export interface FullFixture<C extends MessageClass = MessageClass>
  extends FixtureBase<C> {
  status: "full";
  /** The canonical text, verbatim from the spec. */
  expectedOutput: string;
}

export interface PartialFixture<C extends MessageClass = MessageClass>
  extends FixtureBase<C> {
  status: "partial";
  /**
   * Fragments the spec quotes directly. A composed message may be held to
   * these, but NOT to a whole-message comparison, because no whole message
   * exists to compare against.
   */
  requiredFragments: string[];
  /** What is missing, so the gap is legible rather than implied. */
  missing: string;
}

export interface OwedFixture<C extends MessageClass = MessageClass>
  extends FixtureBase<C> {
  status: "owed";
  owed: {
    owner: string;
    /** 1 is highest. Ordered by risk, not listed flat (ruled 15 Aug 2026). */
    risk: number;
    why: string;
  };
}

export type Fixture<C extends MessageClass = MessageClass> =
  | FullFixture<C>
  | PartialFixture<C>
  | OwedFixture<C>;

/**
 * The gate M12's golden harness calls before running a golden comparison.
 *
 * Throws rather than returning false: a harness that can ignore the return
 * value is a harness that will. Promotion of a partial to canon must be a
 * deliberate act of editing the fixture's status, never an omission.
 */
export function assertGoldenEligible(f: Fixture): asserts f is FullFixture {
  if (f.status === "full") return;

  const reason =
    f.status === "partial"
      ? `it is PARTIAL: ${f.missing}. The spec quotes fragments but no whole message, so a golden comparison would certify whatever the model produced.`
      : `it is OWED: no canonical example exists. Owner ${f.owed.owner}, risk ${f.owed.risk}. ${f.owed.why}`;

  throw new Error(
    `Refusing to golden-test fixture "${f.name}" (${f.messageClass}): ${reason}\n` +
      `A partial or owed fixture promoted by forgetting is how invented text becomes doctrine. ` +
      `Hold it to requiredFragments, or write the canon and set status to "full".`
  );
}

/** Fixtures a golden harness may legitimately run. */
export function goldenEligible(fixtures: readonly Fixture[]): FullFixture[] {
  return fixtures.filter((f): f is FullFixture => f.status === "full");
}
