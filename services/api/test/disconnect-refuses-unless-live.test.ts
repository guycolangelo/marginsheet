// The disconnect removes only an Item Plaid reports as live, and re-checks.
//
// TWO PROPERTIES, AND THE SECOND IS THE ONE A REVIEWER WOULD MISS.
//
// The gate: a confirmed call proceeds only on "live". Removing an Item we
// cannot confirm is live means acting on a subject whose state we do not know,
// and the cost is asymmetric: refusing costs one retry, proceeding wrongly
// removes a household's connection to their bank.
//
// The re-check: liveness is read AGAIN inside the confirmed call rather than
// carried from the dry run. A dry run minutes earlier is not evidence about
// now. An Item can be removed, expire, or lose its credential in between, and a
// confirmation that trusts a stale reading acts on a state nobody has observed.
// This is the same shape as the GUC that did not survive between statements:
// two correct reads, and nothing establishing that the first still describes
// the second.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dirname, "..", "..", "sync", "src", "disconnect.ts"),
  "utf8"
);

describe("the disconnect proceeds only on a fresh reading of live", () => {
  it("has a disconnect at all", () => {
    // Direction 2: every assertion below is vacuous against a file that no
    // longer performs the removal.
    expect(SRC, "the /item/remove call is gone").toMatch(/"\/item\/remove"/);
    expect(SRC, "the confirmed path is gone").toMatch(/apply/);
  });

  it("refuses a confirmed call unless liveness is live", () => {
    expect(
      SRC,
      'the gate is not "liveness !== live". Anything looser permits unknown, which is every case where Plaid could not be asked.',
    ).toMatch(/status\.liveness\s*!==\s*"live"/);
  });

  it("reads liveness itself rather than accepting it as a parameter", () => {
    // If liveness arrived as an argument, the caller could pass a value read
    // minutes earlier and the gate above would be checking a memory.
    expect(
      SRC.slice(0, SRC.indexOf("export async function disconnectItem") + 400),
      "disconnectItem takes liveness as a parameter, so its gate can be satisfied by a stale reading",
    ).not.toMatch(/liveness\s*:\s*ItemLiveness\s*[,)]/);
    expect(
      SRC,
      "disconnectItem does not call itemStatus, so nothing establishes the Item's state at the moment of removal",
    ).toMatch(/await itemStatus\(/);
  });
});
