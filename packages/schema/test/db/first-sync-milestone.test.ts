// The milestone means "we hold this household's history", EXECUTED.
//
// WHY A DATABASE TEST AND NOT A RECORDER. markFirstSyncCompleted's statement
// now carries two correlated subqueries over plaid_items, and a recorder proves
// a statement was CONSTRUCTED and nothing about whether it can EXECUTE. This
// codebase has three findings of exactly that shape in one week: a column no
// migration created, a table no grant covered, and a statement nothing ran.
//
// IT IMPORTS markFirstSyncCompleted RATHER THAN RESTATING ITS SQL, so the test
// cannot drift into agreeing with a copy of the query instead of the query.
//
// THE FIXTURE HAS TO REACH EVERY BRANCH OR IT PROVES ONE OF THEM. The ninth
// finding is that a fixture admitting only the passing shape is a tautology
// wearing an assertion's clothes, so each state below is constructed and the
// milestone is asserted to REFUSE in every one before it is asserted to fire.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { markFirstSyncCompleted } from "../../../../services/sync/src/apply-streams.js";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const HOUSEHOLD = "01998888-1000-7000-8000-00000000b1e0";
const ITEM_A = "01998888-1001-7000-8000-00000000b1e0";
const ITEM_B = "01998888-1002-7000-8000-00000000b1e0";

/** Runs the real function the way run-sync does: inside a transaction with the
 *  household GUC set. Outside a transaction the GUC dies with its statement and
 *  every policy reads an unset household, which is the class this file has
 *  three instances of. */
async function attempt(): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${HOUSEHOLD}, true)`;
    return markFirstSyncCompleted(tx as never, HOUSEHOLD);
  }) as Promise<boolean>;
}

async function reset(): Promise<void> {
  await sql`update households set first_sync_completed_at = null where id = ${HOUSEHOLD}`;
}

/** Sets one Item's confirmation and collection times. null clears. */
async function setItem(id: string, confirmedAt: string | null, syncedAt: string | null, status = "healthy"): Promise<void> {
  await sql`
    update plaid_items
       set history_complete_at = ${confirmedAt}::timestamptz,
           last_successful_sync = ${syncedAt}::timestamptz,
           status = ${status}::plaid_item_status
     where id = ${id}
  `;
}

beforeAll(async () => {
  await sql`insert into households (id, name) values (${HOUSEHOLD}, 'milestone fixture')
            on conflict (id) do nothing`;
  for (const [id, itemId] of [[ITEM_A, "item-milestone-a"], [ITEM_B, "item-milestone-b"]]) {
    await sql`insert into plaid_items (id, household_id, item_id)
              values (${id}, ${HOUSEHOLD}, ${itemId}) on conflict (id) do nothing`;
  }
});

afterAll(async () => {
  await sql`delete from plaid_items where household_id = ${HOUSEHOLD}`;
  await sql`delete from households where id = ${HOUSEHOLD}`;
  await sql.end();
});

describe("first_sync_completed_at fires on confirmation, not on a sync", () => {
  it("REFUSES while an Item has synced but Plaid has not confirmed", async () => {
    // THE AMEX CASE, AND THE WHOLE REASON THIS CHANGED. A successful sync that
    // returned 161 of 5,241 rows looks exactly like this row.
    await reset();
    await setItem(ITEM_A, null, "2026-08-21T10:00:00Z");
    await setItem(ITEM_B, null, "2026-08-21T10:00:00Z");
    expect(await attempt()).toBe(false);
  });

  it("REFUSES while an Item is confirmed but has not synced since", async () => {
    // Confirmation then COLLECTION. Plaid assembling a history and us having
    // pulled it are two events, and reading only the first would set the
    // milestone on data we have never fetched.
    await reset();
    await setItem(ITEM_A, "2026-08-21T12:00:00Z", "2026-08-21T10:00:00Z");
    await setItem(ITEM_B, "2026-08-21T12:00:00Z", "2026-08-21T13:00:00Z");
    expect(await attempt()).toBe(false);
  });

  it("REFUSES while ONE of two Items is unconfirmed", async () => {
    // EVERY Item, not any. Without this the fixture could pass on a query that
    // read a single row, which is the old behaviour wearing the new shape.
    await reset();
    await setItem(ITEM_A, "2026-08-21T12:00:00Z", "2026-08-21T13:00:00Z");
    await setItem(ITEM_B, null, "2026-08-21T13:00:00Z");
    expect(await attempt()).toBe(false);
  });

  it("FIRES when every Item is confirmed and collected after confirmation", async () => {
    await reset();
    await setItem(ITEM_A, "2026-08-21T12:00:00Z", "2026-08-21T13:00:00Z");
    await setItem(ITEM_B, "2026-08-21T12:00:00Z", "2026-08-21T12:00:01Z");
    expect(await attempt()).toBe(true);

    const [row] = await sql<{ at: string | null }[]>`
      select (first_sync_completed_at)::text as at from households where id = ${HOUSEHOLD}
    `;
    expect(row.at, "it reported firing and wrote nothing").not.toBeNull();
  });

  it("IS SET ONCE, so a second qualifying sync does not move it", async () => {
    // The guard is the WHERE clause rather than a read-then-write, because two
    // Items finishing together would both read null and both write, and the
    // second write moves a timestamp the intro and the census treat as
    // immutable. The household would meet MyKeeper twice.
    expect(await attempt()).toBe(false);
  });

  it("IGNORES a disconnected Item, so a removed institution cannot block forever", async () => {
    await reset();
    await setItem(ITEM_A, "2026-08-21T12:00:00Z", "2026-08-21T13:00:00Z");
    await setItem(ITEM_B, null, null, "disconnected");
    expect(await attempt()).toBe(true);
  });

  it("REFUSES for a household with no Items at all", async () => {
    // NOT VACUOUS. "No unsatisfied Items" is trivially true of a household that
    // has connected nothing, and a NOT EXISTS on its own would fire the intro
    // for somebody with no accounts. This is the assertion that makes the
    // separate EXISTS clause load-bearing rather than decorative.
    await reset();
    await sql`update plaid_items set status = 'disconnected' where household_id = ${HOUSEHOLD}`;
    expect(await attempt()).toBe(false);
  });
});
