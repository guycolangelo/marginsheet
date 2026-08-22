// The note that claimed completeness while omitting a card.
//
// THE PRODUCTION READING THAT FOUND IT: cardsReported 10, cardsUnknown 1, and
// the note said "all 10 cards reported; totalDue is the household's committed
// outflow." Eleven cards existed. Discover's $8,453.84 was not in totalDue and
// the sentence asserted the figure was complete.
//
// IT IS THE SETTLE-NOTE SPECIES: a sentence emitted for a case it does not
// describe. The emission condition summed notReported and unsupported and never
// looked at unknown, so a household whose only gap was an unfetched card fell
// through to the completeness branch.
//
// THE FIXTURE THAT MATTERS IS THE PRODUCTION SHAPE, and it is the one no
// existing test expressed: every prior case had a non-zero notReported or a
// zero reported, and both take a different branch.

import { describe, it, expect } from "vitest";
import { committedOutflowNote } from "../src/ledger-readout-sql.js";

describe("the committed-outflow note derives completeness from the total", () => {
  it("THE PRODUCTION CASE: ten reported and one never fetched is PARTIAL", () => {
    const note = committedOutflowNote({ reported: 10, notReported: 0, unsupported: 0, unknown: 1 });
    expect(note).toMatch(/PARTIAL/);
    expect(note).toMatch(/10 of 11/);
    expect(note, "the reader must be told how many cards are missing and why").toMatch(/never fetched/);
    expect(note).not.toMatch(/^all /);
  });

  it("says all only when every card reported", () => {
    expect(committedOutflowNote({ reported: 11, notReported: 0, unsupported: 0, unknown: 0 }))
      .toBe("all 11 cards reported; totalDue is the household's committed outflow");
  });

  it("A STATE THAT DOES NOT EXIST YET STILL COUNTS AS UNSEEN", () => {
    // The durable half. The old note enumerated the ways a card can be missing,
    // so a coverage state added later silently joined the completeness branch,
    // which is exactly how `unknown` slipped in. unseen = total - reported
    // cannot miss a state because it never names one.
    const withAFifthState = committedOutflowNote({
      reported: 3, notReported: 0, unsupported: 0, unknown: 0,
    });
    expect(withAFifthState).toMatch(/^all 3 cards/);
    // and the same three reported against a larger population is partial
    expect(committedOutflowNote({ reported: 3, notReported: 1, unsupported: 0, unknown: 0 }))
      .toMatch(/PARTIAL: 3 of 4/);
  });

  it("never fetched for any card claims nothing", () => {
    expect(committedOutflowNote({ reported: 0, notReported: 0, unsupported: 0, unknown: 4 }))
      .toMatch(/never been read for any of these 4 cards/);
  });

  it("no cards at all is its own sentence, not a completeness claim", () => {
    // "all 0 cards reported; totalDue is the household's committed outflow" is
    // what the old chain produced for a household with no credit accounts: a
    // completeness claim about an empty set, which reads as a real zero.
    expect(committedOutflowNote({ reported: 0, notReported: 0, unsupported: 0, unknown: 0 }))
      .toMatch(/holds no credit accounts/);
  });

  it("names each reason it can, so the reader knows which gap they have", () => {
    const note = committedOutflowNote({ reported: 2, notReported: 1, unsupported: 1, unknown: 1 });
    expect(note).toMatch(/PARTIAL: 2 of 5/);
    expect(note).toMatch(/1 reported by the institution as unavailable/);
    expect(note).toMatch(/1 on an Item that does not support liabilities/);
    expect(note).toMatch(/1 never fetched at all/);
  });
});
