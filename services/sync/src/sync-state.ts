// The coordination state machine and the watchdog (M4 task 4.4.3).
//
// THE WATCHDOG THRESHOLD MEASURES FROM LAST CURSOR PERSISTENCE, NOT FROM SYNC
// START. That is the whole of this file's design content.
//
// Measured from start, a first backfill of 20,000 transactions reads as stuck
// and gets swept mid-flight. The sweep sets it back to queued, another sync
// starts, and it is swept again: an Item that is working perfectly is prevented
// from ever finishing, and the symptom is a household whose transactions never
// arrive while every status looks busy.
//
// Measured from last persistence, the question becomes the right one: not "has
// this taken a long time" but "has this made progress recently". A backfill
// writing a cursor every page is making progress however long it runs. A worker
// that died mid-page has written nothing since.

export type SyncStatus = "idle" | "syncing" | "queued" | "error";

/** How long without a cursor write before an Item is presumed abandoned. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export interface ItemSyncState {
  syncStatus: SyncStatus;
  /** When a cursor was last persisted. NULL means none has been, which for a
   *  syncing Item means it died before its first page. */
  lastCursorAt: Date | null;
  /** When this sync began. Used ONLY for the never-persisted case below. */
  syncStartedAt: Date | null;
}

/** Should the watchdog sweep this Item back to queued?
 *
 * Returns a reason rather than a boolean, so a sweep that fires can say which
 * condition it fired on. A watchdog that reports only "stuck" cannot be
 * distinguished from one that is sweeping healthy backfills. */
export function sweepReason(state: ItemSyncState, now: Date): string | null {
  if (state.syncStatus !== "syncing") return null;

  // PROGRESS, not elapsed time. A backfill that wrote a cursor a minute ago is
  // working, whether it started a minute or an hour ago.
  if (state.lastCursorAt) {
    const sinceProgress = now.getTime() - state.lastCursorAt.getTime();
    return sinceProgress > STALE_AFTER_MS
      ? `no cursor written for ${Math.round(sinceProgress / 1000)}s`
      : null;
  }

  // No cursor has EVER been written for this run. The only clock available is
  // the start, and this is the one case where elapsed time is the right
  // question: a sync that has not completed a single page within the threshold
  // did not start successfully.
  if (state.syncStartedAt) {
    const sinceStart = now.getTime() - state.syncStartedAt.getTime();
    return sinceStart > STALE_AFTER_MS
      ? `no first page within ${Math.round(sinceStart / 1000)}s`
      : null;
  }

  // Syncing with neither clock is a row nothing can reason about, so it is
  // swept rather than left: an Item stuck in syncing forever is worse than one
  // returned to the queue.
  return "syncing with no start time and no cursor";
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
