// The gate, and the two ways it was wrong.
//
// FIXTURE 2 IS THE ONE THAT MATTERS AND IT IS THE ONE THAT LOOKS POINTLESS.
// "Nothing moved, so nothing fires" reads as a triviality. It is the only
// fixture that fails against the obvious wrong implementation -- keying
// balances_updated on accounts REFRESHED rather than accounts CHANGED -- and
// that implementation is what a reasonable engineer writes first, because
// applyBalances already returns the refreshed set and reconciliation already
// uses it.
//
// A FIXTURE OF TRANSACTION-BEARING SYNCS CANNOT FAIL. Every one of them passes
// against the code as it shipped, because the old gate fired on transactions
// and transactions are present. The cases that discriminate are the ones with
// no transactions at all.

import { describe, it, expect } from "vitest";
import { changedKinds, countsByKind, SIGNAL_KINDS, type SyncChanges } from "../src/state-signal.js";

const NOTHING: SyncChanges = {
  transactionsAdded: 0,
  transactionsModified: 0,
  transactionsRemoved: 0,
  balancesChanged: 0,
  liabilitiesChanged: 0,
  itemStatusChanged: false,
};

describe("the gate reads what the sync did, not what one stream did", () => {
  it("FIXTURE 1: balances moved and no transaction arrived, so it fires", () => {
    // THE CASE THAT FIRED NOTHING BEFORE. didChange was a pure function of the
    // transaction counts, so this exact sync -- balances refreshed, snapshots
    // written, no new transactions -- produced no signal at all.
    const kinds = changedKinds({ ...NOTHING, balancesChanged: 2 });
    expect(kinds).toEqual(["balances_updated"]);
  });

  it("FIXTURE 2: nothing moved, so nothing fires", () => {
    // The gate's whole purpose. A watcher waking for nothing is how a watcher
    // becomes noise, and this is the assertion that a wider input did not
    // become a looser gate.
    expect(changedKinds(NOTHING)).toEqual([]);
    expect(countsByKind(NOTHING)).toEqual({});
  });

  it("FIXTURE 3: liabilities moved alone", () => {
    expect(changedKinds({ ...NOTHING, liabilitiesChanged: 1 })).toEqual(["liabilities_updated"]);
  });

  it("FIXTURE 4: the Item's status moved alone", () => {
    expect(changedKinds({ ...NOTHING, itemStatusChanged: true })).toEqual(["item_status_changed"]);
  });

  it("reports every kind that moved, not the first one", () => {
    const kinds = changedKinds({
      transactionsAdded: 3, transactionsModified: 1, transactionsRemoved: 2,
      balancesChanged: 4, liabilitiesChanged: 5, itemStatusChanged: true,
    });
    expect([...kinds].sort()).toEqual([
      "balances_updated", "item_status_changed", "liabilities_updated",
      "transactions_added", "transactions_modified", "transactions_removed",
    ]);
  });
});

describe("the payload matches the contract", () => {
  it("keys counts by the kind name, so counts[kind] resolves", () => {
    // THE MISMATCH THIS REPLACES. `changed` held 'transactions_added' while
    // `counts` held { added }, so the obvious consumer read counts[kind] and
    // got undefined for every kind -- silently, and in the direction that looks
    // like zero, which is the worst direction for a number a watcher uses to
    // decide whether something is material.
    const c: SyncChanges = { ...NOTHING, transactionsAdded: 7, balancesChanged: 2 };
    const counts = countsByKind(c);
    for (const kind of changedKinds(c)) {
      expect(counts[kind], `counts has no entry for the kind '${kind}' it fired`).toBeGreaterThan(0);
    }
    expect(counts).toEqual({ transactions_added: 7, balances_updated: 2 });
  });

  it("counts and kinds describe the same set, in both directions", () => {
    const c: SyncChanges = {
      transactionsAdded: 1, transactionsModified: 0, transactionsRemoved: 4,
      balancesChanged: 0, liabilitiesChanged: 2, itemStatusChanged: true,
    };
    expect(Object.keys(countsByKind(c)).sort()).toEqual([...changedKinds(c)].sort());
  });

  it("carries no zero counts, because a zero is a count of something that did not happen", () => {
    expect(countsByKind({ ...NOTHING, transactionsAdded: 5 })).toEqual({ transactions_added: 5 });
  });

  it("every kind it can emit is one the contract names", () => {
    // The database's changed_kinds CHECK carries the same list and would refuse
    // an unknown kind. This asserts the writer agrees with it rather than
    // relying on being refused.
    const everything = changedKinds({
      transactionsAdded: 1, transactionsModified: 1, transactionsRemoved: 1,
      balancesChanged: 1, liabilitiesChanged: 1, itemStatusChanged: true,
    });
    for (const k of everything) expect(SIGNAL_KINDS).toContain(k);
  });

  it("names all seven kinds, including the one nothing writes yet", () => {
    // recurring_updated has no detector because nothing fetches recurring. The
    // constant still carries it, so the day the fetch lands the kind is already
    // the contract's rather than invented by whoever wires it.
    expect(SIGNAL_KINDS).toHaveLength(7);
    expect(SIGNAL_KINDS).toContain("recurring_updated");
  });
});
