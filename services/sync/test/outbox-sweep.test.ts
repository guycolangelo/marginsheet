// The sweep's blindness and the counter's sight (4.4.5).
//
// TWO CONTROLS, OPPOSITE DIRECTIONS, SAME COLUMN. The sweep must NOT see
// unannounced rows; the counter MUST. Each has to be able to fail on its own,
// so the fixture contains all four quadrants and the stub EVALUATES the
// predicates rather than returning what it was told.
//
// A stub returning canned rows would pass whether or not the enqueued_at clause
// existed, which is the failure this file exists to prevent and the one I have
// written four times this week.

import { describe, it, expect } from "vitest";
import {
  findRepairable, countNeverAnnounced, markEnqueued,
  REPAIR_AFTER_MS, UNANNOUNCED_AFTER_MS,
} from "../src/outbox.js";

const NOW = new Date("2026-08-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

interface Row {
  signal_id: string;
  enqueued_at: Date | null;
  claimed_at: Date | null;
  occurred_at: Date;
  created_at: Date;
}

// All four quadrants. Each row exists so that exactly one reader should see it.
const ROWS: Row[] = [
  // announced, unacknowledged, old: the ONLY thing the sweep should return.
  { signal_id: "repairable", enqueued_at: ago(9e5), claimed_at: null, occurred_at: ago(9e5), created_at: ago(9e5) },
  // announced and already claimed: nobody's work.
  { signal_id: "claimed", enqueued_at: ago(9e5), claimed_at: ago(1e5), occurred_at: ago(9e5), created_at: ago(9e5) },
  // NEVER announced and old: the counter's row, and the sweep must be blind to
  // it. This is the quadrant that separates a repair path from a poller.
  { signal_id: "never-announced", enqueued_at: null, claimed_at: null, occurred_at: ago(9e5), created_at: ago(9e5) },
  // Never announced but recent: the enqueue may still be in flight.
  { signal_id: "just-written", enqueued_at: null, claimed_at: null, occurred_at: ago(1000), created_at: ago(1000) },
];

/** Evaluates the predicates the query actually contains, so a missing clause
 *  changes the result. That is the whole point of this stub. */
function tx(rows: Row[] = ROWS) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ? ").replace(/\s+/g, " ").toLowerCase();
    const cutoff = values.find((v) => v instanceof Date) as Date | undefined;

    let matched = rows;
    if (/enqueued_at is not null/.test(sql)) matched = matched.filter((r) => r.enqueued_at !== null);
    if (/enqueued_at is null/.test(sql)) matched = matched.filter((r) => r.enqueued_at === null);
    if (/claimed_at is null/.test(sql)) matched = matched.filter((r) => r.claimed_at === null);
    if (cutoff && /occurred_at </.test(sql)) matched = matched.filter((r) => r.occurred_at < cutoff);
    if (cutoff && /created_at </.test(sql)) matched = matched.filter((r) => r.created_at < cutoff);

    if (/count\(\*\)/.test(sql)) return Promise.resolve([{ n: matched.length }]);
    return Promise.resolve(matched.map((r) => ({ signal_id: r.signal_id })));
  }) as never;
}

describe("the sweep is BLIND to rows no notification announced", () => {
  it("returns only the announced, unacknowledged, aged row", async () => {
    expect((await findRepairable(tx(), NOW)).map((r) => r.signal_id)).toEqual(["repairable"]);
  });

  it("does not return a row that was never announced", async () => {
    // THE ASSERTION THAT KEEPS IT A REPAIR PATH. If this row can be picked up,
    // the sweep is a poller regardless of what any comment says.
    const found = (await findRepairable(tx(), NOW)).map((r) => r.signal_id);
    expect(found, "the sweep picked up work no notification ever announced").not.toContain("never-announced");
  });

  it("does not return an already-claimed row", async () => {
    expect((await findRepairable(tx(), NOW)).map((r) => r.signal_id)).not.toContain("claimed");
  });

  it("does not repair a notification younger than the threshold", async () => {
    const fresh: Row[] = [{ signal_id: "fresh", enqueued_at: ago(1000), claimed_at: null, occurred_at: ago(1000), created_at: ago(1000) }];
    expect(await findRepairable(tx(fresh), NOW)).toEqual([]);
    expect(REPAIR_AFTER_MS).toBeGreaterThan(1000);
  });
});

describe("the counter SEES exactly the rows the sweep cannot", () => {
  it("counts the never-announced row", async () => {
    // The mirror of the assertion above, on the same row. Together they make
    // the sweep's blindness deliberate rather than accidental.
    expect(await countNeverAnnounced(tx(), NOW)).toBe(1);
  });

  it("does not count a row that WAS announced", async () => {
    const announced: Row[] = [{ signal_id: "a", enqueued_at: ago(9e5), claimed_at: null, occurred_at: ago(9e5), created_at: ago(9e5) }];
    expect(
      await countNeverAnnounced(tx(announced), NOW),
      "the counter counted an announced row, so its silence would mean nothing"
    ).toBe(0);
  });

  it("does not count a row written moments ago, whose enqueue may be in flight", async () => {
    const recent: Row[] = [{ signal_id: "j", enqueued_at: null, claimed_at: null, occurred_at: ago(1000), created_at: ago(1000) }];
    expect(await countNeverAnnounced(tx(recent), NOW)).toBe(0);
    expect(UNANNOUNCED_AFTER_MS).toBeGreaterThan(1000);
  });

  it("reads zero when the window was never hit, and that silence means something", async () => {
    const healthy: Row[] = ROWS.filter((r) => r.enqueued_at !== null);
    expect(await countNeverAnnounced(tx(healthy), NOW)).toBe(0);
  });
});

describe("the two readers partition the same column", () => {
  it("no row is returned by both", async () => {
    const swept = new Set((await findRepairable(tx(), NOW)).map((r) => r.signal_id));
    // The counter's row by construction: unannounced and old.
    expect(swept.has("never-announced")).toBe(false);
    expect(await countNeverAnnounced(tx(), NOW)).toBe(1);
  });
});

describe("markEnqueued records the announcement", () => {
  it("sets enqueued_at, which is what makes NULL mean never announced", async () => {
    const issued: string[] = [];
    const rec = ((s: TemplateStringsArray) => { issued.push(s.join(" ")); return Promise.resolve([]); }) as never;
    await markEnqueued(rec, "11111111-1111-4111-8111-111111111111", "sig-1");
    expect(issued.join(" ")).toMatch(/set enqueued_at = now\(\)/i);
  });
});
