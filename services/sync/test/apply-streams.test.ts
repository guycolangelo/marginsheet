// The two rules that fail silently if broken (4.4.4).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyRemoved, applyAddedAndModified, markFirstSyncCompleted, didChange } from "../src/apply-streams.js";

const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";

/** Records the SQL each call issues, so the SHAPE can be asserted.
 *
 *  INTERPOLATED VALUES ARE RECORDED TOO, and that is not cosmetic. The first
 *  version joined only the static template parts, so anything passed as `${...}`
 *  was invisible: an assertion that the writer emits `expense` for a positive
 *  amount could not see the value it was asserting on, and failed against
 *  correct code. A recorder that drops half the statement can only test the
 *  half it kept. */
function recorder(rowsFor: (sql: string) => unknown[] = () => []) {
  const issued: string[] = [];
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .map((part, i) => part + (i < values.length ? String(values[i]) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
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

describe("the transaction writer", () => {
  it("names the household in the insert, the lookup AND the conflict clause", async () => {
    // THREE PLACES, AND EACH IS A SEPARATE WAY TO CROSS THE BOUNDARY.
    // plaid_transaction_id is PLAID's namespace, shared across households: two
    // households on one joint account see the same id. So the insert scopes the
    // row, the account lookup scopes which account it may attach to, and the
    // conflict clause scopes which existing row it may update.
    //
    // Migration 0026 constrains this role to the declared household and is the
    // BACKSTOP rather than the mechanism. Both hold independently, which is why
    // the removed-stream predicate landed before the policy did.
    const { tx, issued } = recorder();
    await applyAddedAndModified(tx, HOUSEHOLD, [
      { transaction_id: "t1", account_id: "acct_1", date: "2026-08-01", amount: 12.5 },
    ]);
    const sql = issued.join(" ");
    expect(sql, "the account lookup is not scoped to the household").toMatch(
      /from financial_accounts fa where fa\.household_id =/i
    );
    expect(sql, "the conflict clause does not name the household").toMatch(
      /where transactions\.household_id =/i
    );
  });

  it("carries pending through on conflict, because that is the settle", async () => {
    // A modified row arriving with pending=false IS a pending transaction
    // becoming posted. If the update did not set pending, the row would stay
    // pending forever and categorization-spec section 10 would never fire on
    // real data. This is the transition Sandbox cannot construct, which is why
    // the assertion is on the statement rather than on an observed settle.
    const { tx, issued } = recorder();
    await applyAddedAndModified(tx, HOUSEHOLD, [
      { transaction_id: "t1", account_id: "a", date: "2026-08-01", amount: 1, pending: false },
    ]);
    expect(issued.join(" ")).toMatch(/pending = excluded\.pending/i);
  });

  it("signs direction from Plaid's convention rather than guessing", async () => {
    // Plaid signs money LEAVING the account positive. Getting this backwards
    // would invert every figure in the ledger while every test about counts
    // stayed green.
    const { tx, issued } = recorder();
    await applyAddedAndModified(tx, HOUSEHOLD, [
      { transaction_id: "out", account_id: "a", date: "2026-08-01", amount: 40 },
      { transaction_id: "in", account_id: "a", date: "2026-08-01", amount: -40 },
    ]);
    expect(issued[0]).toMatch(/expense/);
    expect(issued[1]).toMatch(/income/);
  });

  it("returns rows WRITTEN, not rows offered", async () => {
    // They differ when a transaction names an account this household does not
    // hold: the select finds nothing and the insert writes nothing. Returning
    // the input length would report success for work that did not happen.
    const { tx } = recorder(() => []);
    expect(
      await applyAddedAndModified(tx, HOUSEHOLD, [
        { transaction_id: "t1", account_id: "not-ours", date: "2026-08-01", amount: 1 },
      ])
    ).toBe(0);
  });

  it("writes nothing for an empty stream", async () => {
    const { tx, issued } = recorder();
    expect(await applyAddedAndModified(tx, HOUSEHOLD, [])).toBe(0);
    expect(issued).toEqual([]);
  });
});

describe("the runner is reachable, which the previous version was not", () => {
  it("a route calls runSyncForItem", () => {
    // 4.5b prime was reported as six pieces built when it was five plus a
    // function nobody could call. THAT IS THE EXACT DEFECT 4.4 WAS CRITICISED
    // FOR: runTransactionsSync existed, counted rows, and had no caller, so a
    // sync was correct about cursors and wrote nothing.
    //
    // Repeating it one task later, while holding the criticism, is why this
    // assertion exists rather than a note. A function with no caller is not a
    // built piece, and nothing else in the suite would have noticed: every
    // test of the runner calls it directly.
    const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
    expect(index, "runSyncForItem has no route").toMatch(/runSyncForItem\(/);
    expect(index).toMatch(/"\/internal\/sync-run"/);
  });

  it("one failing Item does not hide the others", () => {
    // A household with four banks should learn WHICH one broke. Letting the
    // first failure escape would report "the sync failed" and lose the three
    // that worked, which is the same shape as a count that reports what was
    // asked for rather than what happened.
    const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
    const route = index.slice(index.indexOf('"/internal/sync-run"'));
    expect(route.slice(0, 2400)).toMatch(/failed: true/);
  });
});
