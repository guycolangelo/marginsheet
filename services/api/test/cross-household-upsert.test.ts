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
const SHARED_TXN = `txn-shared-${crypto.randomUUID()}`;
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
    let actingAs: string | null = null;
    try {
      await sync.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${householdA}, true)`;

        // WHO IS ACTUALLY WRITING. Read back inside the transaction, because
        // the failure this test can produce has TWO explanations and they are
        // indistinguishable from the assertion alone: either A genuinely wrote
        // across the boundary, or the planted mutation (which swaps this GUC to
        // B) was not restored, in which case B legitimately updated B's own row
        // and the test is reporting on the mutated file.
        //
        // A harness reporting "restored -> STILL RED" cannot separate them, and
        // the difference is a cross-household write versus a tooling artifact.
        // So the transaction states which household it is, and the assertion
        // below fails FIRST if it is not A.
        const [ctx] = await tx<{ who: string }[]>`
          select current_setting('marginsheet.household_id', true) as who
        `;
        actingAs = ctx.who;

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

    // FIXTURE GUARD, AND IT COMES BEFORE EVERY CONCLUSION. If the GUC is not
    // A, this run is not testing a cross-household write at all and nothing
    // below means what it says.
    expect(
      actingAs,
      `the transaction ran as ${actingAs}, not as household A (${householdA}). ` +
        `This run proves nothing about isolation: either the planted mutation ` +
        `was not restored, or the GUC did not take.`
    ).toBe(householdA);

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
    // THE SECOND INDEX, AND IT IS ASKED SEPARATELY BECAUSE THE FIX DEPENDS ON
    // THE ANSWER. plaid_account_id carries the same global unique index as
    // item_id, so the shape is identical, and "identical shape" is a statement
    // about the remedy rather than about the behaviour. One index and two
    // indexes are different fixes.
    //
    // The first version of this test proved nothing: it omitted plaid_item_id,
    // which is NOT NULL, so the insert threw for a SCHEMA reason before
    // reaching any policy, the catch swallowed it, B's row survived trivially
    // and the assertions passed. The catch is now load-bearing and the error is
    // captured rather than discarded.
    const [itemB] = await owner<{ id: string }[]>`
      select id from plaid_items where item_id = ${SHARED_ITEM}
    `;
    await owner`
      insert into financial_accounts (household_id, plaid_item_id, plaid_account_id, name)
      values (${householdB}, ${itemB.id}, ${SHARED_ACCOUNT}, 'B checking')
      on conflict (plaid_account_id) do nothing
    `;

    // A NEEDS ITS OWN ITEM ROW, which is what exchange.ts actually has: A's
    // accounts hang off A's Item. Pointing A's insert at B's item row would
    // test a foreign key rather than the unique index, and would fail for a
    // reason that has nothing to do with the boundary.
    const [itemA] = await owner<{ id: string }[]>`
      insert into plaid_items (household_id, item_id, access_token_ciphertext)
      values (${householdA}, ${`item-a-${crypto.randomUUID()}`}, 'A-own-token')
      returning id
    `;

    let actingAs: string | null = null;
    let threw: string | null = null;
    try {
      await sync.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${householdA}, true)`;
        const [ctx] = await tx<{ who: string }[]>`
          select current_setting('marginsheet.household_id', true) as who
        `;
        actingAs = ctx.who;
        await tx`
          insert into financial_accounts (household_id, plaid_item_id, plaid_account_id, name)
          values (${householdA}, ${itemA.id}, ${SHARED_ACCOUNT}, 'A took it')
          on conflict (plaid_account_id) do update
            set name = excluded.name, is_active = true, updated_at = now()
        `;
      });
    } catch (error) {
      threw = (error as Error).message;
    }

    // FIXTURE GUARD FIRST, same reasoning as the plaid_items case: a run that
    // was not acting as A proves nothing about isolation.
    expect(
      actingAs,
      `the transaction ran as ${actingAs}, not as household A (${householdA}). ` +
        `This run proves nothing: either the mutation was not restored or the ` +
        `GUC did not take.`
    ).toBe(householdA);

    const [after] = await owner<{ name: string; household_id: string }[]>`
      select name, household_id from financial_accounts where plaid_account_id = ${SHARED_ACCOUNT}
    `;

    // The error is REPORTED whichever way this goes, because a pass earned by
    // a schema error is the failure this test already made once.
    expect(
      after.household_id,
      `another household took ownership of B's account. threw=${threw ?? "nothing"}`
    ).toBe(householdB);
    expect(
      after.name,
      `another household overwrote B's account. threw=${threw ?? "nothing"}`
    ).toBe("B checking");

    // A refusal for a SCHEMA reason is not a boundary holding. If it threw, the
    // message has to name the policy rather than a column.
    if (threw !== null) {
      expect(
        /policy|permission|row-level/i.test(threw),
        `it was refused, but not by the boundary: ${threw}`
      ).toBe(true);
    }
  });
  it("cannot reach another household's transactions row", async () => {
    // THE THIRD INDEX, AND THE WORST ONE IF IT HOLDS. transactions is where the
    // ledger lives: `removed` changes what a household is told they spent, and
    // amount and date are the figures the close reports.
    //
    // ASKED RATHER THAN SHAPE-MATCHED. transactions.plaid_transaction_id
    // carries the same global unique index as the other two, and "same shape"
    // is a statement about the remedy rather than about the behaviour. Two
    // vacuous tests this week came from exactly that inference.
    const [acctB] = await owner<{ id: string; plaid_item_id: string }[]>`
      select id, plaid_item_id from financial_accounts where plaid_account_id = ${SHARED_ACCOUNT}
    `;
    await owner`
      insert into transactions (household_id, account_id, plaid_transaction_id, date, amount, direction, merchant_name)
      values (${householdB}, ${acctB.id}, ${SHARED_TXN}, '2026-08-01', 42.00, 'outflow', 'B groceries')
      on conflict (plaid_transaction_id) do nothing
    `;

    // A needs its own account, because transactions.account_id is NOT NULL and
    // pointing at B's account would test a foreign key rather than the index.
    const [itemA] = await owner<{ id: string }[]>`
      insert into plaid_items (household_id, item_id, access_token_ciphertext)
      values (${householdA}, ${`item-a-txn-${crypto.randomUUID()}`}, 'A-token')
      returning id
    `;
    const [acctA] = await owner<{ id: string }[]>`
      insert into financial_accounts (household_id, plaid_item_id, plaid_account_id, name)
      values (${householdA}, ${itemA.id}, ${`acct-a-${crypto.randomUUID()}`}, 'A checking')
      returning id
    `;

    let actingAs: string | null = null;
    let threw: string | null = null;
    try {
      await sync.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${householdA}, true)`;
        const [ctx] = await tx<{ who: string }[]>`
          select current_setting('marginsheet.household_id', true) as who
        `;
        actingAs = ctx.who;
        await tx`
          insert into transactions (household_id, account_id, plaid_transaction_id, date, amount, direction, merchant_name)
          values (${householdA}, ${acctA.id}, ${SHARED_TXN}, '2026-08-02', 999.00, 'outflow', 'A took it')
          on conflict (plaid_transaction_id) do update
            set amount = excluded.amount, merchant_name = excluded.merchant_name, updated_at = now()
        `;
      });
    } catch (error) {
      threw = (error as Error).message;
    }

    expect(actingAs, `the transaction ran as ${actingAs}, not household A`).toBe(householdA);

    const [after] = await owner<{ household_id: string; merchant_name: string; amount: string }[]>`
      select household_id, merchant_name, amount from transactions where plaid_transaction_id = ${SHARED_TXN}
    `;
    expect(after.household_id, `another household took B's transaction. threw=${threw ?? "nothing"}`).toBe(householdB);
    expect(after.merchant_name, `another household rewrote B's transaction. threw=${threw ?? "nothing"}`).toBe("B groceries");
    expect(Number(after.amount), `another household changed B's AMOUNT, which is a figure the close reports. threw=${threw ?? "nothing"}`).toBe(42);
  });

  it("applyRemoved cannot flag another household's transaction", async () => {
    // THE SECOND PATH, AND THE OTHER TWO TABLES DO NOT HAVE IT. applyRemoved
    // issues `update transactions set removed = true where plaid_transaction_id
    // = any(...)` with NO HOUSEHOLD PREDICATE. Under sync_worker_access, which
    // is USING (true), nothing else scopes it.
    //
    // `removed` is not metadata. It changes what a household is told they
    // spent, so a false flag on another household's row is wrong data in a
    // close rather than a broken connection.
    let actingAs: string | null = null;
    let threw: string | null = null;
    try {
      await sync.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${householdA}, true)`;
        const [ctx] = await tx<{ who: string }[]>`
          select current_setting('marginsheet.household_id', true) as who
        `;
        actingAs = ctx.who;
        // Exactly the statement applyRemoved issues.
        await tx`
          update transactions
             set removed = true, updated_at = now()
           where plaid_transaction_id = any(${[SHARED_TXN]})
        `;
      });
    } catch (error) {
      threw = (error as Error).message;
    }

    expect(actingAs, `the transaction ran as ${actingAs}, not household A`).toBe(householdA);

    const [after] = await owner<{ removed: boolean; household_id: string }[]>`
      select removed, household_id from transactions where plaid_transaction_id = ${SHARED_TXN}
    `;
    expect(after.household_id).toBe(householdB);
    expect(
      after.removed,
      `household A flagged household B's transaction as removed. threw=${threw ?? "nothing"}. ` +
        `That is wrong data in B's close, not a broken connection.`
    ).toBe(false);
  });
});
