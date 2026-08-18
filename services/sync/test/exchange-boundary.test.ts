// The section 4a boundary: no access token leaves marginsheet-sync (4.3.2).
//
// REWRITTEN 18 Aug 2026. The first version asserted the shape of a HAND-WRITTEN
// LITERAL typed as ExchangeResult, so no change to exchange.ts could redden it:
// it proved a literal I wrote matched a list I wrote. The planted-failure
// harness caught it, mutation applied and test still green, which is exactly
// what the harness is for.
//
// This version calls the real exchangePublicToken with Plaid and Postgres
// stubbed, so what is asserted is what the FUNCTION returns.
//
// WHY THIS NEEDS A TEST AT ALL. A token in the exchange response BREAKS
// NOTHING. The exchange succeeds, the household connects, the accounts appear,
// and every other test passes. Nothing would notice.

import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCESS_TOKEN = "access-sandbox-de3ce8ef-33f8-452c-a685-8671031fc0f6";

// A minimal postgres stand-in: tagged template that returns canned rows, plus
// begin() and end(). Deliberately not a full fake; it only has to let the
// handler run to its return statement.
const rowsFor = (sqlText: string) => {
  if (/insert into institutions/i.test(sqlText)) return [{ id: "inst-row-1" }];
  if (/insert into plaid_items/i.test(sqlText)) return [{ id: "item-row-1", inserted: true }];
  if (/insert into financial_accounts/i.test(sqlText)) return [{ id: "acct-row-1" }];
  return [];
};
const tag = (strings: TemplateStringsArray | string, ..._v: unknown[]) =>
  Promise.resolve(rowsFor(typeof strings === "string" ? strings : strings.join(" ")));

vi.mock("postgres", () => ({
  default: () => {
    const sql = tag as unknown as Record<string, unknown> & typeof tag;
    sql.begin = (fn: (tx: unknown) => unknown) => Promise.resolve(fn(tag));
    sql.end = () => Promise.resolve();
    return sql;
  },
}));

const { exchangePublicToken } = await import("../src/exchange.js");

beforeEach(() => {
  // Plaid, answering with real-shaped bodies. The access token is returned by
  // the exchange call, which is the whole point: it enters the function.
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    const body =
      path === "/item/public_token/exchange"
        ? { access_token: ACCESS_TOKEN, item_id: "item-sandbox-abc" }
        : path === "/item/get"
          ? { item: { institution_id: "ins_109508" } }
          : path === "/institutions/get_by_id"
            ? { institution: { name: "First Platypus Bank" } }
            : {
                accounts: [
                  {
                    account_id: "acc_1",
                    name: "Plaid Checking",
                    official_name: "Plaid Gold Checking",
                    mask: "0000",
                    type: "depository",
                    subtype: "checking",
                    balances: { current: 110, available: 100, iso_currency_code: "USD" },
                  },
                ],
              };
    return new Response(JSON.stringify(body), { status: 200 });
  });
});

const run = () =>
  exchangePublicToken(
    "public-sandbox-token",
    "11111111-1111-1111-1111-111111111111",
    { clientId: "cid", secret: "sec" },
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    "postgres://stub"
  );

describe("the exchange result cannot carry an access token", () => {
  it("no serialisation of the REAL result contains the token", async () => {
    const result = await run();
    // The token demonstrably entered the function: it came back from the
    // stubbed exchange call and was encrypted. This asserts it did not leave.
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(/access-(sandbox|development|production)-/.test(JSON.stringify(result))).toBe(false);
  });

  it("returns exactly these top-level fields", async () => {
    // An enumeration on the REAL return value, so a field added to the handler
    // fails here rather than shipping.
    expect(Object.keys(await run()).sort()).toEqual([
      "accounts", "alreadyConnected", "institution", "itemId",
    ]);
  });

  it("each account carries exactly these fields", async () => {
    const result = await run();
    expect(Object.keys(result.accounts[0]).sort()).toEqual(["mask", "name", "plaidAccountId", "type"]);
  });

  it("carries the Plaid item id, which identifies a login and is not a credential", async () => {
    const result = await run();
    expect(result.itemId).toBe("item-sandbox-abc");
    expect(result.alreadyConnected).toBe(false);
  });
});
