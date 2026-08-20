// The sync role writes within one household. Migration 0026, task 4c-iii.
//
// THREE CONTROLS THAT DIFFER IN KIND, not three of one shape (Guy, 19 Aug 2026).
// One refusal proves a boundary exists; three of the same shape prove one
// predicate works three times. These are:
//
//   1. an ORDINARY table, where household_id is the scope
//   2. an EXCEPTION table, provider_events, where NULL is deliberately writable
//      and an attributed row is not
//   3. a CONFIRMED FINDING, applyRemoved's statement, which is free evidence
//      because it already went red for real against a database
//
// The third is the one worth keeping honest about: it is not hypothetical. On
// 19 Aug 2026 that exact statement flagged another household's transaction with
// threw=nothing, before this policy existed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateRole, assertNotSkippedInCI } from "./helpers/app-role.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

let owner: ReturnType<typeof postgres>;
let sync: ReturnType<typeof postgres>;
let A: string;
let B: string;

/** Runs `work` as the sync role having declared `household`. */
async function asHousehold<T>(household: string, work: (tx: never) => Promise<T>): Promise<{ ok: boolean; error: string | null }> {
  try {
    await sync.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${household}, true)`;
      await work(tx as never);
    });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  sync = postgres(await rotateRole(owner, OWNER_URL!, "syncpolicy", "marginsheet_sync"), { max: 1 });
  const [a] = await owner<{ id: string }[]>`insert into households (name) values ('A') returning id`;
  const [b] = await owner<{ id: string }[]>`insert into households (name) values ('B') returning id`;
  A = a.id;
  B = b.id;
});

afterAll(async () => {
  if (sync) await sync.end();
  if (owner) await owner.end();
});

describe.skipIf(!configured)("the sync role writes within one household", () => {
  it("an ORDINARY table refuses a write into another household", async () => {
    assertNotSkippedInCI(expect, "sync-write-policy");

    const itemId = `item-${crypto.randomUUID()}`;
    await owner`
      insert into plaid_items (household_id, item_id, access_token_ciphertext)
      values (${B}, ${itemId}, 'B-token')
    `;

    // A declares itself, then tries to take B's row. The same shape that
    // succeeded before 0026.
    const outcome = await asHousehold(A, async (tx: never) => {
      await (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>)`
        update plaid_items set access_token_ciphertext = 'A-took-it'
         where item_id = ${itemId}
      `;
    });

    const [after] = await owner<{ access_token_ciphertext: string }[]>`
      select access_token_ciphertext from plaid_items where item_id = ${itemId}
    `;
    // The SURVIVAL assertion is the property; whether it errored or matched
    // zero rows is secondary and both are acceptable refusals.
    expect(
      after.access_token_ciphertext,
      `household A wrote into household B's row. ok=${outcome.ok} error=${outcome.error ?? "none"}`
    ).toBe("B-token");
  }, 60_000);

  it("provider_events accepts an UNATTRIBUTED row and refuses another household's", async () => {
    // THE EXCEPTION, TESTED IN BOTH DIRECTIONS, because an exception that only
    // proves the permitted half is an exception nobody has checked.
    //
    // Permitting NULL is what keeps webhooks working: an event arrives before
    // we know whose it is, and a predicate requiring a match would refuse the
    // insert whose whole purpose is to record it.
    const unattributed = await asHousehold(A, async (tx: never) => {
      await (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>)`
        insert into provider_events (source, event_id, event_type)
        values ('plaid', ${`evt-${crypto.randomUUID()}`}, 'SYNC_UPDATES_AVAILABLE')
      `;
    });
    expect(
      unattributed.ok,
      `an unattributed webhook was refused, which stops webhooks being processed: ${unattributed.error ?? ""}`
    ).toBe(true);

    // And the other half: once attributed, it is scoped like anything else.
    const attributed = await asHousehold(A, async (tx: never) => {
      await (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>)`
        insert into provider_events (household_id, source, event_id, event_type)
        values (${B}, 'plaid', ${`evt-${crypto.randomUUID()}`}, 'SYNC_UPDATES_AVAILABLE')
      `;
    });
    expect(
      attributed.ok,
      "household A wrote a provider_event attributed to household B"
    ).toBe(false);
  }, 60_000);

  it("applyRemoved's statement can no longer cross households", async () => {
    // FREE EVIDENCE. This exact statement, issued this exact way, flagged
    // household B's transaction on 19 Aug 2026 with threw=nothing. It is the
    // only one of the three that is not hypothetical.
    const [itemB] = await owner<{ id: string }[]>`
      insert into plaid_items (household_id, item_id, access_token_ciphertext)
      values (${B}, ${`item-${crypto.randomUUID()}`}, 'B-token') returning id
    `;
    const [acctB] = await owner<{ id: string }[]>`
      insert into financial_accounts (household_id, plaid_item_id, plaid_account_id, name)
      values (${B}, ${itemB.id}, ${`acct-${crypto.randomUUID()}`}, 'B checking') returning id
    `;
    const txnId = `txn-${crypto.randomUUID()}`;
    await owner`
      insert into transactions (household_id, account_id, plaid_transaction_id, date, amount, direction)
      values (${B}, ${acctB.id}, ${txnId}, '2026-08-01', 42.00, 'expense')
    `;

    // Deliberately WITHOUT the household predicate 4e added, so this tests the
    // POLICY rather than the statement. Both must hold independently.
    const outcome = await asHousehold(A, async (tx: never) => {
      await (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>)`
        update transactions set removed = true where plaid_transaction_id = any(${[txnId]})
      `;
    });

    const [after] = await owner<{ removed: boolean }[]>`
      select removed from transactions where plaid_transaction_id = ${txnId}
    `;
    expect(
      after.removed,
      `household A flagged household B's transaction removed. ok=${outcome.ok} error=${outcome.error ?? "none"}. ` +
        `This is the statement that already did exactly this once, before migration 0026.`
    ).toBe(false);
  }, 60_000);
});
