// Reconnect keys on the Item, proven by the Item it did NOT touch (4.3.4).
//
// THE ASSERTION THAT MATTERS IS ON THE OTHER ITEM. A household with a personal
// and a business login at one bank has two Items. Reconnect one of them:
//
//   keyed correctly  -> the repaired Item is healthy, the other is untouched
//   keyed on the institution -> the repaired Item comes back HEALTHY TOO,
//                               because the wrong row was updated, and the
//                               other one is orphaned
//
// FROM THE RECONNECTED ITEM'S SIDE THOSE ARE IDENTICAL. It returns healthy,
// updated and syncing in both worlds. Only the Item nobody asked about shows
// the difference, which is why every assertion here is on the second row.

import { describe, it, expect, vi, beforeEach } from "vitest";

const HOUSEHOLD = "11111111-1111-1111-1111-111111111111";
const PERSONAL = { rowId: "row-personal", itemId: "item-personal", status: "needs_reauth" };
const BUSINESS = { rowId: "row-business", itemId: "item-business", status: "healthy" };

// Two Items at ONE institution, which is the shape the whole test turns on.
let rows: Record<string, { item_id: string; status: string; access_token_ciphertext: string }>;
let lastLookup: string | null;

const tag = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
  const text = typeof strings === "string" ? strings : strings.join("?");
  if (/select item_id, access_token_ciphertext/i.test(text)) {
    // Record WHICH id was asked for. A lookup keyed on institution_id would
    // not pass an item row id here at all.
    lastLookup = String(values.find((v) => typeof v === "string" && String(v).startsWith("row-")) ?? "");
    const row = rows[lastLookup];
    return Promise.resolve(row ? [row] : []);
  }
  if (/update plaid_items/i.test(text)) {
    // MODELS BOTH WHERE CLAUSES, deliberately. The first version only handled
    // `where id = ...`, so a mutation keying on household_id updated NOTHING
    // and the test went red on the repaired row instead of the orphaned one.
    // It reddened for the right outcome by the wrong route, which is a fixture
    // that cannot express the failure it claims to catch.
    if (/where household_id/i.test(text)) {
      for (const row of Object.values(rows)) row.status = "healthy";
    } else {
      const id = String(values.find((v) => typeof v === "string" && String(v).startsWith("row-")) ?? "");
      if (rows[id]) rows[id].status = "healthy";
    }
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
};

vi.mock("postgres", () => ({
  default: () => {
    const sql = tag as unknown as Record<string, unknown> & typeof tag;
    sql.begin = (fn: (tx: unknown) => unknown) => Promise.resolve(fn(tag));
    sql.end = () => Promise.resolve();
    return sql;
  },
}));

const { reconnectItem, markReconnected } = await import("../src/reconnect.js");
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const { encryptToken } = await import("../src/token-crypto.js");

beforeEach(async () => {
  lastLookup = null;
  const ciphertext = await encryptToken("access-sandbox-token", KEY);
  rows = {
    [PERSONAL.rowId]: { item_id: PERSONAL.itemId, status: PERSONAL.status, access_token_ciphertext: ciphertext },
    [BUSINESS.rowId]: { item_id: BUSINESS.itemId, status: BUSINESS.status, access_token_ciphertext: ciphertext },
  };
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ link_token: "link-sandbox-abc" }), { status: 200 })
  );
});

describe("reconnect repairs one Item and leaves the other alone", () => {
  it("looks the Item up by its row id, not by anything about the institution", async () => {
    await reconnectItem(PERSONAL.rowId, HOUSEHOLD, { clientId: "c", secret: "s" }, KEY, "postgres://stub");
    expect(lastLookup).toBe(PERSONAL.rowId);
  });

  it("returns the item id it repaired, so a caller cannot mistake which", async () => {
    const result = await reconnectItem(PERSONAL.rowId, HOUSEHOLD, { clientId: "c", secret: "s" }, KEY, "postgres://stub");
    expect(result.itemId).toBe(PERSONAL.itemId);
  });

  it("sends update mode, since the absence of access_token would create a SECOND Item", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ link_token: "link-sandbox-abc" }), { status: 200 });
    });
    await reconnectItem(PERSONAL.rowId, HOUSEHOLD, { clientId: "c", secret: "s" }, KEY, "postgres://stub");
    expect(sent.access_token, "no access_token means Link creates a new Item rather than repairing one").toBeTruthy();
  });

  // THE ONE THAT CATCHES THE WRONG KEY, and the other Item starts BROKEN so it
  // can. An earlier version left the business Item healthy and asserted it was
  // still healthy, which cannot detect a wrongly-applied "set healthy" at all:
  // the expected and the wrong value were the same string. A fixture whose
  // failure case is indistinguishable from its passing case is the ninth
  // finding, and it was sitting in the assertion named as the important one.
  it("leaves the OTHER Item at the same institution untouched", async () => {
    rows[BUSINESS.rowId].status = "needs_reauth";
    await markReconnected(PERSONAL.rowId, HOUSEHOLD, "postgres://stub");

    expect(rows[PERSONAL.rowId].status, "the repaired Item should be healthy").toBe("healthy");
    // Keyed on the institution or the household, THIS row is written too, and
    // it reads healthy while nobody repaired it. The household then sees a
    // connected account that is not syncing.
    expect(
      rows[BUSINESS.rowId].status,
      "the other login at this institution was cleared; a reconnect keyed on anything but the Item orphans it"
    ).toBe("needs_reauth");
  });

  it("clearing needs_reauth on one Item does not clear it on the other", async () => {
    rows[BUSINESS.rowId].status = "needs_reauth";
    await markReconnected(PERSONAL.rowId, HOUSEHOLD, "postgres://stub");
    expect(rows[PERSONAL.rowId].status).toBe("healthy");
    expect(
      rows[BUSINESS.rowId].status,
      "both Items were cleared, so the household sees a healthy account that is not syncing"
    ).toBe("needs_reauth");
  });
});
