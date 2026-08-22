// The watchdog's write half: end what the marker made visible.
//
// sweepReason has decided this since 4.4 and NOTHING HAS EVER CALLED IT,
// because nothing ever set sync_status to 'syncing' and its first line returns
// null for anything else. A trigger added on its own would have run on
// schedule, examined every Item, swept nothing, and reported healthy.
//
// IT RESOLVES TO 'swept', NEVER TO 'idle' (Guy, 22 Aug 2026). Idle after a
// clean finish and idle after a sweep are two facts, and giving them one value
// is the class named in CLAUDE.md, in the table it was named in. A swept Item
// is fully re-syncable; the value records what happened rather than restricting
// what may happen next.
//
// IT DOES NOT TOUCH THE CHAIN. The Durable Object's lock decides admission and
// this decides nothing: an Item swept while its Worker is somehow still alive
// is re-marked 'syncing' by that Worker's own completion write, which is the
// correct outcome and the reason the marker must never gate a start.

import { sweepReason, type ItemSyncState } from "./sync-state.js";
import type { Tx } from "./apply-streams.js";

export interface SweptItem {
  itemId: string;
  householdId: string;
  reason: string;
}

export interface SweepOutcome {
  examined: number;
  swept: SweptItem[];
}

/** Sweeps every Item stuck in 'syncing' with no recent progress.
 *
 *  ACROSS HOUSEHOLDS, deliberately: a watchdog scoped to one household needs
 *  something to iterate households, which is the trigger's job and not this
 *  one's. sync_worker_read is USING (true), so the read is permitted; each
 *  write names its own household so the statement is correct even where the
 *  policy is not, which is the 19 Aug rule. */
export async function sweepStuckSyncs(tx: Tx, now: Date): Promise<SweepOutcome> {
  const rows = (await tx`
    select id, item_id, household_id,
           sync_status::text as sync_status,
           sync_started_at
      from plaid_items
     where sync_status = 'syncing'
     order by id
  `) as Array<{
    id: string; item_id: string; household_id: string;
    sync_status: string; sync_started_at: Date | null;
  }>;

  const swept: SweptItem[] = [];

  for (const row of rows) {
    // START TIME AND NOTHING ELSE. last_cursor_at is deliberately not selected:
    // it can only describe a PREVIOUS run, so reading it here would be reading
    // another sync's progress to judge this one.
    const state: ItemSyncState = {
      syncStatus: "syncing",
      syncStartedAt: row.sync_started_at,
    };
    const reason = sweepReason(state, now);
    if (!reason) continue;

    // NAMES THE HOUSEHOLD AND REQUIRES THE STATUS IT READ. The second half is
    // what makes this safe to run beside a live Worker: an Item that finished
    // between the select and this update no longer reads 'syncing', so the
    // write matches nothing and a completed sync is not overwritten with a
    // sweep. Rows ACTUALLY updated, never the count intended.
    const updated = (await tx`
      update plaid_items
         set sync_status = 'swept', updated_at = now()
       where id = ${row.id}
         and household_id = ${row.household_id}
         and sync_status = 'syncing'
      returning id
    `) as { id: string }[];

    if (updated.length === 1) {
      swept.push({ itemId: row.item_id, householdId: row.household_id, reason });
    }
  }

  return { examined: rows.length, swept };
}
