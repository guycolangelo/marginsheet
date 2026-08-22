// sync_runs.started_at and plaid_items.sync_started_at are two statements of
// one fact, so something reconciles them.
//
// THEY ARE DELIBERATELY NOT DERIVED FROM EACH OTHER. plaid_items holds the
// Item's CURRENT state, one row, overwritten every sync, read by the watchdog
// on a timer. sync_runs holds HISTORY, one row per run, never overwritten.
// Folding them would make the watchdog scan an unbounded history for open rows
// instead of reading a column on the row it already has, which is a worse query
// for the one thing in this system that runs on a schedule.
//
// THE PRICE OF KEEPING BOTH IS THIS FILE. Two hand-written statements of one
// requirement drift by default, and the remedy is not a rule about remembering:
// it is something that fails when they disagree.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { openSyncRun, closeSyncRun } from "../../../../services/sync/src/sync-runs.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-8000-7000-8000-0000000005ee";
const ITEM = "01998888-8001-7000-8000-0000000005ee";
const OTHER_HOUSEHOLD = "01998888-8002-7000-8000-0000000005ee";

/** The marker transaction, exactly as run-sync opens it: one transaction that
 *  writes the Item's status and opens the run together. */
async function mark(): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    await tx`update plaid_items set sync_status = 'syncing', sync_started_at = now(), updated_at = now()
              where id = ${ITEM} and household_id = ${HOUSEHOLD}`;
    return openSyncRun(tx as never, HOUSEHOLD, ITEM);
  }) as never as Promise<string>;
}

beforeAll(async () => {
  await sql`insert into households (id, name) values
              (${HOUSEHOLD}, 'sync run fixture'), (${OTHER_HOUSEHOLD}, 'sync run neighbour')
            on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id)
            values (${ITEM}, ${HOUSEHOLD}, 'item-sync-run') on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from household_state_signals where household_id = ${HOUSEHOLD}`;
  await sql`delete from sync_runs where household_id = ${HOUSEHOLD}`;
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id in (${HOUSEHOLD}, ${OTHER_HOUSEHOLD})`;
  await sql.end();
});

describe("the run and the marker cannot disagree", () => {
  it("an Item marked syncing has exactly one open run, started at the same moment", async () => {
    const runId = await mark();
    const [row] = await sql<{ n: number; agrees: boolean }[]>`
      select count(*)::int as n,
             bool_and(r.started_at = i.sync_started_at) as agrees
        from sync_runs r
        join plaid_items i on i.id = r.plaid_item_id
       where r.plaid_item_id = ${ITEM} and r.completed_at is null
    `;
    expect(row.n, "an Item in 'syncing' must have exactly one open run").toBe(1);
    expect(row.agrees, "started_at and sync_started_at were written in one transaction and must match").toBe(true);
    await sql`delete from sync_runs where id = ${runId}`;
  });

  it("closing records the counts and marks the outcome", async () => {
    const runId = await mark();
    const closed = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
      return closeSyncRun(tx as never, HOUSEHOLD, runId, {
        transactionsAdded: 3, transactionsModified: 1, transactionsRemoved: 0,
        accountsRefreshed: 5, balancesChanged: 2, liabilitiesChanged: 1, pages: 2, restarts: 0,
      });
    });
    expect(closed).toBe(1);
    const [r] = await sql<{ outcome: string; refreshed: number; changed: number }[]>`
      select outcome, accounts_refreshed as refreshed, balances_changed as changed
        from sync_runs where id = ${runId}
    `;
    expect(r.outcome).toBe("completed");
    // THE TWO POPULATIONS SURVIVE INTO THE RECORD as different numbers. A run
    // that stored one of them would make the distinction unrecoverable the
    // moment anybody read the history.
    expect(r.refreshed).toBe(5);
    expect(r.changed).toBe(2);
    await sql`delete from sync_runs where id = ${runId}`;
  });

  it("closing a run belonging to another household closes nothing and says so", async () => {
    // RETURNS ROWS ACTUALLY UPDATED, never the id it was handed. Those two
    // numbers differ exactly when the run is somebody else's, which is the case
    // the predicate exists for.
    const runId = await mark();
    const closed = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${OTHER_HOUSEHOLD}, true)`;
      return closeSyncRun(tx as never, OTHER_HOUSEHOLD, runId, {
        transactionsAdded: 0, transactionsModified: 0, transactionsRemoved: 0,
        accountsRefreshed: 0, balancesChanged: 0, liabilitiesChanged: 0, pages: 0, restarts: 0,
      });
    });
    expect(closed).toBe(0);
    const [still] = await sql<{ open: boolean }[]>`
      select completed_at is null as open from sync_runs where id = ${runId}
    `;
    expect(still.open, "another household's close must not touch this run").toBe(true);
    await sql`delete from sync_runs where id = ${runId}`;
  });

  it("a closed run cannot be closed twice", async () => {
    const runId = await mark();
    const args = {
      transactionsAdded: 0, transactionsModified: 0, transactionsRemoved: 0,
      accountsRefreshed: 0, balancesChanged: 0, liabilitiesChanged: 0, pages: 0, restarts: 0,
    };
    const first = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
      return closeSyncRun(tx as never, HOUSEHOLD, runId, args);
    });
    const second = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
      return closeSyncRun(tx as never, HOUSEHOLD, runId, args);
    });
    expect(first).toBe(1);
    expect(second, "completed_at is null in the predicate, so a finished run is not re-stamped").toBe(0);
    await sql`delete from sync_runs where id = ${runId}`;
  });
});
