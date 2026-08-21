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

// AND IT REGISTERS A WEBHOOK, WHICH IS THE SAME OMISSION CLASS AND WORSE.
//
// Found 21 Aug 2026 by asking why Amex sent no backfill-completion signal. Two
// candidates: Plaid does not send one for that institution, or we never gave it
// anywhere to send. THE READOUT SEPARATED THEM. One Item had completion flags,
// SoFi, whose webhook had been set BY HAND through /plaid/set-webhook. Chase and
// Amex had none.
//
// AN ITEM WITHOUT A WEBHOOK RECEIVES NOTHING. Not just no completion signal: no
// SYNC_UPDATES_AVAILABLE, no reauth notice, nothing. It syncs when a person
// clicks and at no other time, and the ledger goes stale silently between
// clicks while every check agrees with it. That is a worse failure than 90 days
// of history, because it has no end state.
//
// IT LOOKED LIKE AN INSTITUTION DIFFERENCE AND IT WAS A FIELD WE NEVER SENT,
// which is days_requested one file up, five days later, in the same function.
// The tell both times was SEVERAL INSTITUTIONS AGREEING, and CLAUDE.md already
// records that agreement is evidence about US whenever one of our parameters
// reached all of them.
describe("the link token registers a webhook", () => {
  it("names webhook at all", () => {
    expect(
      SRC,
      "the link token has no webhook key, so every Item created through it receives nothing from Plaid and syncs only when somebody clicks"
    ).toMatch(/webhook:/);
  });

  it("passes the configured URL rather than a literal", () => {
    // A hardcoded URL would work in production and point production's Items at
    // production while dev's Items also point at production, which is the
    // failure that is invisible until a dev webhook mutates real data.
    const m = SRC.match(/webhook:\s*([A-Za-z_][\w.]*)/);
    expect(m, "webhook is not passed a variable").not.toBeNull();
    expect(
      m?.[1],
      "webhook is set from something other than the function's webhookUrl parameter"
    ).toBe("webhookUrl");
  });

  it("takes the URL as a required parameter, so a caller cannot omit it", () => {
    // The type carries the obligation. An optional parameter would let a caller
    // forget, which is precisely how this arrived: set-webhook existed, worked,
    // and was a manual route nobody was required to call.
    expect(SRC, "webhookUrl is optional, so a caller can omit it silently").toMatch(
      /webhookUrl:\s*string(?!\s*\|)/
    );
    expect(SRC).not.toMatch(/webhookUrl\?:/);
  });
});
