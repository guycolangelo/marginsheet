// /transactions/sync with two cursors (M4 task 4.4.2).
//
// THE MUTATION BRANCH IS CONTROL FLOW, NOT AN ERROR, and that distinction is
// the whole design. Spike 1c proved a mid-pagination cursor can be refused when
// the underlying data changes during pagination, which is precisely what a
// webhook landing mid-sync does.
//
// Handled as an error the Item parks, the watchdog sweeps it back, it fails
// identically, and the obvious remedy for a sync that keeps failing is a retry.
// A RETRY OF THE IN-FLIGHT CURSOR REPLAYS. That is duplicate transactions in a
// household's ledger, arriving through a change that looked like reliability
// work. So the branch below restarts from the LAST COMPLETED cursor and carries
// on, and nothing about it is exceptional.

import { callPlaid, PlaidError, type PlaidCredentials } from "./plaid-client.js";

export const MUTATION_DURING_PAGINATION = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
const PAGE_SIZE = 500;
/** A pagination restarted more than this many times is not making progress. */
const MAX_RESTARTS = 3;

export interface SyncPage {
  added: unknown[];
  modified: unknown[];
  removed: unknown[];
  next_cursor: string;
  has_more: boolean;
}

export interface Cursors {
  /** Persisted after every page. Resumes a crash. Can be refused. */
  inFlight: string | null;
  /** From the last sync that finished. Survives a mutation. */
  lastCompleted: string | null;
}

export interface SyncOutcome {
  added: number;
  modified: number;
  removed: number;
  pages: number;
  /** How many times the mutation branch was taken. Zero is the common case. */
  restarts: number;
  /** The cursor to store as BOTH in-flight and last-completed on success. */
  cursor: string;
  /** Whether anything actually changed. A sync that changed nothing does not
   *  fire the signal: a watcher waking for nothing is how a watcher becomes
   *  noise (contract ruled 18 Aug 2026). */
  changed: boolean;
}

/** Persists the in-flight cursor after a page. Injected so the caller owns the
 *  transaction and this module owns the loop. */
export type PersistCursor = (cursor: string) => Promise<void>;

export async function runTransactionsSync(
  accessToken: string,
  cursors: Cursors,
  credentials: PlaidCredentials,
  persistInFlight: PersistCursor
): Promise<SyncOutcome> {
  let restarts = 0;

  // The outer loop exists ONLY for the mutation branch. It is not a retry loop:
  // each pass starts from a DIFFERENT and strictly safer cursor, so it cannot
  // spin on the same rejected position.
  for (;;) {
    // First pass resumes the in-flight cursor. Every later pass starts from the
    // last completed one, because that is what the refusal points at.
    let cursor = restarts === 0 ? cursors.inFlight : cursors.lastCompleted;
    let added = 0;
    let modified = 0;
    let removed = 0;
    let pages = 0;

    try {
      for (;;) {
        const body: Record<string, unknown> = { access_token: accessToken, count: PAGE_SIZE };
        if (cursor) body.cursor = cursor;

        const page = await callPlaid<SyncPage>("/transactions/sync", credentials, body);
        pages += 1;
        added += page.added.length;
        modified += page.modified.length;
        removed += page.removed.length;
        cursor = page.next_cursor;

        // AFTER EVERY PAGE, so a crash resumes rather than replaying from zero.
        await persistInFlight(cursor);

        if (!page.has_more) break;
      }
    } catch (error) {
      const isMutation =
        error instanceof PlaidError && error.errorCode === MUTATION_DURING_PAGINATION;

      if (!isMutation) throw error;

      // THE BRANCH. Not logged as a failure, not counted as an error, and the
      // Item is not parked: the data moved under an in-flight pagination, which
      // is ordinary.
      restarts += 1;
      if (restarts > MAX_RESTARTS) {
        // Genuinely stuck, which is different from the branch being taken. A
        // pagination that cannot complete across several restarts is not the
        // normal case and should surface.
        throw new PlaidError("/transactions/sync", 409, {
          error_code: "SYNC_RESTART_LIMIT",
          error_message: `restarted ${MAX_RESTARTS} times without completing`,
        });
      }
      // Whatever partial counts this pass accumulated are discarded with it.
      // They describe a pagination Plaid has disowned.
      continue;
    }

    return {
      added,
      modified,
      removed,
      pages,
      restarts,
      cursor: cursor as string,
      changed: added + modified + removed > 0,
    };
  }
}
