import { describe, it, expect } from "vitest";
import { normalizeMerchantKey } from "../src/merchant.js";

describe("the canonical merchant normalization", () => {
  it("applies all four steps", () => {
    expect(normalizeMerchantKey("ACME, Inc.")).toBe("acme");
    expect(normalizeMerchantKey("Bob's  Burgers LLC")).toBe("bobs burgers");
    expect(normalizeMerchantKey("PUBLIX SUPER MARKETS, INC")).toBe("publix super markets");
  });

  it("is stable across the naming drift it exists to survive", () => {
    const variants = [
      "Acme Corp",
      "ACME CORPORATION",
      "Acme Corp.",
      "  acme   corp  ",
      "Acme, Corp",
    ];
    const keys = new Set(variants.map(normalizeMerchantKey));
    expect(keys.size, [...keys].join(" | ")).toBe(1);
    expect([...keys][0]).toBe("acme");
  });

  it("stays conservative: distinct merchants do not collapse together", () => {
    // The doctrine prefers a question over a wrong inheritance.
    expect(normalizeMerchantKey("Acme Plumbing")).not.toBe(
      normalizeMerchantKey("Acme Roofing")
    );
    expect(normalizeMerchantKey("Shell")).not.toBe(normalizeMerchantKey("Shell Energy"));
  });

  it("does not strip a suffix that is part of a word", () => {
    // "co" is a suffix; "Costco" and "Coffee" must survive intact.
    expect(normalizeMerchantKey("Costco")).toBe("costco");
    expect(normalizeMerchantKey("Coffee Bean")).toBe("coffee bean");
    expect(normalizeMerchantKey("Incline Village Market")).toBe("incline village market");
  });

  it("is idempotent, because a key may be re-keyed without drifting", () => {
    for (const raw of ["ACME, Inc.", "Bob's Burgers LLC", "  Shell  "]) {
      const once = normalizeMerchantKey(raw);
      expect(normalizeMerchantKey(once)).toBe(once);
    }
  });

  it("handles non-ASCII merchant names without stripping their letters", () => {
    expect(normalizeMerchantKey("Café Münster")).toBe("café münster");
  });

  it("removes apostrophes but spaces other punctuation", () => {
    // Apostrophes sit inside a word; slashes and ampersands sit between them.
    // Collapsing these two rules into one breaks whichever case loses.
    expect(normalizeMerchantKey("Bob's")).toBe("bobs");
    expect(normalizeMerchantKey("Bob’s")).toBe("bobs"); // curly apostrophe
    expect(normalizeMerchantKey("Shell/Circle K")).toBe("shell circle k");
    expect(normalizeMerchantKey("A&W Restaurants")).toBe("a w restaurants");
  });

  it("keys the same merchant identically across apostrophe styles", () => {
    const keys = new Set(
      ["McDonald's", "McDonald’s", "MCDONALDS"].map(normalizeMerchantKey)
    );
    expect(keys.size, [...keys].join(" | ")).toBe(1);
  });
});
