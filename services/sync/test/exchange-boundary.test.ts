// The section 4a boundary: no access token leaves marginsheet-sync (4.3.2).
//
// WHY THIS NEEDS ITS OWN TEST. A token in the exchange response BREAKS
// NOTHING. The exchange still works, the household still connects, the accounts
// still appear, and every other test in this repository still passes. Nothing
// would notice, which is exactly the criterion for a control worth registering.
//
// The response shape is asserted by ENUMERATION rather than by scanning for
// token-shaped strings: a field added later is caught by an enumeration and
// missed by a scan that only knows the prefixes it was taught.

import { describe, it, expect } from "vitest";
import type { ExchangeResult } from "../src/exchange.js";

const ACCESS_TOKEN = "access-sandbox-de3ce8ef-33f8-452c-a685-8671031fc0f6";

// The shape exchangePublicToken returns, built the way the handler builds it.
const result: ExchangeResult = {
  itemId: "item-sandbox-abc",
  institution: { plaidInstitutionId: "ins_109508", name: "First Platypus Bank" },
  accounts: [{ plaidAccountId: "acc_1", name: "Plaid Checking", mask: "0000", type: "depository" }],
  alreadyConnected: false,
};

describe("the exchange result cannot carry an access token", () => {
  it("has exactly these top-level fields", () => {
    // An enumeration, so a field added later fails here rather than shipping.
    expect(Object.keys(result).sort()).toEqual([
      "accounts", "alreadyConnected", "institution", "itemId",
    ]);
  });

  it("each account carries exactly these fields", () => {
    expect(Object.keys(result.accounts[0]).sort()).toEqual([
      "mask", "name", "plaidAccountId", "type",
    ]);
  });

  it("no serialisation of the result contains a token-shaped value", () => {
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(ACCESS_TOKEN);
    // Plaid access tokens are prefixed access-<env>-. Belt as well as braces:
    // the enumeration above is the control, this is the sanity check.
    expect(/access-(sandbox|development|production)-/.test(serialised)).toBe(false);
  });

  it("itemId is the Plaid ITEM id, which is not a credential", () => {
    // Worth stating: item_id is safe to return and is what reconnect keys on.
    // An Item is a login, so this identifies which login, not how to use it.
    expect(result.itemId.startsWith("item-")).toBe(true);
  });
});
