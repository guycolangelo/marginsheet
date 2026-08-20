// The two rules that fail silently if broken (4.4.4).

import { describe, it, expect } from "vitest";
import { applyRemoved, markFirstSyncCompleted, didChange } from "../src/apply-streams.js";

const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";

/** Records the SQL each call issues, so the SHAPE can be asserted. */
function recorder(rowsFor: (sql: string) => unknown[] = () => []) {
  const issued: string[] = [];
  const tx = ((strings: TemplateStringsArray, ..._v: unknown[]) => {
    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    issued.push(text);
    return Promise.resolve(rowsFor(text));
  }) as never;
  return { tx, issued };
}

describe("removed transactions are FLAGGED, never deleted", () => {
  it("issues an update and no delete", async () => {
    const { tx, issued } = recorder();
    await applyRemoved(tx, HOUSEHOLD, ["tx_1", "tx_2"]);
    expect(issued.join(" ")).toMatch(/update transactions/i);
    // A DELETE loses a row nobody can reconstruct, and the household would see
    // a month's Kept figure change with no record of why.
    expect(issued.join(" "), "the removed stream deleted rows").not.toMatch(/delete\s+from/i);
  });

  it("sets removed = true rather than clearing anything", async () => {
    const { tx, issued } = recorder();
    await applyRemoved(tx, HOUSEHOLD, ["tx_1"]);
    expect(issued.join(" ")).toMatch(/set removed = true/i);
  });

  it("issues nothing at all for an empty stream", async () => {
    const { tx, issued } = recorder();
    expect(await applyRemoved(tx, HOUSEHOLD, [])).toBe(0);
    expect(issued).toEqual([]);
  });
});

describe("first_sync_completed_at is set once", () => {
  it("guards on IS NULL in the WHERE clause, not by reading first", async () => {
    // A read-then-write races: two Items finishing their first sync together
    // both read NULL and both write, and the second moves a timestamp other
    // modules treat as immutable.
    const { tx, issued } = recorder(() => [{ id: "h1" }]);
    await markFirstSyncCompleted(tx, "h1");
    expect(issued.join(" ")).toMatch(/first_sync_completed_at is null/i);
    // One statement. A select followed by an update would be two.
    expect(issued.length, "the set-once guard was a read followed by a write").toBe(1);
  });

  it("reports true when it was the call that set it", async () => {
    const { tx } = recorder(() => [{ id: "h1" }]);
    expect(await markFirstSyncCompleted(tx, "h1")).toBe(true);
  });

  it("reports false when it was already set, so a second sync does not re-arm the intro", async () => {
    // THE STUB MODELS THE GUARD RATHER THAN ASSUMING IT. Returning [] flatly
    // would pass whether or not the WHERE clause exists, so this test could not
    // fail: it would assert that a stub I wrote returns what I told it to.
    // Instead the row is withheld only when the guard is present, which is what
    // Postgres would do for an already-set household.
    const { tx } = recorder((sql) =>
      /first_sync_completed_at is null/i.test(sql) ? [] : [{ id: "h1" }]
    );
    expect(
      await markFirstSyncCompleted(tx, "h1"),
      "a second sync claimed the first-sync milestone and would introduce the household twice"
    ).toBe(false);
  });
});

describe("a sync that changed nothing reports no change", () => {
  it("is false for an empty sync", () => {
    expect(didChange({ added: 0, modified: 0, removed: 0 })).toBe(false);
  });
  it("is true when any stream moved", () => {
    expect(didChange({ added: 0, modified: 0, removed: 1 })).toBe(true);
    expect(didChange({ added: 1, modified: 0, removed: 0 })).toBe(true);
  });
});

describe("the removed stream names the household", () => {
  it("scopes the update by household_id, not by plaid_transaction_id alone", async () => {
    // CONFIRMED CROSS-HOUSEHOLD ON 19 AUG 2026, not suspected: issued as
    // household A with A's GUC set, this statement flagged household B's
    // transaction removed and threw nothing. sync_worker_access is
    // USING (true), so RLS never scoped it and the GUC was decorative.
    //
    // `removed` decides what a household is told they spent, so a false flag
    // is wrong data in a close rather than a broken connection.
    const { tx, issued } = recorder();
    await applyRemoved(tx, HOUSEHOLD, ["tx_1"]);
    const sql = issued.join(" ");
    expect(sql, "the update does not name a household").toMatch(/where household_id =/i);
    expect(sql).toMatch(/and plaid_transaction_id = any/i);
  });

  it("returns rows ACTUALLY flagged, not ids offered", async () => {
    // The two differ exactly when an id belongs to somebody else. Returning the
    // input length would report success for work that did not happen, which is
    // the same shape as a control that cannot fail.
    const { tx } = recorder(() => [{ id: "one" }]);
    expect(await applyRemoved(tx, HOUSEHOLD, ["tx_1", "tx_2", "tx_3"])).toBe(1);
  });
});
