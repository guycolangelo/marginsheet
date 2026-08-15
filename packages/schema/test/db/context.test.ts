// Verification for §5b: context, instructions, watcher state.
//
// Invariant 3 is asserted by absence, invariant 4 by a round trip through
// the composable view, and the watcher's dedup by attempting the duplicate.

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

describe("invariant 3: no confidence, ever", () => {
  it("known_context has no column resembling a confidence score", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'known_context'
        and (column_name ilike '%confidence%'
             or column_name ilike '%score%'
             or column_name ilike '%certainty%'
             or column_name ilike '%probability%')
    `;
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it("records why the absence is the enforcement", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('known_context'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("NO CONFIDENCE FIELD, EVER");
    expect(row.description).toContain("the tool having an opinion about whether they meant it");
    expect(row.description).toContain("CONTRADICTION SUPERSEDES, NEVER ACCUMULATES");
    expect(row.description).toContain("STOP VOLUNTEERING, NEVER STOP KNOWING");
  });
});

describe("invariant 4: a deleted entry never reaches a fact package", () => {
  it("round trip: present, then deleted, then absent from the composable surface", async () => {
    const household = uuid();
    const [entry] = await sql<{ id: string }[]>`
      insert into known_context (household_id, type, text, said_at)
      values (${household}, 'plan', 'The trip is in November', now())
      returning id
    `;

    // A fact-package-shaped read, through the only surface composition may use.
    const before = await sql<{ id: string }[]>`
      select id from known_context_composable where household_id = ${household}
    `;
    expect(before.map((r) => r.id)).toContain(entry.id);

    // Soft delete, with the tombstone that makes it auditable.
    await sql`update known_context set deleted_at = now() where id = ${entry.id}`;
    await sql`
      insert into tombstones (household_id, entity_table, entity_id, reason)
      values (${household}, 'known_context', ${entry.id}, 'household asked to forget it')
    `;

    const after = await sql<{ id: string }[]>`
      select id from known_context_composable where household_id = ${household}
    `;
    expect(after.map((r) => r.id)).not.toContain(entry.id);

    // Deleted means the staff never brings it up, NOT that the record never
    // existed: the row and its tombstone both survive.
    const [stillThere] = await sql<{ n: number }[]>`
      select count(*)::int as n from known_context where id = ${entry.id}
    `;
    expect(stillThere.n).toBe(1);
    const [tomb] = await sql<{ n: number }[]>`
      select count(*)::int as n from tombstones where entity_id = ${entry.id}
    `;
    expect(tomb.n).toBe(1);

    await sql`delete from tombstones where entity_id = ${entry.id}`;
    await sql`delete from known_context where id = ${entry.id}`;
  });

  it("an expired entry is also absent from the composable surface", async () => {
    const household = uuid();
    const [entry] = await sql<{ id: string }[]>`
      insert into known_context (household_id, type, text, state)
      values (${household}, 'plan', 'The October trip', 'expired')
      returning id
    `;
    const rows = await sql<{ id: string }[]>`
      select id from known_context_composable where household_id = ${household}
    `;
    expect(rows).toHaveLength(0);
    await sql`delete from known_context where id = ${entry.id}`;
  });

  it("a dormant entry REMAINS composable: stop volunteering, never stop knowing", async () => {
    const household = uuid();
    const [entry] = await sql<{ id: string }[]>`
      insert into known_context (household_id, type, text, state)
      values (${household}, 'plan', 'The trip that already happened', 'dormant')
      returning id
    `;
    const rows = await sql<{ id: string }[]>`
      select id from known_context_composable where household_id = ${household}
    `;
    expect(rows.map((r) => r.id)).toContain(entry.id);
    await sql`delete from known_context where id = ${entry.id}`;
  });

  it("records the M2 test requirement so whoever builds it finds it", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('known_context_composable'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("THE ONLY SURFACE A FACT PACKAGE MAY READ");
    expect(row.description).toContain("REQUIREMENT M2 INHERITS");
    expect(row.description).toContain("A view nobody is required to use is a suggestion");
  });
});

describe("contradiction supersedes rather than accumulates", () => {
  it("links the old entry to the new one and leaves it dormant", async () => {
    const household = uuid();
    const [oldEntry] = await sql<{ id: string }[]>`
      insert into known_context (household_id, type, text)
      values (${household}, 'plan', 'The trip is in October') returning id
    `;
    const [newEntry] = await sql<{ id: string }[]>`
      insert into known_context (household_id, type, text)
      values (${household}, 'plan', 'The trip moved to November') returning id
    `;
    await sql`
      update known_context set state = 'dormant', superseded_by_id = ${newEntry.id}
      where id = ${oldEntry.id}
    `;

    const [row] = await sql<{ state: string; superseded_by_id: string }[]>`
      select state, superseded_by_id from known_context where id = ${oldEntry.id}
    `;
    expect(row.state).toBe("dormant");
    expect(row.superseded_by_id).toBe(newEntry.id);

    await sql`delete from known_context where household_id = ${household}`;
  });
});

describe("the watcher's dedup memory", () => {
  it("refuses a second row for the same household, rule, and subject", async () => {
    const household = uuid();
    const subject = { account_id: "acct-1", kind: "low_balance" };

    await sql`
      insert into condition_states (household_id, rule_id, subject)
      values (${household}, 'cannot_cover', ${sql.json(subject)})
    `;

    // Six syncs, one message: the second sighting collides.
    await expect(
      sql`insert into condition_states (household_id, rule_id, subject)
          values (${household}, 'cannot_cover', ${sql.json(subject)})`
    ).rejects.toThrow(/condition_states_subject_unique/);

    // A different subject under the same rule is a different condition.
    await sql`
      insert into condition_states (household_id, rule_id, subject)
      values (${household}, 'cannot_cover', ${sql.json({ account_id: "acct-2", kind: "low_balance" })})
    `;

    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from condition_states where household_id = ${household}
    `;
    expect(row.n).toBe(2);
    await sql`delete from condition_states where household_id = ${household}`;
  });

  it("subject_hash is generated and cannot be written inconsistently", async () => {
    const [col] = await sql<{ is_generated: string; generation_expression: string | null }[]>`
      select is_generated, generation_expression from information_schema.columns
      where table_name = 'condition_states' and column_name = 'subject_hash'
    `;
    expect(col.is_generated).toBe("ALWAYS");
    expect(col.generation_expression).toContain("md5");

    // Writing it directly is refused by Postgres, so two writers cannot
    // disagree about the hash of the same subject. Postgres words this as
    // "cannot insert a non-DEFAULT value into column ..."; the phrase
    // "generated column" appears only in the error DETAIL, not the message.
    await expect(
      sql`insert into condition_states (household_id, rule_id, subject, subject_hash)
          values (${uuid()}, 'r', ${sql.json({ a: 1 })}, 'handwritten')`
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "subject_hash"/i);
  });

  it("records that one message across many syncs is structural", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('condition_states'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("THE WATCHER DEDUP MEMORY");
    expect(row.description).toContain("IS WHAT MAKES THAT STRUCTURAL");
    expect(row.description).toContain("EXACTLY ONE follow-up");
  });
});

describe("§5b scoping", () => {
  it("every table is household-scoped", async () => {
    const tables = [
      "known_context",
      "tombstones",
      "standing_instructions",
      "tags",
      "tag_members",
      "decision_journal",
      "handoffs",
      "condition_states",
      "calibration_bands",
      "insight_ledger",
      "receivables",
    ];
    for (const table of tables) {
      const [row] = await sql<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_name = ${table} and column_name = 'household_id'
      `;
      expect(row, `${table} is missing household_id`).toBeTruthy();
      expect(row.is_nullable, table).toBe("NO");
    }
  });
});
