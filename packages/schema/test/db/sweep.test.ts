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

async function run() {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
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
    await sql`update plaid_items set sync_status = 'syncing',
                sync_started_at = now() - ${staleAgo}::interval,
                last_cursor_at = now() - ${freshAgo}::interval
              where id = ${FRESH}`;
    await sql`update plaid_items set sync_status = 'idle' where id = ${IDLE}`;
  });

  it("SWEEPS an Item marked syncing whose start is stale and which never wrote a cursor", async () => {
    const r = await run();
    expect(r.swept.map((s) => s.itemId)).toContain("item-sweep-stale");
    expect(await statusOf(STALE)).toBe("swept");
  });

  it("DOES NOT SWEEP an Item whose cursor moved recently, however long it has run", async () => {
    // THE PLANT THAT CATCHES THE EXPENSIVE FAILURE. Its start is as stale as
    // the swept one; only its PROGRESS is fresh. A watchdog measuring elapsed
    // time from start rather than from last persistence cancels exactly this
    // Item, and a 20,000 transaction backfill is exactly this Item.
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
    expect(entry?.reason).toMatch(/no first page within/);
  });

  it("is idempotent: a second pass finds nothing left to sweep", async () => {
    const r = await run();
    expect(r.swept).toEqual([]);
  });
});
