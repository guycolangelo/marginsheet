// Verification for §§6-8: artifacts, LLM infrastructure, billing.
//
// Invariant 6 is asserted by absence, with a positive check alongside so the
// absence test cannot pass on an empty table. The claim protocol is tested
// as the predicate the workers actually run.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL ?? "", { max: 1 });

const uuid = () => crypto.randomUUID();

beforeAll(() => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for introspection tests");
});
afterAll(async () => {
  await sql.end();
});

describe("invariant 6: global_merchant_facts holds no household life", () => {
  it("has no household-identifying reference", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'global_merchant_facts'
        and column_name in ('household_id', 'member_id', 'account_id', 'transaction_id')
    `;
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it("has no column that could carry an amount, an account, or an instrument", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'global_merchant_facts'
        and (column_name ilike '%amount%'
             or column_name ilike '%balance%'
             or column_name ilike '%account%'
             or column_name ilike '%transaction%'
             or column_name ilike '%currency%'
             or column_name ilike '%mask%'
             or column_name ilike '%institution%')
    `;
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it("has no date column, because a date here could only describe household activity", async () => {
    // Record lifecycle uses timestamptz (created_at, updated_at,
    // graduated_at). A bare `date` column would be a bank day, and a bank
    // day in this table is by definition somebody's transaction.
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'global_merchant_facts' and data_type = 'date'
    `;
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it("still holds the facts it is supposed to, so the absence tests are not passing on an empty table", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'global_merchant_facts'
      order by column_name
    `;
    const names = rows.map((r) => r.column_name);
    for (const expected of [
      "merchant_key",
      "category_name",
      "direction",
      "evidence_count",
      "distinct_households",
      "graduated_at",
      "blocked",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("records that the invariant is absence, and that the table is attorney-gated", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('global_merchant_facts'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("WHAT IT DOES NOT HAVE");
    expect(row.description).toContain("BREAKS THE INVARIANT; IT DOES NOT EXTEND THE TABLE");
    expect(row.description).toContain("NEVER ANOTHER HOUSEHOLD LIFE");
    expect(row.description).toContain("ATTORNEY-GATED");
  });
});

describe("the llm_cache claim protocol", () => {
  const claimPredicate = (id: string) => sql`
    update llm_cache
       set claimed_at = now()
     where id = ${id}
       and (status = 'failed'
            or (status = 'pending' and claimed_at < now() - interval '5 minutes'))
    returning id
  `;

  it("reclaims a claim older than five minutes", async () => {
    const household = uuid();
    const [row] = await sql<{ id: string }[]>`
      insert into llm_cache (household_id, cache_type, pattern_key, status, claimed_at)
      values (${household}, 'adjudication', ${"key_" + uuid()}, 'pending', now() - interval '6 minutes')
      returning id
    `;
    const reclaimed = await claimPredicate(row.id);
    expect(reclaimed).toHaveLength(1);
    await sql`delete from llm_cache where id = ${row.id}`;
  });

  it("does not reclaim a live claim", async () => {
    const household = uuid();
    const [row] = await sql<{ id: string }[]>`
      insert into llm_cache (household_id, cache_type, pattern_key, status, claimed_at)
      values (${household}, 'adjudication', ${"key_" + uuid()}, 'pending', now())
      returning id
    `;
    const reclaimed = await claimPredicate(row.id);
    expect(reclaimed).toHaveLength(0);
    await sql`delete from llm_cache where id = ${row.id}`;
  });

  it("serializes two workers claiming the same pattern: exactly one wins", async () => {
    const household = uuid();
    const key = `key_${uuid()}`;
    const a = postgres(DATABASE_URL!, { max: 1 });
    const b = postgres(DATABASE_URL!, { max: 1 });

    const claim = (client: postgres.Sql) => client`
      insert into llm_cache (household_id, cache_type, pattern_key, status, claimed_at)
      values (${household}, 'adjudication', ${key}, 'pending', now())
      on conflict (household_id, cache_type, pattern_key) do nothing
      returning id
    `;

    try {
      const [resA, resB] = await Promise.all([claim(a), claim(b)]);
      const winners = [resA, resB].filter((r) => r.length === 1);
      expect(winners).toHaveLength(1);
    } finally {
      await a.end();
      await b.end();
    }

    await sql`delete from llm_cache where household_id = ${household}`;
  });

  it("records that the timeout is what stops a crashed worker wedging a merchant", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('llm_cache'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("THE COST MODEL, NOT AN IMPLEMENTATION DETAIL");
    expect(row.description).toContain("WEDGED FOREVER");
    expect(row.description).toContain("RECLAIMED, NOT DELETED");
  });
});

describe("artifacts: a correction is composed and sent, never an edit", () => {
  it("the original is unmodified and both ends of the chain resolve", async () => {
    const household = uuid();
    const [original] = await sql<{ id: string; body: string; updated_at: Date }[]>`
      insert into artifacts (household_id, kind, body, period)
      values (${household}, 'monthly_close', 'You kept $2,140 in July.', '2026-07')
      returning id, body, updated_at
    `;

    const [correction] = await sql<{ id: string }[]>`
      insert into artifacts (household_id, kind, body, corrects_artifact_id, period)
      values (${household}, 'correction', 'July was $2,090, not $2,140. Fixed, and the rule is updated.',
              ${original.id}, '2026-07')
      returning id
    `;
    await sql`
      update artifacts set corrected_by_artifact_id = ${correction.id} where id = ${original.id}
    `;

    // The household read $2,140 on Tuesday. It is still $2,140 on Friday.
    const [after] = await sql<{ body: string; corrected_by_artifact_id: string }[]>`
      select body, corrected_by_artifact_id from artifacts where id = ${original.id}
    `;
    expect(after.body).toBe("You kept $2,140 in July.");
    expect(after.corrected_by_artifact_id).toBe(correction.id);

    // And the chain resolves from either end without a scan.
    const [back] = await sql<{ corrects_artifact_id: string }[]>`
      select corrects_artifact_id from artifacts where id = ${correction.id}
    `;
    expect(back.corrects_artifact_id).toBe(original.id);

    await sql`delete from artifacts where household_id = ${household}`;
  });

  it("records the household-facing consequence, not only the rule", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('artifacts'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("NEVER SILENTLY REVISED");
    expect(row.description).toContain("read a number on Tuesday");
    expect(row.description).toContain("AND THE HOUSEHOLD IS RIGHT");
  });
});

describe("billing and logs", () => {
  it("stripe status is text, so a Stripe vocabulary change is not a migration", async () => {
    const [row] = await sql<{ data_type: string }[]>`
      select data_type from information_schema.columns
      where table_name = 'stripe_subscriptions' and column_name = 'status'
    `;
    expect(row.data_type).toBe("text");
  });

  it("llm_call_logs records the model actually served and whether it was a fallback", async () => {
    const names = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = 'llm_call_logs'
      `
    ).map((r) => r.column_name);
    expect(names).toContain("model");
    expect(names).toContain("fallback_used");
    expect(names).toContain("message_id");
  });

  it("refuses a duplicate llm_cache pattern for one household", async () => {
    const household = uuid();
    const key = `key_${uuid()}`;
    await sql`
      insert into llm_cache (household_id, cache_type, pattern_key)
      values (${household}, 'question', ${key})
    `;
    await expect(
      sql`insert into llm_cache (household_id, cache_type, pattern_key)
          values (${household}, 'question', ${key})`
    ).rejects.toThrow(/llm_cache_pattern_unique/);
    await sql`delete from llm_cache where household_id = ${household}`;
  });
});
