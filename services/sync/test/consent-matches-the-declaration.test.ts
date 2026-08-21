// The link token asks for exactly what config/plaid-consent.json declares.
//
// DECLARE WHAT WE INTEND, ASK THE PROVIDER WHAT IS TRUE, FAIL ON THE
// DIFFERENCE. The same shape as edge-rules against the live Cloudflare zone and
// secret-inventory against worker-secrets.json, and for the same reason: a
// configuration that lives outside this repository is invisible to code review
// until something compares the two.
//
// THIS IS THE STATIC HALF AND IT SAYS SO. It proves the CODE asks for what the
// declaration says. It cannot prove what PLAID GRANTED, because that is a
// property of an Item and of the dashboard, and CI holds no production Item.
// The live half is the item-products route, which now reports the difference
// rather than three raw arrays.
//
// WHY BOTH DIRECTIONS. A test asserting only that the declared products appear
// in the code would pass while the code asked for four more, which is precisely
// the state that was discovered on 21 Aug: consent to assets, identity,
// identity_match and signal that nobody had asked for and nothing could see.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DECL = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "config", "plaid-consent.json"), "utf8")
) as { products: string[]; additionalConsentedProducts: string[] };

const SRC = readFileSync(join(import.meta.dirname, "..", "src", "reconnect.ts"), "utf8");

/** Reads an array literal out of the link token request. */
function requested(field: string): string[] {
  const m = SRC.match(new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

describe("the link token matches the declaration", () => {
  it("found a link token request at all", () => {
    // Direction 2: both assertions below are vacuous against a file that no
    // longer creates one, and two empty arrays compare equal.
    expect(SRC, "reconnect.ts no longer creates a link token").toMatch(/"\/link\/token\/create"/);
    expect(DECL.products.length + DECL.additionalConsentedProducts.length).toBeGreaterThan(0);
  });

  it("asks for exactly the declared products", () => {
    expect(
      requested("products").sort(),
      "the link token's products differ from config/plaid-consent.json. Asking for more than we declare is consent a household grants without our having decided to want it.",
    ).toEqual([...DECL.products].sort());
  });

  it("asks for exactly the declared additional consents", () => {
    expect(
      requested("additional_consented_products").sort(),
      "additional_consented_products differs from config/plaid-consent.json.",
    ).toEqual([...DECL.additionalConsentedProducts].sort());
  });
});
