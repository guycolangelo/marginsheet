// An exported function whose only caller is its own test cannot fail.
//
// FOUND 21 AUG 2026 BY ASKING WHY /liabilities/get HAD NEVER BEEN CALLED.
// fetch-liabilities.ts shipped with its gate, its migration, its coverage
// states, its grant, its declared consent and five passing database tests.
// ITS ONLY CALLER WAS ITS OWN TEST. Every check around it was green because
// every check around it was about a part that existed.
//
// THE TEST BEING A CALLER IS WHAT MADE IT LOOK WIRED. A module with imports,
// exercised against a real database, reads as connected. Nothing distinguishes
// "this runs in production" from "this runs in CI", and the second is the state
// a feature reaches on the way to the first and can stay in indefinitely.
//
// IT IS THE EIGHTH FINDING'S SHAPE APPLIED TO FEATURES RATHER THAN CONTROLS.
// That one was about a mechanism for remembering failures that guarded nothing.
// This is about mechanisms for doing work that run nowhere, and it was found
// the same way: by trying to use one.
//
// WHAT THE ALLOWLIST MEANS. An entry is a feature that is BUILT AND NOT WIRED,
// carrying an open item that says so. Carrying such an item is legitimate;
// carrying an unowned one is not, which is why every entry names its id and the
// open-items check fails on an item with no owner.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

/** Exported functions with no production caller, each with the open item that
 *  owns wiring it. THE LIST ONLY SHRINKS. Adding to it is declaring that a
 *  feature was built and left unreachable, which is a decision somebody makes
 *  deliberately rather than a state a module drifts into. */
const BUILT_AND_NOT_WIRED: Record<string, string> = {
  "outbox.ts:markEnqueued": "outbox-announcer-is-built-and-unwired",
  "outbox.ts:findRepairable": "outbox-announcer-is-built-and-unwired",
  "outbox.ts:countNeverAnnounced": "outbox-announcer-is-built-and-unwired",
};

/** FIELDS ARE WATCHED TOO, BECAUSE THE SCAN ONLY SEES FUNCTIONS.
 *
 *  A field read by nothing is one refactor from deletion, and unlike an
 *  unexported function it leaves no signature behind to notice. driftingAccounts
 *  is returned by reconcileBalances and consumed by nobody, deliberately: the
 *  block that will read it belongs to M6b, the first surface that ships a
 *  customer-visible number, and it cannot exist before something ships one.
 *
 *  Same construction as BUILT_AND_NOT_WIRED: an entry must name an open item
 *  that exists and has an owner, and must still be unreferenced, so the list
 *  cannot rot in either direction. */
const WATCHED_FIELDS: Record<string, string> = {
  "reconcile-balances.ts:driftingAccounts": "reconciliation-drift-has-no-surfacing-path",
};

interface Export { file: string; name: string }

function sources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(SRC)) {
    if (f.endsWith(".ts") && !f.endsWith(".d.ts")) out[f] = readFileSync(join(SRC, f), "utf8");
  }
  return out;
}

const files = sources();

const exported: Export[] = Object.entries(files).flatMap(([file, body]) =>
  [...body.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => ({ file, name: m[1] }))
);

/** Referenced from ANY src file, including its own: a helper called only within
 *  its module is wired, so long as something calls into that module. Same-file
 *  use was a false positive in the first version of this scan and it mattered:
 *  plaidTotals is called one function down from where it is declared. */
function referencedInSrc(e: Export): boolean {
  const pattern = new RegExp(`\\b${e.name}\\b`);
  for (const [file, body] of Object.entries(files)) {
    if (file === e.file) {
      // Strip the declaration itself before looking.
      const withoutDecl = body.replace(new RegExp(`^export (?:async )?function ${e.name}\\b`, "m"), "");
      if (pattern.test(withoutDecl)) return true;
      continue;
    }
    if (pattern.test(body)) return true;
  }
  return false;
}

describe("every exported function is reachable from production code", () => {
  it("finds exports at all, so an empty scan cannot pass", () => {
    expect(exported.length, "the scan found no exports; it is looking in the wrong place").toBeGreaterThan(20);
  });

  it("no export is unreachable without being declared as such", () => {
    const orphans = exported
      .filter((e) => !referencedInSrc(e))
      .map((e) => `${e.file}:${e.name}`)
      .filter((k) => !(k in BUILT_AND_NOT_WIRED))
      .sort();

    expect(
      orphans,
      "these exported functions have no caller in services/sync/src, so they run only in tests. " +
        "That is how /liabilities/get shipped complete and was never called. Wire it, delete it, " +
        "or add it to BUILT_AND_NOT_WIRED with an open item that owns wiring it."
    ).toEqual([]);
  });

  it("every declared orphan names an open item that exists and has an owner", () => {
    // WITHOUT THIS THE ALLOWLIST IS A SUPPRESSION. An entry pointing at nothing
    // is the same as no entry, and it would read as reviewed.
    const itemsPath = join(import.meta.dirname, "..", "..", "..", "docs", "open-items.json");
    expect(existsSync(itemsPath)).toBe(true);
    const items = JSON.parse(readFileSync(itemsPath, "utf8")) as Array<{ id: string; owner: string }>;
    const known = new Map(items.map((i) => [i.id, i.owner]));

    for (const [key, id] of Object.entries(BUILT_AND_NOT_WIRED)) {
      expect(known.has(id), `${key} points at open item "${id}", which does not exist`).toBe(true);
      expect(known.get(id), `open item "${id}" has no owner`).toBeTruthy();
    }
  });

  it("every watched field still exists and is still unconsumed", () => {
    // BOTH DIRECTIONS. Gone means a refactor deleted the field the M6b block is
    // owed; consumed means something now reads it and the entry should go.
    const itemsPath = join(import.meta.dirname, "..", "..", "..", "docs", "open-items.json");
    const items = JSON.parse(readFileSync(itemsPath, "utf8")) as Array<{ id: string; owner: string }>;
    const known = new Map(items.map((i) => [i.id, i.owner]));

    for (const [key, itemId] of Object.entries(WATCHED_FIELDS)) {
      const [file, field] = key.split(":");
      const body = files[file];
      expect(body, `${key} names a file that no longer exists`).toBeTruthy();
      expect(
        new RegExp(`\\b${field}\\b`).test(body),
        `${key} is gone. A field nothing reads is one refactor from deletion, and this one is owed to a consumer that does not exist yet.`
      ).toBe(true);

      const consumers = Object.entries(files).filter(
        ([f, b]) => f !== file && new RegExp(`\\b${field}\\b`).test(b)
      );
      expect(
        consumers.map(([f]) => f),
        `${key} now has a consumer. Remove it from WATCHED_FIELDS and close ${itemId}.`
      ).toEqual([]);

      expect(known.has(itemId), `${key} names open item "${itemId}", which does not exist`).toBe(true);
      expect(known.get(itemId), `open item "${itemId}" has no owner`).toBeTruthy();
    }
  });

  it("every declared orphan is STILL an orphan, so the list cannot rot", () => {
    // A wired feature left on this list is a standing claim that it does not
    // run, which sends the next reader to build something that exists.
    for (const key of Object.keys(BUILT_AND_NOT_WIRED)) {
      const [file, name] = key.split(":");
      expect(
        referencedInSrc({ file, name }),
        `${key} is declared as built-and-not-wired and now HAS a caller. Remove it from the list.`
      ).toBe(false);
    }
  });
});
