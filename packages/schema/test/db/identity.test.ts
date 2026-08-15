// Verification for §1 identity and membership, by introspecting the branch
// and by attempting the things the schema is supposed to refuse.
//
// Behavior is asserted by attempting inserts, not by reading index
// definitions: an index that exists but does not bite is not a constraint.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL ?? "", { max: 1 });

const household = () => crypto.randomUUID();

beforeAll(() => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for introspection tests");
});
afterAll(async () => {
  await sql.end();
});

describe("the verified-phone rule bites", () => {
  it("refuses a second VERIFIED member on the same number, across households", async () => {
    const number = `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
    const [first] = await sql<{ id: string }[]>`
      insert into members (household_id, phone, phone_verified_at)
      values (${household()}, ${number}, now()) returning id
    `;

    // A different household entirely: the rule is global, not per-household.
    await expect(
      sql`insert into members (household_id, phone, phone_verified_at)
          values (${household()}, ${number}, now())`
    ).rejects.toThrow(/members_verified_phone_unique/);

    await sql`delete from members where id = ${first.id}`;
  });

  it("permits two UNVERIFIED members on the same number, deliberately", async () => {
    const number = `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
    const rows = await sql<{ id: string }[]>`
      insert into members (household_id, phone)
      values (${household()}, ${number}), (${household()}, ${number})
      returning id
    `;
    expect(rows).toHaveLength(2);
    await sql`delete from members where id in ${sql(rows.map((r) => r.id))}`;
  });

  it("phone_verified_at defaults to null, so the channel gate starts closed", async () => {
    const [row] = await sql<{ phone_verified_at: Date | null; id: string }[]>`
      insert into members (household_id, phone) values (${household()}, '+15555550100')
      returning id, phone_verified_at
    `;
    expect(row.phone_verified_at).toBeNull();
    await sql`delete from members where id = ${row.id}`;
  });
});

describe("consent records stand alone as evidence", () => {
  it("a revoked row still holds its original language and number", async () => {
    const hh = household();
    const [member] = await sql<{ id: string }[]>`
      insert into members (household_id, phone, phone_verified_at)
      values (${hh}, '+15555550111', now()) returning id
    `;

    const language =
      "I agree to receive account and bookkeeping text messages from MarginSheet at the number provided. Message and data rates may apply.";

    const [consent] = await sql<{ id: string }[]>`
      insert into consent_records
        (household_id, member_id, kind, consent_text, phone_at_grant, granted_at, source)
      values
        (${hh}, ${member.id}, 'sms_transactional', ${language}, '+15555550111', now(), 'signup_checkbox')
      returning id
    `;

    // The member's phone changes afterward, in-app. The consent record must
    // not follow it.
    await sql`update members set phone = '+15555550222', phone_verified_at = now() where id = ${member.id}`;
    // And the consent is revoked.
    await sql`update consent_records set revoked_at = now() where id = ${consent.id}`;

    const [after] = await sql<{
      consent_text: string;
      phone_at_grant: string;
      granted_at: Date;
      revoked_at: Date | null;
    }[]>`
      select consent_text, phone_at_grant, granted_at, revoked_at
      from consent_records where id = ${consent.id}
    `;

    expect(after.consent_text).toBe(language);
    expect(after.phone_at_grant).toBe("+15555550111");
    expect(after.granted_at).toBeInstanceOf(Date);
    expect(after.revoked_at).not.toBeNull();

    await sql`delete from consent_records where id = ${consent.id}`;
    await sql`delete from members where id = ${member.id}`;
  });

  it("consent_text is required: a record with no language is not evidence", async () => {
    await expect(
      sql`insert into consent_records (household_id, member_id, kind, phone_at_grant, granted_at, source)
          values (${household()}, ${crypto.randomUUID()}, 'sms_transactional', '+15555550133', now(), 'signup_checkbox')`
    ).rejects.toThrow(/consent_text/);
  });

  it("the append-only rule is recorded where a reader will find it", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description('consent_records'::regclass, 'pg_class') as description
    `;
    expect(row.description).toContain("APPEND-ONLY");
    expect(row.description).toContain("A new grant is a NEW ROW");
  });
});

describe("role: contributor is defined but not live", () => {
  it("has exactly the two values, in order, with full_member as the default", async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'member_role' order by e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual(["full_member", "contributor"]);

    const [col] = await sql<{ column_default: string | null }[]>`
      select column_default from information_schema.columns
      where table_name = 'members' and column_name = 'role'
    `;
    expect(col.column_default).toContain("full_member");
  });

  it("says plainly that only full_member is live", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select obj_description(t.oid, 'pg_type') as description
      from pg_type t where t.typname = 'member_role'
    `;
    expect(row.description).toContain("ONLY full_member IS LIVE AT LAUNCH");
    expect(row.description).toContain("DEFINED BUT UNUSED");
  });
});

describe("the phone rules are readable from the database", () => {
  it("the no-write-path rule is on the phone column", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('members'::regclass, ordinal_position) as description
      from information_schema.columns
      where table_name = 'members' and column_name = 'phone'
    `;
    expect(row.description).toContain("NO WRITE PATH FROM ANY CHANNEL");
    expect(row.description).toContain("recent-auth");
  });

  it("the channel gate rule is on phone_verified_at", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('members'::regclass, ordinal_position) as description
      from information_schema.columns
      where table_name = 'members' and column_name = 'phone_verified_at'
    `;
    expect(row.description).toContain("THE GATE ON ALL CHANNEL ACCESS");
  });

  it("auth_user_id records the soft reference as deliberate", async () => {
    const [row] = await sql<{ description: string | null }[]>`
      select col_description('members'::regclass, ordinal_position) as description
      from information_schema.columns
      where table_name = 'members' and column_name = 'auth_user_id'
    `;
    expect(row.description).toContain("DELIBERATELY NOT A FOREIGN KEY");

    // And there is genuinely no FK on it, so the comment is not aspirational.
    const fks = await sql<{ constraint_name: string }[]>`
      select tc.constraint_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
      where tc.table_name = 'members'
        and tc.constraint_type = 'FOREIGN KEY'
        and kcu.column_name = 'auth_user_id'
    `;
    expect(fks).toHaveLength(0);
  });
});

describe("household scoping", () => {
  it("households has no household_id, and every other §1 table does", async () => {
    const [hh] = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_name = 'households' and column_name = 'household_id'
    `;
    expect(hh.n).toBe(0);

    for (const table of ["members", "invitations", "trial_records", "consent_records"]) {
      const [row] = await sql<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_name = ${table} and column_name = 'household_id'
      `;
      expect(row, `${table} is missing household_id`).toBeTruthy();
      expect(row.is_nullable, table).toBe("NO");
    }
  });

  it("entitlement_state is nullable, because null means pre-checkout", async () => {
    const [row] = await sql<{ is_nullable: string }[]>`
      select is_nullable from information_schema.columns
      where table_name = 'households' and column_name = 'entitlement_state'
    `;
    expect(row.is_nullable).toBe("YES");
  });
});
