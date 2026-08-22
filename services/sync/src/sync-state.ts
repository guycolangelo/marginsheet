// The coordination state machine and the watchdog (M4 task 4.4.3, amended by
// 4.8 and by amendment 15).
//
// THE WATCHDOG MEASURES FROM SYNC START. It did not always, and the reason it
// no longer measures from progress is the whole of this file's design content.
//
// AS BUILT IN 4.4 it measured from last cursor persistence, because a first
// backfill of 20,000 transactions reads as stuck when measured from start and
// gets swept mid-flight: the sweep sets it back, another sync starts, it is
// swept again, and an Item that is working perfectly never finishes.
//
// THAT REASONING IS CORRECT AND THE INPUT DOES NOT EXIST. run-sync writes
// last_cursor_at per page INSIDE the main transaction, so no cursor write is
// visible until the whole sync commits, at which point the status is already
// idle. So an Item that is `syncing` holds no committed cursor from its own
// run, and the value it does hold belongs to the PREVIOUS successful sync. The branch could not fire and, when it appeared to, it was reading
// another run's progress.
//
// RULED B, 22 AUG 2026 (Guy), AND THE DECIDING FACT COMES FROM 4.2 RATHER THAN
// FROM THE WATCHDOG. PLAID REJECTS MID-PAGINATION BOOKMARKS, which is why two
// cursors exist. So a per-page COMMITTED cursor could never be resumed from: a
// crashed sync restarts from last_completed_cursor whatever progress was
// visible. Persisting cursors outside the main transaction would therefore buy
// PROGRESS THAT CAN ONLY BE OBSERVED AND NEVER ACTED ON, and pay for it by
// opening a crash seam between a cursor and its page's rows inside the
// transaction that holds streams, balances, reconciliation and liabilities.
// OBSERVABILITY WITH NO RESUMABILITY, PRICED IN ATOMICITY.
//
// B's cost is recovery latency on a hung sync, which a webhook-driven digest
// product can afford. Different species of cost, and the ruling follows.
//
// THE PROGRESS BRANCH IS DELETED RATHER THAN LEFT UNREACHABLE. An unreachable
// branch with its own tests is the coverage inversion in its purest form:
// elaboration in CI, permanently, in the file where that class was named. What
// was removed and the condition under which it could return are recorded in
// amendment 15.

/** MIRRORS THE sync_status ENUM AND 0041 ADDED A VALUE TO IT. A type and a
 *  database column are two statements of one fact, and this one drifted for
 *  the length of a single commit: typecheck caught 'swept' missing here after
 *  the migration added it there. */
export type SyncStatus = "idle" | "syncing" | "queued" | "error" | "swept";

/** How long a sync may run before it is presumed abandoned.
 *
 *  DERIVED FROM THE WORST OBSERVED BACKFILL RATHER THAN CHOSEN. The only
 *  measured throughput is SoFi's first sync, recorded in migration 0031: 1,560
 *  transactions in 47 seconds, or 33 rows per second. Amex's 5,241-row first
 *  sync is the largest observed and computes to roughly 2.6 minutes at that
 *  rate. Thirty minutes is a 10x multiple of the worst case observed, and it
 *  still clears a hypothetical 20,000-row backfill, which computes to 10
 *  minutes, with 3x headroom.
 *
 *  IT IS DERIVED, NOT MEASURED, AND THE DIFFERENCE IS STATED. No sync has ever
 *  been timed end to end, because until 4.8 nothing recorded a start. Start
 *  times persist from now on and completion is observable, so real durations
 *  accumulate and this number should be re-derived against them. A threshold
 *  with no stated basis is the settle note again: a number that explains itself
 *  falsely.
 *
 *  MEASURED FROM START, so it must exceed the longest plausible backfill rather
 *  than the longest plausible pause. That is the whole difference between this
 *  number and the 10 minutes it replaced, which was a gap-between-pages
 *  threshold for a branch that could not fire. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export interface ItemSyncState {
  syncStatus: SyncStatus;
  /** When this sync began, from the marker written before the first Plaid call.
   *
   *  THE ONLY CLOCK THE SWEEP READS. lastCursorAt was here and is gone,
   *  because it describes the previous run rather than this one, and accepting
   *  it would invite a branch that looks like it measures progress while
   *  measuring the sync before. */
  syncStartedAt: Date | null;
}

/** Should the watchdog sweep this Item back to queued?
 *
 * Returns a reason rather than a boolean, so a sweep that fires can say which
 * condition it fired on. A watchdog that reports only "stuck" cannot be
 * distinguished from one that is sweeping healthy backfills. */
export function sweepReason(state: ItemSyncState, now: Date): string | null {
  if (state.syncStatus !== "syncing") return null;

  // ELAPSED TIME FROM START, which is the only clock a syncing Item has. See
  // the header for why the progress branch was deleted rather than left.
  if (state.syncStartedAt) {
    const sinceStart = now.getTime() - state.syncStartedAt.getTime();
    return sinceStart > STALE_AFTER_MS
      ? `running for ${Math.round(sinceStart / 1000)}s without completing`
      : null;
  }

  // Syncing with no start time is a row the sweep has no clock for, so it is
  // swept rather than left: an Item stuck in syncing forever is worse than one
  // returned to a re-syncable state. It also means the marker was written
  // without its timestamp, which the marker's own statement makes impossible,
  // so reaching this is evidence of a write nobody here made.
  return "syncing with no start time";
}

/** The next status when a webhook arrives, per the ported state machine. */
export function onWebhook(current: SyncStatus): SyncStatus {
  // A webhook landing MID-SYNC does not start a second sync. It marks the Item
  // queued so a follow-up runs when the current one finishes, and that
  // follow-up resumes from the LAST COMPLETED cursor rather than the in-flight
  // one, because this webhook is exactly the mutation that can invalidate it.
  if (current === "syncing") return "queued";
  if (current === "queued") return "queued";
  return "queued";
}

/** The next status when a sync finishes. */
export function onSyncComplete(current: SyncStatus): SyncStatus {
  // Queued means a webhook arrived while we were running, so an immediate
  // follow-up is owed rather than a return to idle.
  return current === "queued" ? "queued" : "idle";
}
