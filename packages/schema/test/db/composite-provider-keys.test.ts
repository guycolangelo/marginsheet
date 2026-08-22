// The arbiter cannot leave the household, executed against a real database.
//
// THE FINDING'S OWN TEST, and it could not be written before 4d. Confirmed
// 19 Aug 2026: acting as household A, exchange.ts's upsert reached HOUSEHOLD B's
// plaid_items row and replaced B's access_token_ciphertext. household_isolation
// did not refuse it, because by the time the policy sees the statement it is an
// UPDATE of a row the GUC does not protect.
//
// WHAT PHASE A PROVES AND WHAT IT CANNOT, and the distinction is the phasing.
//
//   Phase A keeps the GLOBAL unique indexes, because migrate runs before the
//   Worker deploy and dropping them here would leave the new schema under the
//   old code. So a second household's insert is REFUSED with a unique violation
//   rather than admitted. That is the whole change and it is the security fix:
//   a silent cross-household overwrite becomes a loud refusal.
//
//   "Two households hold the same provider id and BOTH rows exist" is PHASE B's
//   fixture, and it cannot pass until 0047 drops the globals. Asserting it here
//   would be asserting Phase B's behaviour against Phase A's schema.
//
// SO THE ASSERTION IS ABOUT THE VICTIM'S ROW, NOT ABOUT THE OUTCOME OF THE
// SECOND INSERT. Whether the second household is refused (Phase A) or admitted
// (Phase B), the thing that must never happen is A's row changing, and that is
// what this file pins across both phases.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

const A = "01998888-9000-7000-8000-0000000005ee";
const B = "01998888-9001-7000-8000-0000000005ee";
const A_ITEM = "01998888-9002-7000-8000-0000000005ee";
const SHARED_ITEM_ID = "item-shared-joint-login";
const A_CIPHERTEXT = "v1.aaaaaaaa.aaaaaaaa";

beforeAll(async () => {
  await sql`insert into households (id, name) values
              (${A}, 'composite key A'), (${B}, 'composite key B')
            on conflict (id) do nothing`;
  await sql`insert into plaid_items (id, household_id, item_id, access_token_ciphertext)
            values (${A_ITEM}, ${A}, ${SHARED_ITEM_ID}, ${A_CIPHERTEXT})
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from plaid_items where household_id in (${A}, ${B})`;
  await sql`delete from households where id in (${A}, ${B})`;
  await sql.end();
});

/** The upsert exchange.ts issues, with the arbiter 4d gives it. */
async function upsertAs(household: string, itemId: string, ciphertext: string) {
  return sql.begin(async (tx) => {
    await tx`select set_config('marginsheet.household_id', ${household}, true)`;
    return tx`
      insert into plaid_items (household_id, item_id, access_token_ciphertext)
      values (${household}, ${itemId}, ${ciphertext})
      on conflict (household_id, item_id) do update
        set access_token_ciphertext = excluded.access_token_ciphertext,
            status = 'healthy', updated_at = now()
      returning id
    `;
  });
}

async function ciphertextOf(id: string): Promise<string | null> {
  const [r] = await sql<{ c: string | null }[]>`
    select access_token_ciphertext as c from plaid_items where id = ${id}
  `;
  return r?.c ?? null;
}

describe("the arbiter cannot reach another household's row", () => {
  it("THE FINDING: household B's upsert does not touch household A's token", async () => {
    // The 19 Aug demonstration, inverted into an assertion. Under the global
    // arbiter this REPLACED A's ciphertext and returned A's row id.
    //
    // THE EXCEPTION IS PART OF THE FIXTURE AND IS IDENTIFIED, which the first
    // version of this test did not do and which cost a harness cycle to learn.
    // It swallowed the error with .catch(() => undefined), so narrowing the
    // index back to item_id alone -- the planted mutation -- made the statement
    // fail with 42P10, "there is no unique or exclusion constraint matching the
    // ON CONFLICT specification", the catch absorbed it, A's row was trivially
    // unchanged, and the test passed against a broken arbiter.
    //
    // THAT IS THE SWALLOWED-THROW DEFECT CLAUDE.md ALREADY RECORDS, written
    // into the test for the very finding that defect originally concealed. A
    // catch that does not say WHICH error arrived is an unasserted branch.
    //
    // IN PHASE A THE EXPECTED ERROR IS 23505, unique_violation, raised by the
    // global index that 0046 deliberately leaves in place: the composite finds
    // no conflict for (B, shared item), so Postgres attempts the insert and the
    // surviving global index refuses it. PHASE B CHANGES THIS ASSERTION, because
    // dropping the global lets the insert succeed and both rows exist. The
    // assertion below is therefore about phase A on purpose and says so.
    let code: string | undefined;
    try {
      await upsertAs(B, SHARED_ITEM_ID, "v1.bbbbbbbb.bbbbbbbb");
    } catch (error: unknown) {
      code = (error as { code?: string }).code;
    }

    expect(
      code,
      "phase A expects the SURVIVING GLOBAL index to refuse B with a unique violation. " +
        "42P10 means the composite index is absent and ON CONFLICT matched nothing, which is the arbiter being broken " +
        "rather than the boundary holding. undefined means the insert succeeded, which is phase B's behaviour."
    ).toBe("23505");

    expect(
      await ciphertextOf(A_ITEM),
      "household A's Plaid access token was modified by household B's upsert, which is the confirmed 19 Aug finding"
    ).toBe(A_CIPHERTEXT);
  });

  it("the same household upserting its own Item still updates in place", async () => {
    // WITHOUT THIS THE COMPOSITE COULD BE ABSENT ENTIRELY and the test above
    // would still pass: no arbiter at all means no cross-household reach and
    // also no idempotent re-exchange. A re-fired exchange must not create a
    // second Item for one household.
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from plaid_items where household_id = ${A}
    `;
    await upsertAs(A, SHARED_ITEM_ID, "v1.cccccccc.cccccccc");
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from plaid_items where household_id = ${A}
    `;

    expect(after[0].n, "a re-fired exchange created a second Item for one household").toBe(before[0].n);
    expect(await ciphertextOf(A_ITEM), "the household's own upsert must update its own row").toBe(
      "v1.cccccccc.cccccccc"
    );
  });

  it("the household-scoped index exists and is unique", async () => {
    // The arbiter is inferred from an index, so ON CONFLICT silently changes
    // meaning if the index is not the one the statement assumes. Read from the
    // catalog rather than from the migration text: the migration says what was
    // intended and the catalog says what is there.
    const rows = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
       where tablename = 'plaid_items' and indexname = 'plaid_items_household_item_unique'
    `;
    expect(rows, "the composite index the upsert infers its arbiter from is absent").toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE/);
    expect(rows[0].indexdef).toMatch(/household_id/);
    expect(rows[0].indexdef).toMatch(/item_id/);
  });
});
