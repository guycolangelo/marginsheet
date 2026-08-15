// Verification for §5a: threads, messages, question dispatches.
//
// The gate constraint and the first-answer-wins race are both exercised
// rather than inspected. A CHECK nobody has violated and a CAS nobody has
// raced are both indistinguishable from nothing.

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

type GateResult = { lint_pass: boolean; judge_pass: boolean; attempts: number; degraded_to_fixture?: boolean };

async function insertMessage(fields: {
  status: string | null;
  gate_result: GateResult | null;
  body?: string;
}) {
  const household = uuid();
  return sql`
    insert into messages
      (household_id, member_id, brain, direction, channel, status, gate_result, body)
    values
      (${household}, ${uuid()}, 'mykeeper', 'outbound', 'sms',
       ${fields.status},
       ${fields.gate_result ? sql.json(fields.gate_result) : null},
       ${fields.body ?? "probe"})
    returning id
  `;
}

describe("invariant 7: no gate, no send", () => {
  it("refuses a sent message with no gate result", async () => {
    await expect(
      insertMessage({ status: "sent", gate_result: null })
    ).rejects.toThrow(/messages_sent_requires_gate/);
  });

  it("accepts a sent message that carries one", async () => {
    const [row] = await insertMessage({
      status: "sent",
      gate_result: { lint_pass: true, judge_pass: true, attempts: 1, degraded_to_fixture: false },
    });
    expect(row.id).toBeTruthy();
    await sql`delete from messages where id = ${row.id}`;
  });

  it("accepts a fixture-degraded send, because a fixture is a gated outcome", async () => {
    const [row] = await insertMessage({
      status: "sent",
      gate_result: { lint_pass: true, judge_pass: false, attempts: 3, degraded_to_fixture: true },
    });
    expect(row.id).toBeTruthy();
    await sql`delete from messages where id = ${row.id}`;
  });

  it("leaves pre-send statuses unconstrained, so the rule is scoped rather than blanket", async () => {
    for (const status of ["composed", "held_shadow", "suppressed_no_gate"]) {
      const [row] = await insertMessage({ status, gate_result: null });
      expect(row.id, status).toBeTruthy();
      await sql`delete from messages where id = ${row.id}`;
    }
  });

  it("records that the gate never fails open and that a fixture is not a bypass", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(c.oid, 'pg_constraint') as description
      from pg_constraint c where c.conname = 'messages_sent_requires_gate'
    `;
    expect(row.description).toContain("NEVER FAILS OPEN");
    expect(row.description).toContain("DEGRADE-TO-FIXTURE STILL PRODUCES A GATE_RESULT");
    expect(row.description).toContain("GATED OUTCOME, not a bypass");
  });
});

describe("the traceability pairing", () => {
  it("stores the package and the body it produced on one row", async () => {
    const household = uuid();
    const pkg = { kept: { value: "2140.00", source: "ledger.kept" } };
    const [row] = await sql<{ id: string }[]>`
      insert into messages
        (household_id, member_id, brain, direction, channel, status, gate_result,
         body, fact_package, fact_package_version)
      values
        (${household}, ${uuid()}, 'mykeeper', 'outbound', 'sms', 'sent',
         ${sql.json({ lint_pass: true, judge_pass: true, attempts: 1 })},
         'You kept $2,140 in July.', ${sql.json(pkg)}, 'v1')
      returning id
    `;

    const [stored] = await sql<{ fact_package: object; body: string; fact_package_version: string }[]>`
      select fact_package, body, fact_package_version from messages where id = ${row.id}
    `;
    expect(stored.fact_package).toEqual(pkg);
    expect(stored.body).toContain("2,140");
    expect(stored.fact_package_version).toBe("v1");

    await sql`delete from messages where id = ${row.id}`;
  });

  it("records why the pairing, not the package alone, is the audit trail", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('messages'::regclass, ordinal_position) as description
      from information_schema.columns
      where table_name = 'messages' and column_name = 'fact_package'
    `;
    expect(row.description).toContain("THE PAIRING IS THE POINT");
    expect(row.description).toContain("checkable AFTER THE FACT");
    expect(row.description).toContain("Model memory is banned");
  });

  it("refuses a duplicate provider_message_id", async () => {
    const providerId = `msg_${uuid()}`;
    const household = uuid();
    const insert = () => sql`
      insert into messages (household_id, member_id, brain, direction, channel, provider_message_id)
      values (${household}, ${uuid()}, 'mykeeper', 'inbound', 'sms', ${providerId})
      returning id
    `;
    const [first] = await insert();
    await expect(insert()).rejects.toThrow(/messages_provider_message_id_unique/);
    await sql`delete from messages where id = ${first.id}`;
  });
});

describe("first answer wins, raced rather than described", () => {
  it("two concurrent conditional updates produce exactly one winner", async () => {
    const household = uuid();
    const [dispatch] = await sql<{ id: string }[]>`
      insert into question_dispatches (household_id, question_text, state)
      values (${household}, 'Who was the $200 deposit from?', 'pending')
      returning id
    `;

    // Two separate connections, so this is a real race rather than two
    // statements queued on one socket.
    const a = postgres(DATABASE_URL!, { max: 1 });
    const b = postgres(DATABASE_URL!, { max: 1 });
    const memberA = uuid();
    const memberB = uuid();

    const claim = (client: postgres.Sql, member: string) => client`
      update question_dispatches
         set state = 'answered', answered_by_member_id = ${member}, resolved_at = now()
       where id = ${dispatch.id} and state = 'pending'
      returning id
    `;

    try {
      const [resA, resB] = await Promise.all([claim(a, memberA), claim(b, memberB)]);
      const winners = [resA, resB].filter((r) => r.length === 1);
      const losers = [resA, resB].filter((r) => r.length === 0);

      // Exactly one resolution. The loser's zero rows is the signal to
      // compose the closure receipt, which is not optional.
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
    } finally {
      await a.end();
      await b.end();
    }

    const [final] = await sql<{ state: string; answered_by_member_id: string }[]>`
      select state, answered_by_member_id from question_dispatches where id = ${dispatch.id}
    `;
    expect(final.state).toBe("answered");
    expect([memberA, memberB]).toContain(final.answered_by_member_id);

    await sql`delete from question_dispatches where id = ${dispatch.id}`;
  });

  it("records that the closure receipt is not optional", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('question_dispatches'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("THE CLOSURE RECEIPT IS NOT OPTIONAL");
    expect(row.description).toContain("no secrets between principals");
    expect(row.description).toContain("NEVER A DOUBLE-WRITE");
    expect(row.description).toContain("NEVER SILENTLY ADJUDICATED");
  });

  it("stores transaction_ids as a real uuid array", async () => {
    const [row] = await sql<{ data_type: string; udt_name: string }[]>`
      select data_type, udt_name from information_schema.columns
      where table_name = 'question_dispatches' and column_name = 'transaction_ids'
    `;
    expect(row.data_type).toBe("ARRAY");
    expect(row.udt_name).toBe("_uuid");
  });
});

describe("threads", () => {
  it("are one per member and brain", async () => {
    const household = uuid();
    const member = uuid();
    await sql`insert into threads (household_id, member_id, brain) values (${household}, ${member}, 'mykeeper')`;
    // A different brain for the same member is a different thread.
    await sql`insert into threads (household_id, member_id, brain) values (${household}, ${member}, 'mycfo')`;
    await expect(
      sql`insert into threads (household_id, member_id, brain) values (${household}, ${member}, 'mykeeper')`
    ).rejects.toThrow(/threads_member_brain_unique/);
    await sql`delete from threads where member_id = ${member}`;
  });

  it("record that thread state is a timestamp, not a machine", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('threads'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("A TIMESTAMP, NOT A MACHINE");
  });
});
