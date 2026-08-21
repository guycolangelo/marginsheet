// Clearing first_sync_completed_at, once, before M13 exists.
//
// WHY A ROUTE AND NOT A HAND-RUN STATEMENT (Guy, 21 Aug 2026). A CORRECTION TO
// A SET-ONCE MILESTONE IS PRECISELY THE KIND OF THING THAT SHOULD LEAVE A
// RECORD OF WHO DID IT AND WHEN. A psql session leaves nothing; this leaves a
// deploy, a request, and a reported before-value.
//
// WHAT IT CORRECTS. The field was set on 20 Aug under the pre-0036 meaning, "a
// sync succeeded", when the household held one institution at 90 days of
// history. 0036 redefined it as "we hold this household's history". The
// immutability guard reads first_sync_completed_at IS NULL, so THE CORRECTED
// DEFINITION DOES NOT REACH A ROW WRITTEN UNDER THE OLD ONE: the new logic
// stops evaluating as soon as a value is present, and the wrong value stands.
//
// THE WINDOW. The field feeds the M13 intro trigger and the day-3-to-5 census,
// NEITHER OF WHICH EXISTS. Clearing today costs nothing and the milestone
// re-fires correctly once Chase and Amex confirm. Clearing after M13 ships
// re-arms an intro that already went out and the household meets MyKeeper
// twice, which is the exact failure the immutability exists to prevent.
//
// SO THIS ROUTE IS DELIBERATELY NARROW AND DELIBERATELY TEMPORARY. It clears
// one household's milestone and does nothing else: no delete, no Plaid call,
// and the only value it writes is null, so the milestone can still only be SET
// by markFirstSyncCompleted. Its removal is tracked as
// clear-milestone-route-is-temporary in docs/open-items.json.

import postgres from "postgres";



export interface ClearMilestoneResult {
  householdId: string;
  dryRun: boolean;
  /** The value as it stands. Reported on BOTH paths, because a dry run that
   *  does not show what it is about to destroy is a confirmation prompt with
   *  no information in it. */
  currentValue: string | null;
  /** What the milestone would do if re-evaluated right now, per Item, so the
   *  operator can see whether clearing re-fires immediately or waits for a
   *  confirmation that has not arrived. THAT IS THE WHOLE QUESTION and a dry
   *  run reporting only the old value would not answer it. */
  itemsBlocking: Array<{ itemId: string; status: string | null; reason: string }>;
  cleared: boolean;
  /** Rows ACTUALLY updated, never the id we were handed. Those differ exactly
   *  when the household does not exist or the GUC is unset, which is the case
   *  this needs to get right. */
  rowsCleared: number;
  refused?: string;
}

/** Clears one household's first_sync_completed_at.
 *
 *  `apply` is false by default so a caller that forgets the flag gets a dry
 *  run rather than a destroyed milestone. Same default as every other
 *  destructive route here. */
export async function clearFirstSyncMilestone(
  databaseUrl: string,
  householdId: string,
  apply: boolean
): Promise<ClearMilestoneResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await sql.begin(async (tx) => {
    // THE GUC, ON THE TRANSACTION HANDLE. set_config's third argument is
    // is_local and the setting dies with its statement outside an explicit
    // transaction, which has now cost three defects in this codebase, two of
    // them live in production.
    await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;

    const households = (await tx`
      select (first_sync_completed_at)::text as at
        from households where id = ${householdId}
    `) as { at: string | null }[];

    if (households.length === 0) {
      return {
        householdId, dryRun: !apply, currentValue: null, itemsBlocking: [],
        cleared: false, rowsCleared: 0,
        refused: "no such household, or the household GUC does not permit reading it",
      };
    }

    const currentValue = households[0].at;

    const items = (await tx`
      select item_id, status::text as status,
             (history_complete_at)::text as confirmed,
             (last_successful_sync)::text as synced
        from plaid_items
       where household_id = ${householdId} and status <> 'disconnected'
       order by item_id
    `) as { item_id: string; status: string | null; confirmed: string | null; synced: string | null }[];

    const itemsBlocking = items
      .filter((i) => !i.confirmed || !i.synced || i.synced < i.confirmed)
      .map((i) => ({
        itemId: i.item_id,
        status: i.status,
        reason: !i.confirmed
          ? "Plaid has not confirmed the backfill; no SYNC_UPDATES_AVAILABLE has carried both completion flags"
          : !i.synced
            ? "confirmed, but no successful sync has been recorded"
            : "confirmed, but the last successful sync predates the confirmation, so we have not collected since",
      }));

    if (currentValue === null) {
      return {
        householdId, dryRun: !apply, currentValue: null, itemsBlocking,
        cleared: false, rowsCleared: 0,
        refused: "already null, so there is nothing to clear and nothing to record",
      };
    }

    if (!apply) {
      return { householdId, dryRun: true, currentValue, itemsBlocking, cleared: false, rowsCleared: 0 };
    }

    const rows = (await tx`
      update households
         set first_sync_completed_at = null, updated_at = now()
       where id = ${householdId}
         and first_sync_completed_at is not null
      returning id
    `) as { id: string }[];

    return {
      householdId, dryRun: false, currentValue, itemsBlocking,
      cleared: rows.length === 1, rowsCleared: rows.length,
    };
    }) as ClearMilestoneResult;
  } finally {
    await sql.end();
  }
}
