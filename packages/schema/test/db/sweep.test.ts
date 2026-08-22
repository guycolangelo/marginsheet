// The watchdog's write half, EXECUTED, with both plants.
//
// sweepReason has been correct since 4.4 and unreachable for as long, because
// nothing set sync_status to 'syncing' and its first line returns null for
// anything else. This file is the first thing that has ever put an Item into
// the state it judges.
//
// THE SECOND PLANT IS THE ONE THAT MATTERS. An Item marked syncing with a FRESH
// start time must NOT be swept, and that is the failure that costs a real
// household a real sync: an over-eager watchdog cancels work that was
// progressing, the sync restarts, and it is cancelled again. A test that only
// proves the sweep fires proves the dangerous half.
//
// IT IMPORTS sweepStuckSyncs rather than restating its SQL, and it owns its own
// household so nothing here can disturb another file's fixture.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { sweepStuckSyncs } from "../../../../services/sync/src/sweep.js";
import { STALE_AFTER_MS } from "../../../../services/sync/src/sync-state.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-6000-7000-8000-0000000005ee";
const STALE = "01998888-6001-7000-8000-0000000005ee";
const FRESH = "01998888-6002-7000-8000-0000000005ee";
const IDLE = "01998888-6003-7000-8000-0000000005ee";

/** Calls the sweep EXACTLY AS THE SCHEDULED HANDLER DOES: a transaction with no
 *  household declared.
 *
 *  IT USED TO SET THE GUC HERE AND THAT IS WHY THE DEFECT SHIPPED. The fixture
 *  supplied the declaration production omits, so this file proved that
 *  sweepStuckSyncs works WHEN GIVEN A DECLARED TRANSACTION and nothing anywhere
 *  proved the real caller gives it one. index.ts opens the connection and
 *  delegates the write to this module, so neither file both opens a connection
 *  and contains a write, and the source scans looking for that pair saw
 *  nothing.
 *
 *  A sweep spans every household, so there is no single household the
 *  transaction could declare. The module declares per write instead, which is
 *  what this now proves. */
async function run() {
  return sql.begin(async (tx) => {
    // AS marginsheet_sync, AND WITHOUT THIS THE TEST COULD NOT FAIL.
    //
    // The thing under test is whether the sweep satisfies sync_worker_write,
    // and that policy is written TO marginsheet_sync. Run on the migration
    // owner's connection the policy simply does not apply, so removing the
    // sweep's set_config left every assertion green and the planted-failure
    // harness reported the control as insensitive. It was: a test that never
    // adopts the role cannot observe a policy written for it, however real its
    // database is.
    //
    // It is the has_column_privilege lesson one level up. Asking the catalog
    // what a role MAY do and running AS that role are different questions, and
    // only the second is the one production asks. A control that verifies a
    // privilege adopts the identity that will use it.
    //
    // SET LOCAL, so the role reverts when the transaction ends on any path
    // including a throw, and no pooled connection returns holding it.
    await tx.unsafe("SET LOCAL ROLE marginsheet_sync");
    return sweepStuckSyncs(tx as never, new Date());
  }) as never as Promise<Awaited<ReturnType<typeof sweepStuckSyncs>>>;
}

async function statusOf(id: string): Promise<string> {
  const [r] = await sql<{ s: string }[]>`select sync_status::text as s from plaid_items where id = ${id}`;
  return r.s;
}

/** Minutes ago, expressed against the threshold the module declares rather than
 *  a literal. A test carrying its own copy of the number stops agreeing with
 *  the code the day somebody tunes it. */
const staleAgo = `${Math.round((STALE_AFTER_MS / 1000) * 2)} seconds`;
const freshAgo = `${Math.round((STALE_AFTER_MS / 1000) / 4)} seconds`;

beforeAll(async () => {
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'sweep fixture') on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id) values
              (${STALE}, ${HOUSEHOLD}, 'item-sweep-stale'),
              (${FRESH}, ${HOUSEHOLD}, 'item-sweep-fresh'),
              (${IDLE},  ${HOUSEHOLD}, 'item-sweep-idle')
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("the watchdog sweeps what stopped and leaves what is working", () => {
  beforeAll(async () => {
    await sql`update plaid_items set sync_status = 'syncing',
                sync_started_at = now() - ${staleAgo}::interval, last_cursor_at = null
              where id = ${STALE}`;
    // STARTED RECENTLY, which under ruling B is the only thing that keeps an
    // Item from being swept. Its previous shape was a stale start with a fresh
    // cursor, which tested the progress branch deleted by amendment 15.
    await sql`update plaid_items set sync_status = 'syncing',
                sync_started_at = now() - ${freshAgo}::interval,
                last_cursor_at = now() - ${freshAgo}::interval
              where id = ${FRESH}`;
    await sql`update plaid_items set sync_status = 'idle' where id = ${IDLE}`;
  });

  it("SWEEPS an Item marked syncing whose start is stale and which never wrote a cursor", async () => {
    const r = await run();
    expect(r.swept.map((s) => s.itemId)).toContain("item-sweep-stale");
    expect(await statusOf(STALE)).toBe("swept");
  });

  it("DOES NOT SWEEP an Item still inside the threshold", async () => {
    // THE PLANT THAT CATCHES THE EXPENSIVE FAILURE, in ruling B's terms. Too
    // late costs recovery latency on a hung sync, which this product can
    // afford. TOO EARLY CANCELS A WORKING BACKFILL, which then restarts and is
    // cancelled again, so an Item progressing perfectly never finishes while
    // every status looks busy. A fixture proving only that the sweep fires
    // proves the dangerous half.
    //
    // It carries a fresh last_cursor_at deliberately, so the row would also
    // have survived the old progress branch: the assertion is about the start
    // time and nothing else reads that column now.
    expect(await statusOf(FRESH)).toBe("syncing");
    const r = await run();
    expect(r.swept.map((s) => s.itemId)).not.toContain("item-sweep-fresh");
    expect(await statusOf(FRESH), "a progressing backfill was cancelled").toBe("syncing");
  });

  it("does not examine an Item that is not syncing", async () => {
    expect(await statusOf(IDLE)).toBe("idle");
  });

  it("resolves to SWEPT and never to idle", async () => {
    // Idle after a clean finish and idle after a sweep are two facts. The
    // distinction is the whole reason the value exists.
    expect(await statusOf(STALE)).not.toBe("idle");
  });

  it("says WHY it swept, so a sweep can be told from a healthy backfill", async () => {
    await sql`update plaid_items set sync_status = 'syncing',
                sync_started_at = now() - ${staleAgo}::interval, last_cursor_at = null
              where id = ${STALE}`;
    const r = await run();
    const entry = r.swept.find((s) => s.itemId === "item-sweep-stale");
    expect(entry?.reason).toMatch(/running for \d+s without completing/);
  });

  it("is idempotent: a second pass finds nothing left to sweep", async () => {
    const r = await run();
    expect(r.swept).toEqual([]);
  });
});
