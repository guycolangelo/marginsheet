// The watchdog threshold (4.4.3, amended by 4.8 and amendment 15).
//
// THE PROGRESS BRANCH AND ITS TESTS WERE DELETED, NOT ADAPTED. This file used
// to open by saying its central case was an Item that started four hours ago
// and wrote a cursor one minute ago, because only that shape distinguishes
// "measures from progress" from "measures from start".
//
// It was a good fixture for a branch that could never fire. run-sync writes
// last_cursor_at inside the main transaction, so a syncing Item has no
// committed cursor from its own run, and Plaid rejects mid-pagination
// bookmarks, so a committed one could never be resumed from anyway. Ruled B on
// 22 Aug 2026: start-only, and the branch deleted rather than left unreachable,
// because an unreachable branch with its own tests is the coverage inversion
// with our name on it.
//
// WHAT THE FIXTURE MUST STILL CONTAIN. Both sides of the threshold, so it
// cannot pass by always answering one way, and the boundary itself, because
// "exceeds" and "reaches" are one character apart in the implementation.

import { describe, it, expect } from "vitest";
import { sweepReason, onWebhook, onSyncComplete, STALE_AFTER_MS } from "../src/sync-state.js";

const NOW = new Date("2026-08-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("the threshold measures elapsed time from the start of THIS sync", () => {
  it("sweeps a sync that has run past the threshold", () => {
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: ago(STALE_AFTER_MS + MINUTE) }, NOW)
    ).toMatch(/running for \d+s without completing/);
  });

  it("does NOT sweep a sync still inside it", () => {
    // Included so the fixture cannot pass by always answering "sweep", which
    // is the direction that cancels a working backfill.
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: ago(STALE_AFTER_MS - MINUTE) }, NOW),
      "a sync inside the threshold was swept"
    ).toBeNull();
  });

  it("does not sweep an Item exactly AT the threshold", () => {
    // The boundary, because the implementation is > rather than >= and the two
    // differ by one character.
    expect(sweepReason({ syncStatus: "syncing", syncStartedAt: ago(STALE_AFTER_MS) }, NOW)).toBeNull();
  });

  it("sweeps an Item marked syncing with NO start time", () => {
    // Nothing can reason about that row, and stuck forever is worse than
    // returned to a re-syncable state. It also cannot happen through the
    // marker, whose statement writes both in one go, so reaching it is
    // evidence of a write nobody here made.
    expect(
      sweepReason({ syncStatus: "syncing", syncStartedAt: null }, NOW)
    ).toMatch(/no start time/);
  });

});

describe("only syncing Items are swept", () => {
  for (const status of ["idle", "queued", "error"] as const) {
    it(`leaves ${status} alone however old`, () => {
      expect(
        sweepReason({ syncStatus: status, syncStartedAt: ago(9 * HOUR)}, NOW)
      ).toBeNull();
    });
  }
});

describe("the reason is returned, not a boolean", () => {
  it("names which condition fired, so a sweep can be audited", () => {
    // A watchdog reporting only "stuck" cannot be told apart from one sweeping
    // healthy backfills, which is the failure this file exists for.
    //
    // IT COMPARED THE TWO BRANCHES AND ONE OF THEM WAS DELETED. As written it
    // called sweepReason twice with identical arguments and asserted the
    // results differed, which passed only while a second branch existed to
    // reach. After the deletion it compared a value to itself. Rewritten
    // against the two branches that remain rather than dropped, because the
    // property it tests is still true and still worth holding.
    const ranTooLong = sweepReason(
      { syncStatus: "syncing", syncStartedAt: ago(STALE_AFTER_MS + MINUTE) }, NOW
    );
    const noClock = sweepReason({ syncStatus: "syncing", syncStartedAt: null }, NOW);

    expect(ranTooLong).not.toBeNull();
    expect(noClock).not.toBeNull();
    expect(ranTooLong, "both branches return the same string, so a sweep cannot be audited").not.toBe(noClock);
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
