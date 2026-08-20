// The link token asks for 730 days of history, and says so out loud.
//
// WHY A CONTROL FOR ONE FIELD. transactions.days_requested defaults to 90, and
// the default is silent: an Item created without it holds 90 days and reports
// no error, no warning and no missing field. Every Item created before 20 Aug
// 2026 has that shape, on every institution, and the first one was diagnosed as
// an institution limit before Guy pointed out that SoFi gives more.
//
// IT CANNOT BE REPAIRED IN PLACE. Plaid's reference: "Once Transactions has
// been added to an Item, this value cannot be updated." Extending history means
// /item/remove and a new Item, which is a household-visible re-consent. So the
// cost of dropping this line is not a smaller backfill, it is asking every
// connected household to reconnect.
//
// SAME SHAPE AS workers_dev, RECORDED IN CLAUDE.md: absence is not "off", it is
// whatever the tool decides, and the failure mode is that nobody writes
// anything. That is why the assertion is on the VALUE rather than on the key
// being present with something in it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(import.meta.dirname, "..", "src", "reconnect.ts"), "utf8");

describe("the link token requests two years of history", () => {
  it("names days_requested at all", () => {
    // Direction 2: without this, the assertion below would pass on a file that
    // stopped containing a link token request entirely.
    expect(SRC, "reconnect.ts no longer creates a link token").toMatch(
      /"\/link\/token\/create"/
    );
    expect(SRC, "days_requested is absent, so Plaid's 90 day default applies").toMatch(
      /days_requested/
    );
  });

  it("asks for 730, the maximum, rather than any smaller number", () => {
    // The year-end projection and the census read SEASONAL SHAPE, which needs
    // two cycles to see one. A number below 730 is a decision about what the
    // projections can do and belongs to Guy, not to whoever edits this file.
    const m = SRC.match(/days_requested:\s*(\d+)/);
    expect(m, "days_requested has no numeric literal").not.toBeNull();
    expect(
      Number(m![1]),
      "days_requested is not 730. Plaid's maximum is 730 and the value cannot be changed after an Item is created, so a smaller number here means every household connected under it must re-consent to get more.",
    ).toBe(730);
  });
});
