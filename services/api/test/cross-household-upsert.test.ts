// Can one household's upsert reach another household's row?
//
// THE QUESTION, AND WHY REASONING WAS NOT ALLOWED TO SETTLE IT. The unique
// indexes on plaid_items.item_id and financial_accounts.plaid_account_id are
// GLOBAL, not household-scoped, so `on conflict (item_id) do update` in
// exchange.ts can collide with a row belonging to a different household. The
// comfortable answer is "household_isolation makes that row invisible, so the
// statement errors." That is reasoning about Postgres, and this file exists
// because on 19 Aug 2026 it was written down as unverified rather than proven.
//
// WHAT A FAILURE HERE MEANS. If the upsert succeeds, or silently inserts a
// second row, that is a SECOND cross-household write path and a larger finding
// than the body-supplied householdId this suite ships beside. A red here is a
// finding, never a flaky test, and it must be diagnosed rather than retried.
//
// AS marginsheet_sync, NOT marginsheet_app. exchange.ts runs in the sync
// Worker, and the roles hold different grants: a refusal under app's grants
// would prove nothing about the path that actually runs, and would look like a
// pass.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateRole, assertNotSkippedInCI } from "./helpers/app-role.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

let owner: ReturnType<typeof postgres>;
let sync: ReturnType<typeof postgres>;
let householdA: string;
let householdB: string;
const SHARED_ITEM = `item-shared-${crypto.randomUUID()}`;
const SHARED_ACCOUNT = `acct-shared-${crypto.randomUUID()}`;
const B_CIPHERTEXT = "B-owns-this-ciphertext";

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const syncUrl = await rotateRole(owner, OWNER_URL!, "crosshh", "marginsheet_sync");
  sync = postgres(syncUrl, { max: 1 });

  const [a] = await owner<{ id: string }[]>`insert into households (name) values ('A') returning id`;
  const [b] = await owner<{ id: string }[]>`insert into households (name) values ('B') returning id`;
  householdA = a.id;
  householdB = b.id;

  // B's row, written as owner so the fixture does not depend on the behaviour
  // under test.
  await owner`
    insert into plaid_items (household_id, item_id, access_token_ciphertext)
    values (${householdB}, ${SHARED_ITEM}, ${B_CIPHERTEXT})
  `;
});

afterAll(async () => {
  if (sync) await sync.end();
  if (owner) await owner.end();
});

describe.skipIf(!configured)("a cross-household upsert on a global unique index", () => {
  it("cannot reach another household's plaid_items row", async () => {
    assertNotSkippedInCI(expect, "cross-household-upsert");

    // FIXTURE GUARD FIRST. If B's row is not there, the collision cannot
    // happen and everything below passes over an empty set.
    const [before] = await owner<{ access_token_ciphertext: string; household_id: string }[]>`
      select access_token_ciphertext, household_id from plaid_items where item_id = ${SHARED_ITEM}
    `;
    expect(before?.household_id, "B's row is missing: no collision to construct").toBe(householdB);

    // Exactly what exchange.ts issues, as household A.
    let threw: unknown = null;
    try {
      await sync.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${householdA}, true)`;
        await tx`
          insert into plaid_items (household_id, item_id, access_token_ciphertext)
          values (${householdA}, ${SHARED_ITEM}, 'A-tried-to-take-it')
          on conflict (item_id) do update
            set access_token_ciphertext = excluded.access_token_ciphertext,
                status = 'healthy', updated_at = now()
          returning id
        `;
      });
    } catch (error) {
      threw = error;
    }

    // THE ASSERTION THAT MATTERS IS THE SECOND ONE. Whether Postgres refuses
    // is interesting; whether B's row survived is the security property. A
    // version that only asserted the throw would pass if some future change
    // made the statement succeed against a row it should never see.
    const [after] = await owner<{ access_token_ciphertext: string; household_id: string }[]>`
      select access_token_ciphertext, household_id from plaid_items where item_id = ${SHARED_ITEM}
    `;
    expect(after.household_id, "another household took ownership of B's Item").toBe(householdB);
    expect(after.access_token_ciphertext, "another household overwrote B's token").toBe(B_CIPHERTEXT);

    // And no second row was created for A under the same item_id.
    const rows = await owner<{ id: string }[]>`
      select id from plaid_items where item_id = ${SHARED_ITEM}
    `;
    expect(rows.length, "a duplicate Item row was created").toBe(1);

    // Recorded rather than asserted loosely: if it did NOT throw, the write
    // was silently dropped, and a silent drop is its own problem even when
    // nothing leaked. The message carries which case ran.
    expect(
      threw !== null,
      "the upsert did NOT error. B's row is intact, so nothing leaked, but the " +
        "write was silently discarded and exchange.ts would report success for " +
        "an Item it did not store."
    ).toBe(true);
  });

  it("cannot reach another household's financial_accounts row", async () => {
    const [itemB] = await owner<{ id: string }[]>`
      select id from plaid_items where item_id = ${SHARED_ITEM}
    `;
    await owner`
      insert into financial_accounts (household_id, plaid_item_id, plaid_account_id, name)
      values (${householdB}, ${itemB.id}, ${SHARED_ACCOUNT}, 'B checking')
    `;

    try {
      await sync.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${householdA}, true)`;
        await tx`
          insert into financial_accounts (household_id, plaid_account_id, name)
          values (${householdA}, ${SHARED_ACCOUNT}, 'A took it')
          on conflict (plaid_account_id) do update
            set name = excluded.name, is_active = true, updated_at = now()
        `;
      });
    } catch {
      // The refusal is the expected path; the assertion below is the property.
    }

    const [after] = await owner<{ name: string; household_id: string }[]>`
      select name, household_id from financial_accounts where plaid_account_id = ${SHARED_ACCOUNT}
    `;
    expect(after.household_id, "another household took ownership of B's account").toBe(householdB);
    expect(after.name, "another household overwrote B's account").toBe("B checking");
  });
});
