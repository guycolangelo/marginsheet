// members.auth_user_id: the soft reference, and the integrity test M1 owed.
//
// Task 1.1 ruled NO foreign key on members.auth_user_id, and an integrity
// test instead. The reasoning: a member is a person inside a household, and a
// Better Auth user is a person who can sign in. Those lifecycles are not the
// same, and M9's migration creates members for a household before any of them
// has ever signed in. A foreign key would make the migration order a hard
// dependency in the wrong direction.
//
// That ruling traded an enforced constraint for a tested one, and the test
// could not be written at the time because Better Auth's `user` table did not
// exist. It exists as of migration 0011, so the debt closes here.
//
// A soft reference with no test is not a soft reference. It is an absent
// constraint with a comment.

import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
afterAll(async () => {
  await sql.end();
});

describe("the soft reference is deliberate and still soft", () => {
  it("has no foreign key from members.auth_user_id to user.id", async () => {
    // If someone adds the FK later, this fails and they have to read 1.1's
    // reasoning before deciding to overrule it. That is the point.
    const rows = await sql`
      select conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
       where t.relname = 'members'
         and c.contype = 'f'
         and pg_get_constraintdef(c.oid) ilike '%"user"%'
    `;
    expect(
      rows,
      "a foreign key now enforces what 1.1 ruled should be tested instead"
    ).toHaveLength(0);
  });

  it("the column exists and is nullable, because a member may never sign in", async () => {
    const [col] = await sql<{ is_nullable: string }[]>`
      select is_nullable
        from information_schema.columns
       where table_name = 'members' and column_name = 'auth_user_id'
    `;
    expect(col).toBeTruthy();
    expect(col.is_nullable).toBe("YES");
  });
});

describe("integrity: no member points at a user that does not exist", () => {
  // The query the soft reference is worth exactly as much as.
  const orphanQuery = () => sql`
    select m.id
      from members m
     where m.auth_user_id is not null
       and not exists (select 1 from "user" u where u.id = m.auth_user_id)
  `;

  it("finds no orphans", async () => {
    const orphans = await orphanQuery();
    expect(
      orphans.map((o) => o.id),
      "members reference Better Auth users that do not exist"
    ).toEqual([]);
  });

  it("NEGATIVE CONTROL: the query does find an orphan when one exists", async () => {
    // Without this, "no orphans" is indistinguishable from "the query is
    // broken and returns nothing". Everything is rolled back.
    await sql.begin(async (tx) => {
      const [hh] = await tx`
        insert into households (name) values ('orphan probe') returning id
      `;
      const [member] = await tx`
        insert into members (household_id, first_name, role, auth_user_id)
        values (${hh.id}, 'Orphan', 'full_member', 'user_that_does_not_exist')
        returning id
      `;

      const orphans = await tx`
        select m.id
          from members m
         where m.auth_user_id is not null
           and not exists (select 1 from "user" u where u.id = m.auth_user_id)
      `;
      expect(orphans.map((o) => o.id)).toContain(member.id);

      throw new Error("rollback the probe");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback the probe") throw e;
    });

    // And the rollback actually happened.
    expect(await orphanQuery()).toEqual([]);
  });
});
