// The purge refuses unless Plaid positively reports the Item gone.
//
// THE DIRECTION OF THIS GATE IS THE WHOLE CONTROL. Deleting our rows for an
// Item that is still connected leaves a household linked at Plaid, billed
// monthly, and invisible to us: no row, no sync, and no way to find it except
// by reading Plaid's dashboard. That is worse than the duplicate ledger the
// purge exists to prevent, because a duplicate is visible in the books and this
// is visible nowhere.
//
// SO IT MUST FAIL CLOSED ON "unknown", NOT MERELY ON "live". A network failure,
// a rate limit, an unrecognised error code and a missing token all produce
// "unknown", and every one of them means we do not know. A gate written as
// "refuse when live" permits all four; a gate written as "proceed only when
// gone" refuses all four. Those two read almost identically and differ in
// exactly the cases nobody pictures while writing them.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INDEX = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
const STATUS = readFileSync(
  join(import.meta.dirname, "..", "..", "sync", "src", "item-status.ts"),
  "utf8"
);

describe("the purge proceeds only on positive evidence that the Item is gone", () => {
  it("has a purge route at all", () => {
    // Direction 2: every assertion below would pass vacuously against a file
    // that no longer contains the route.
    expect(INDEX, "the purge route is gone").toMatch(/"\/plaid\/purge-item"/);
    expect(INDEX, "the route no longer requires confirm").toMatch(/body\.confirm/);
  });

  it("gates the delete on liveness being gone, not on it not being live", () => {
    // ANCHORED ON THE HANDLER, NOT ON THE FIRST MENTION. The route name also
    // appears in the session gate's condition list further up the file, and
    // slicing from there ran past an unrelated "ONE TRANSACTION" comment in the
    // accounts route, so the window closed before the gate it was meant to
    // contain. A fixture that reads the wrong region asserts about the wrong
    // code and fails for a reason that has nothing to do with the control.
    const handler = INDEX.indexOf('url.pathname === "/plaid/purge-item" && request.method');
    expect(handler, "the purge handler was not found, so this asserts nothing").toBeGreaterThan(0);
    const gate = INDEX.slice(handler, INDEX.indexOf("const deleted = await sql.begin"));
    expect(
      gate,
      'the delete is not gated on liveness === "gone". A gate phrased as "not live" permits unknown, which is every case where Plaid could not be asked.',
    ).toMatch(/status\.liveness\s*!==\s*"gone"/);
    expect(
      gate,
      "the refusal does not return a status code, so a caller cannot tell it from a success",
    ).toMatch(/status:\s*409/);
  });

  it("treats only removal codes as evidence of absence", () => {
    // A permissive list here would undo the gate above without touching it.
    const m = STATUS.match(/const GONE = new Set\(\[([^\]]*)\]\)/);
    expect(m, "the GONE set is gone").not.toBeNull();
    const codes = m![1].split(",").map((c) => c.trim().replace(/"/g, "")).filter(Boolean);
    expect(codes.sort()).toEqual(["INVALID_ACCESS_TOKEN", "ITEM_NOT_FOUND"]);
  });
});
