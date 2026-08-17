// auth_household_id(): the first deliberate hole in the RLS boundary (3.1a).
//
// Migration 0018 adds one SECURITY DEFINER function so that authentication can
// bootstrap: a session identifies a USER, the member row says which HOUSEHOLD,
// and the member row cannot be read until the household is known. That circle
// has no solution inside the policy.
//
// A deliberate hole needs its edges tested, not its intentions described. Guy
// set four constraints on 17 Aug 2026 and required them ENFORCED rather than
// documented. This file attempts to exceed each one and requires failure:
//
//   1. it returns the household id and NOTHING else
//   2. it takes the auth user id and NOTHING else
//   3. its privileges are enumerated, not granted broadly
//   4. an attempt to read anything beyond the id fails
//
// The fourth is the one that matters, and the strongest form of it is the last
// describe block: setting the GUC from this function's answer must give the
// caller exactly what the policy already intended, and not one row more. If
// the hole were wider than one id, that is where it would show.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

/** Two households that must never see each other. */
let alice: { household: string; member: string; userId: string };
let bob: { household: string; member: string; userId: string };

async function seed(name: string) {
  const userId = `user_${crypto.randomUUID()}`;
  const [h] = await owner<{ id: string }[]>`
    insert into households (name) values (${name}) returning id
  `;
  const [m] = await owner<{ id: string }[]>`
    insert into members (household_id, first_name, role, auth_user_id, phone)
    values (${h.id}, ${name}, 'full_member', ${userId}, '+15550000000')
    returning id
  `;
  return { household: h.id, member: m.id, userId };
}

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "rls");
  app = postgres(appUrl, { max: 1 });
  alice = await seed("Alice Household");
  bob = await seed("Bob Household");
});

afterAll(async () => {
  if (owner) await owner.end();
  if (app) await app.end();
});

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the RLS resolver suite");
});

describe.skipIf(!configured)("it answers the one question it exists for", () => {
  it("resolves an auth user to their household", async () => {
    const [row] = await app<{ id: string | null }[]>`
      select public.auth_household_id(${alice.userId}) as id
    `;
    expect(row.id).toBe(alice.household);
  });

  it("resolves an unknown user to null rather than erroring", async () => {
    const [row] = await app<{ id: string | null }[]>`
      select public.auth_household_id('user_does_not_exist') as id
    `;
    expect(row.id).toBeNull();
  });

  it("resolves a REMOVED member to null, so a departure closes the door", async () => {
    const gone = await seed("Departed Household");
    await owner`update members set status = 'removed' where id = ${gone.member}`;

    const [row] = await app<{ id: string | null }[]>`
      select public.auth_household_id(${gone.userId}) as id
    `;
    expect(
      row.id,
      "a removed member still resolved to a household, so removal grants nothing back"
    ).toBeNull();
  });
});

describe.skipIf(!configured)("constraint 1: it returns an id and nothing else", () => {
  it("yields exactly one column, and it is a uuid", async () => {
    // A function returning a row would let a caller select member columns
    // through it, which is the wider hole this constraint forbids.
    const rows = await app.unsafe(`select * from public.auth_household_id('${alice.userId}')`);
    const columns = Object.keys(rows[0] ?? {});
    expect(columns, `the function yielded ${columns.length} columns: ${columns}`).toHaveLength(1);

    const [{ kind }] = await app<{ kind: string }[]>`
      select pg_catalog.pg_get_function_result(p.oid) as kind
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'auth_household_id'
    `;
    expect(kind).toBe("uuid");
  });

  it("ATTEMPT: selecting a member column through it fails", async () => {
    // Constraint 4, in its most direct form. If the function returned a
    // composite, this would succeed and leak the member row.
    await expect(
      app.unsafe(`select (public.auth_household_id('${alice.userId}')).phone`)
    ).rejects.toThrow();
  });

  it("ATTEMPT: expanding it as a record fails", async () => {
    await expect(
      app.unsafe(
        `select * from public.auth_household_id('${alice.userId}') as t(id uuid, phone text)`
      )
    ).rejects.toThrow();
  });
});

describe.skipIf(!configured)("constraint 2: it takes one argument", () => {
  it("ATTEMPT: calling it with a second argument fails", async () => {
    await expect(
      app.unsafe(`select public.auth_household_id('${alice.userId}', 'extra')`)
    ).rejects.toThrow();
  });

  it("has exactly one declared parameter", async () => {
    const [{ args }] = await app<{ args: string }[]>`
      select pg_catalog.pg_get_function_arguments(p.oid) as args
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'auth_household_id'
    `;
    expect(args).toBe("p_auth_user_id text");
  });
});

describe.skipIf(!configured)("constraint 3: privileges are enumerated", () => {
  it("marginsheet_sync CANNOT execute it", async () => {
    // Postgres grants EXECUTE to PUBLIC by default on new functions, which for
    // a SECURITY DEFINER function means every role. 0018 revokes that and
    // names one. This proves the revoke bit rather than that it was written.
    const [{ allowed }] = await app<{ allowed: boolean }[]>`
      select pg_catalog.has_function_privilege(
        'marginsheet_sync', 'public.auth_household_id(text)', 'EXECUTE'
      ) as allowed
    `;
    expect(
      allowed,
      "the sync worker can resolve arbitrary users to households, which enumerates membership"
    ).toBe(false);
  });

  it("PUBLIC cannot execute it", async () => {
    const [{ allowed }] = await app<{ allowed: boolean }[]>`
      select pg_catalog.has_function_privilege(
        'public', 'public.auth_household_id(text)', 'EXECUTE'
      ) as allowed
    `;
    expect(allowed).toBe(false);
  });

  it("marginsheet_app CAN, so the enumeration is surgical", async () => {
    const [{ allowed }] = await app<{ allowed: boolean }[]>`
      select pg_catalog.has_function_privilege(
        'marginsheet_app', 'public.auth_household_id(text)', 'EXECUTE'
      ) as allowed
    `;
    expect(allowed).toBe(true);
  });

  it("its search_path is pinned, so it cannot be hijacked", async () => {
    // An unqualified name inside a SECURITY DEFINER function resolves against
    // the CALLER's search_path, which is the classic escalation. Pinned empty
    // with every name schema-qualified.
    const [{ config }] = await app<{ config: string[] | null }[]>`
      select p.proconfig as config
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'auth_household_id'
    `;
    // Postgres records it as search_path="" for the empty pin. Asserted as
    // pinned-and-empty rather than merely present: search_path=public would
    // also be "pinned" and would still resolve `members` against a schema an
    // attacker could shadow.
    expect(config ?? []).toContain('search_path=""');
  });
});

describe.skipIf(!configured)("constraint 4: the hole is exactly one id wide", () => {
  it("setting the GUC from it shows that household and NO other", async () => {
    // The strongest form of the constraint. If the definer function widened
    // access generally rather than answering one question, this is where a
    // second household's rows would appear.
    await app.begin(async (tx) => {
      const [resolved] = await tx<{ id: string }[]>`
        select public.auth_household_id(${alice.userId}) as id
      `;
      await tx`select set_config('marginsheet.household_id', ${resolved.id}, true)`;

      const visible = await tx<{ id: string; household_id: string }[]>`
        select id, household_id from members
      `;
      expect(visible.map((r) => r.id)).toEqual([alice.member]);
      expect(
        visible.every((r) => r.household_id === alice.household),
        "another household's members were visible"
      ).toBe(true);
    });
  });

  it("ATTEMPT: resolving Bob does not let Alice's context read Bob's rows", async () => {
    // The function will happily resolve any user id it is given, which is why
    // EXECUTE is enumerated. What it must NOT do is grant anything: the id is
    // opaque and the policy still stands between it and a row.
    await app.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${alice.household}, true)`;

      const [resolved] = await tx<{ id: string }[]>`
        select public.auth_household_id(${bob.userId}) as id
      `;
      expect(resolved.id, "the resolver refused to answer, which is not the control").toBe(
        bob.household
      );

      const leaked = await tx<{ id: string }[]>`
        select id from members where household_id = ${bob.household}
      `;
      expect(
        leaked,
        "holding another household's id was enough to read their members"
      ).toHaveLength(0);
    });
  });

  it("with no GUC set, the caller sees nothing at all", async () => {
    const rows = await app<{ id: string }[]>`select id from members`;
    expect(rows, "members were readable with no household context").toHaveLength(0);
  });
});

describe.skipIf(!configured)("it is the ONLY definer function", () => {
  it("no second SECURITY DEFINER function has appeared", async () => {
    // Adding one is a ruling of Guy's, not an implementation detail (0018).
    // "We also needed X" is how an RLS boundary becomes advisory one
    // convenience at a time, so a new one fails here and has to be argued.
    const rows = await app<{ name: string }[]>`
      select p.proname as name
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
       order by p.proname
    `;
    expect(
      rows.map((r) => r.name),
      "a new SECURITY DEFINER function exists. THE BAR (Guy, 17 Aug 2026): a second one needs a case where the cost of NOT having it is a household HARMED, not a household INCONVENIENCED. Rule 2's phone-uniqueness timing failed that bar and was ruled not worth it: one wasted SMS against a permanent widening of the RLS boundary. Show which harm this prevents, or find the answer inside the policy."
    ).toEqual(["auth_household_id"]);
  });
});
