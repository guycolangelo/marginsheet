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
import { writeStateSignal } from "./state-signal.js";

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

    // THE GUC IS SET PER ROW, AND WITHOUT IT THIS SWEPT NOTHING, EVER.
    //
    // sync_worker_write on plaid_items reads current_setting, and the scheduled
    // handler opens its transaction without declaring a household -- correctly,
    // because a sweep spans every household and there is no single one to
    // declare for the transaction. So the UPDATE below evaluated its policy
    // predicate against NULL, matched no rows, and raised nothing. The watchdog
    // ran on schedule, examined every Item and reported items_swept: 0, WHICH
    // IS DOCUMENTED AS THE NORMAL CASE, so its total failure was indistinguish-
    // able from a healthy quiet system.
    //
    // A CROSS-HOUSEHOLD JOB DECLARES PER WRITE RATHER THAN PER TRANSACTION.
    // is_local scopes the setting to the transaction, and re-setting it moves
    // it, so each write is preceded by its own declaration and the last value
    // never leaks into a write meant for a different household.
    await tx`select set_config('marginsheet.household_id', ${row.household_id}, true)`;

    // NAMES THE HOUSEHOLD AND REQUIRES THE STATUS IT READ. The second half is
    // what makes this safe to run beside a live Worker: an Item that finished
    // between the select and this update no longer reads 'syncing', so the
    // write matches nothing and a completed sync is not overwritten with a
    // sweep. Rows ACTUALLY updated, never the count intended.
    //
    // The predicate is defence in depth and the set_config above is what the
    // POLICY reads. Two mechanisms, both required: satisfying one says nothing
    // about the other, which is exactly how this shipped.
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

      // THE RUN THIS ABANDONS, CLOSED ONLY NOW THAT THE SWEEP IS KNOWN TO HAVE
      // LANDED. Closed before the update above, it would mark a run 'swept'
      // that had in fact finished cleanly in the window between the select and
      // the write -- which is the exact race the status predicate exists to
      // lose safely, and labelling the run first would have lost it unsafely.
      //
      // 'swept' rather than leaving completed_at null, because a finished run
      // and a given-up one are two facts: both ended, and only one produced a
      // ledger.
      //
      // NULL IS A LEGITIMATE ANSWER AND NOT A FAILURE: an Item marked syncing
      // before sync_runs existed has no open run to attribute this to, and
      // inventing one is precisely what the column used to do.
      const [abandoned] = (await tx`
        update sync_runs
           set completed_at = now(), outcome = 'swept'
         where plaid_item_id = ${row.id}
           and household_id = ${row.household_id}
           and completed_at is null
        returning id
      `) as { id: string }[];
      const abandonedRunId = abandoned?.id ?? null;

      // A SYNC THAT FAILED TO FINISH IS EXACTLY WHAT A WATCHER WANTS TO KNOW,
      // which is why the sweep fires a signal and the two other status writers
      // (reconnect-complete, disconnect) stay owed: those are repair events a
      // household initiated, and this is the system reporting that work it
      // started never completed.
      //
      // NO STATUS NAME IN THE PAYLOAD. The kind says the status moved; the
      // consumer reads the row under RLS to learn what it moved to.
      await writeStateSignal(tx, row.household_id, row.id, abandonedRunId, {
        transactionsAdded: 0, transactionsModified: 0, transactionsRemoved: 0,
        balancesChanged: 0, liabilitiesChanged: 0, itemStatusChanged: true,
      });
    }
  }

  // THE TRACE, WRITTEN ON EVERY RUN INCLUDING THIS ONE FINDING NOTHING.
  //
  // A cron that stopped firing and a cron with nothing to do produce the same
  // observable: no Item swept. This row is what separates them, so it is
  // written before the outcome is returned and regardless of what was found.
  // A run that wrote no row is a run that did not happen.
  await tx`
    insert into sweep_runs (items_examined, items_swept)
    values (${rows.length}, ${swept.length})
  `;

  return { examined: rows.length, swept };
}
