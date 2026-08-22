// The completion asks Plaid before it marks anything.
//
// Link update mode reuses the existing access token, so nothing is exchanged
// and NOTHING IN THE RESPONSE PROVES THE REPAIR WORKED. A completion route that
// simply marked the Item healthy would be claiming a repair it had not
// verified, and markReconnected's own comment already names that outcome as
// worse than leaving the status set: a household seeing a healthy account that
// is not syncing has no reason to look at it again.
//
// SO THE FIXTURE'S FAILING CASE IS A HOUSEHOLD WHO CLOSED LINK WITHOUT
// FINISHING. That is the ordinary case, not the edge: people abandon flows. It
// must leave needs_reauth exactly as it was, and a suite whose Plaid always
// answers "live" cannot tell a route that checks from one that assumes.

import { describe, it, expect, vi, beforeEach } from "vitest";

const plaid = vi.hoisted(() => ({ status: vi.fn(), mark: vi.fn() }));

vi.mock("../src/item-status.js", () => ({ itemStatus: plaid.status }));
vi.mock("../src/reconnect.js", () => ({ markReconnected: plaid.mark }));

const { completeReconnect } = await import("../src/reconnect-complete.js");

const run = () =>
  completeReconnect("hh", "row-1", "plaid-item-1", { clientId: "x", secret: "y" } as never, "key", "db");

beforeEach(() => {
  plaid.status.mockReset();
  plaid.mark.mockReset();
  plaid.mark.mockResolvedValue({ marked: 1 });
});

describe("completeReconnect", () => {
  it("marks healthy when Plaid reports the Item live", async () => {
    plaid.status.mockResolvedValue({ itemId: "plaid-item-1", liveness: "live", detail: {} });
    const r = await run();
    expect(r.repaired).toBe(true);
    expect(r.marked).toBe(1);
    expect(plaid.mark).toHaveBeenCalledOnce();
  });

  it("MARKS NOTHING when the household closed Link without finishing", async () => {
    // THE ASSERTION THE ROUTE EXISTS FOR. Plaid still refuses, so the Item is
    // still broken, and the row must be left saying so.
    plaid.status.mockResolvedValue({ itemId: "plaid-item-1", liveness: "unknown", detail: { error: "ITEM_LOGIN_REQUIRED" } });
    const r = await run();
    expect(r.repaired).toBe(false);
    expect(r.marked).toBe(0);
    expect(plaid.mark, "it marked the Item healthy without evidence").not.toHaveBeenCalled();
    expect(r.note).toMatch(/left in needs_reauth/);
  });

  it("marks nothing, and says so differently, when the Item is GONE", async () => {
    // Gone and not-live are different sentences: one needs a fresh connection,
    // the other needs the household to finish the flow. Collapsing them would
    // send somebody to re-run an update that cannot work.
    plaid.status.mockResolvedValue({ itemId: "plaid-item-1", liveness: "gone", detail: {} });
    const r = await run();
    expect(r.repaired).toBe(false);
    expect(plaid.mark).not.toHaveBeenCalled();
    expect(r.note).toMatch(/needs a fresh connection/);
  });

  it("reports a LIVE Item that marked no rows rather than calling it repaired", async () => {
    // Rows actually marked, never the id handed in. Zero with a live Item means
    // the row is not this household's or the setting did not reach the
    // statement, and reporting "repaired" from Plaid's answer alone is the
    // disconnect's defect inverted: there, the Item was removed and the row was
    // never marked, and the route said it had been.
    plaid.status.mockResolvedValue({ itemId: "plaid-item-1", liveness: "live", detail: {} });
    plaid.mark.mockResolvedValue({ marked: 0 });
    const r = await run();
    expect(r.liveness).toBe("live");
    expect(r.repaired, "a live Plaid answer was reported as a repair with no row changed").toBe(false);
    expect(r.note).toMatch(/NO ROW WAS MARKED/);
  });
});
