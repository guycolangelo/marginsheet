// A removed Item is classified as gone, and this proves the classifier CAN say
// gone at all.
//
// WHY IT EXISTS. The first version read `error_code` off a cast object while
// PlaidError.toJSON emits `errorCode`. The property was always undefined, so
// the classifier could NEVER return "gone". Nothing failed: the disconnect's
// repair branch simply never fired and the purge's gate never permitted a
// purge, both refusing for a reason that read as caution rather than as a bug.
//
// A CAST IS NOT A CHECK. `as { error_code?: string }` told the compiler a shape
// existed and it stopped verifying. Reading the typed field puts the obligation
// back where a wrong name fails to compile.
//
// THE FIRST ASSERTION IS THE ONE THAT WAS MISSING. Every other test here could
// have passed against a classifier hard-wired to "unknown", which is exactly
// what shipped: a function whose refusals all look deliberate.

import { describe, it, expect } from "vitest";
import { PlaidError } from "../src/plaid-client.js";
import { livenessFromError } from "../src/item-status.js";

const plaidError = (code: string) =>
  new PlaidError("/item/get", 400, { error_type: "ITEM_ERROR", error_code: code });

describe("classifying a failed /item/get", () => {
  it("says gone for an Item Plaid no longer has", () => {
    expect(livenessFromError(plaidError("ITEM_NOT_FOUND"))).toBe("gone");
  });

  it("says gone for a token that belongs to a removed Item", () => {
    expect(livenessFromError(plaidError("INVALID_ACCESS_TOKEN"))).toBe("gone");
  });

  it("says unknown for anything else, so the gates fail closed", () => {
    // These are refusals, and they must stay refusals: a rate limit and a
    // removed Item are both "we could not confirm it is live", and only one of
    // them means the Item is gone.
    for (const code of ["RATE_LIMIT_EXCEEDED", "INTERNAL_SERVER_ERROR", "PRODUCT_NOT_READY"]) {
      expect(livenessFromError(plaidError(code)), `${code} was treated as gone`).toBe("unknown");
    }
    expect(livenessFromError(new Error("network")), "a non-Plaid failure was treated as gone").toBe("unknown");
    expect(livenessFromError(plaidError("")), "an empty error code was treated as gone").toBe("unknown");
  });
});
