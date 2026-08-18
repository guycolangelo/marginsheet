// The watchdog threshold (4.4.3).
//
// THE FIXTURE'S FAILURE CASE IS A HEALTHY LONG BACKFILL, and it has to exist
// among the values the fixture can take or this proves nothing. A test whose
// syncs all start recently cannot distinguish "measures from last progress"
// from "measures from sync start": both answer the same for a short sync.
//
// So the central case is an Item that started FOUR HOURS AGO and wrote a cursor
// ONE MINUTE AGO. Measured from start it is long overdue. Measured from
// progress it is working. Only one of those answers is right, and the two
// disagree only when the fixture contains this shape.

import { describe, it, expect } from "vitest";
import { sweepReason, onWebhook, onSyncComplete, STALE_AFTER_MS } from "../src/sync-state.js";

const NOW = new Date("2026-08-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("the threshold measures progress, not elapsed time", () => {
  it("does NOT sweep a four-hour backfill that wrote a cursor a minute ago", () => {
    // THE CASE THAT SEPARATES THE TWO IMPLEMENTATIONS. Measured from sync
    // start this is swept, the sweep sets it back to queued, another sync
    // starts and is swept again, and an Item that is working perfectly never
    // finishes while every status looks busy.
    expect(
      sweepReason(
        { syncStatus: "syncing", syncStartedAt: ago(4 * HOUR), lastCursorAt: ago(1 * MINUTE) },
        NOW
      ),
      "a backfill making steady progress was swept for having run a long time"
    ).toBeNull();
  });

  it("DOES sweep a sync that started a minute ago and has written nothing since", () => {
    // The mirror image: recent start, no progress. Elapsed time says healthy,
    // progress says dead. Included so the fixture cannot pass by always
    // answering "do not sweep".
    expect(
      sweepReason(
        { syncStatus: "syncing", syncStartedAt: ago(1 * MINUTE), lastCursorAt: ago(11 * MINUTE) },
        NOW
      )
    ).toMatch(/no cursor written/);
  });

  it("sweeps an Item whose last cursor is older than the threshold", () => {
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: ago(2 * HOUR), lastCursorAt: ago(STALE_AFTER_MS + 1000) }, NOW)
    ).toMatch(/no cursor written/);
  });

  it("does not sweep an Item exactly at the threshold", () => {
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: ago(2 * HOUR), lastCursorAt: ago(STALE_AFTER_MS - 1000) }, NOW)
    ).toBeNull();
  });
});

describe("the never-persisted case falls back to start, and only that case", () => {
  it("sweeps a sync that has not completed a single page in time", () => {
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: ago(STALE_AFTER_MS + 1000), lastCursorAt: null }, NOW)
    ).toMatch(/no first page/);
  });

  it("does not sweep a sync that started recently and has not paged yet", () => {
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: ago(30_000), lastCursorAt: null }, NOW)
    ).toBeNull();
  });

  it("sweeps a syncing row with neither clock, because nothing can reason about it", () => {
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: null, lastCursorAt: null }, NOW)
    ).toMatch(/no start time and no cursor/);
  });
});

describe("only syncing Items are swept", () => {
  for (const status of ["idle", "queued", "error"] as const) {
    it(`leaves ${status} alone however old`, () => {
      expect(
        sweepReason({ syncStatus: status, syncStartedAt: ago(9 * HOUR), lastCursorAt: ago(9 * HOUR) }, NOW)
      ).toBeNull();
    });
  }
});

describe("the reason is returned, not a boolean", () => {
  it("names which condition fired, so a sweep can be audited", () => {
    // A watchdog reporting only "stuck" cannot be distinguished from one
    // sweeping healthy backfills, which is the failure this file exists for.
    const noProgress = sweepReason({ syncStatus: "syncing", syncStartedAt: ago(HOUR), lastCursorAt: ago(HOUR) }, NOW);
    const noFirstPage = sweepReason({ syncStatus: "syncing", syncStartedAt: ago(HOUR), lastCursorAt: null }, NOW);
    expect(noProgress).not.toBe(noFirstPage);
  });
});

describe("the state machine", () => {
  it("a webhook mid-sync queues a follow-up rather than starting a second sync", () => {
    expect(onWebhook("syncing")).toBe("queued");
  });

  it("finishing while queued stays queued, so the follow-up is owed", () => {
    expect(onSyncComplete("queued")).toBe("queued");
  });

  it("finishing while not queued returns to idle", () => {
    expect(onSyncComplete("syncing")).toBe("idle");
  });
});
