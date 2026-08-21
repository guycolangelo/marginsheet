// The sync role carries a statement bound, read from the CATALOG.
//
// THE DIFFICULTY IS THE WHOLE CONTROL, and it is the same finding as tonight's
// has_column_privilege one, in a different catalog.
//
// ALTER ROLE ... SET APPLIES AT LOGIN. A session that arrives by SET ROLE keeps
// the settings of the role it CONNECTED as, so current_setting reports what the
// session was given rather than what the role holds. A control reading
// current_setting would therefore be asking the session about itself: it would
// pass while the declaration was absent, as long as the connecting role
// happened to carry a value, and fail while the declaration was present, if the
// test connected as somebody else.
//
// SO IT READS pg_roles.rolconfig, which is the durable declaration rather than
// the session's inherited copy. Same rule as asking has_column_privilege as the
// role rather than naming it from an owner connection: THE SESSION IS THE
// EASIER THING TO ASK AND IT ANSWERS A QUESTION ABOUT ITSELF.

import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
afterAll(async () => {
  await sql.end();
});

describe("marginsheet_sync carries a statement timeout", () => {
  it("declares one in rolconfig, which is what a login applies", async () => {
    const [row] = await sql<{ config: string[] | null }[]>`
      select rolconfig as config from pg_roles where rolname = 'marginsheet_sync'
    `;
    expect(row, "the sync role does not exist").toBeDefined();
    const settings = row.config ?? [];
    const timeout = settings.find((s) => s.startsWith("statement_timeout="));
    expect(
      timeout,
      `marginsheet_sync declares no statement_timeout, so a hung query inside a locked sync is unbounded and holds the household's chain lock for as long as it hangs. rolconfig currently holds: ${settings.join(", ") || "nothing"}`,
    ).toBeDefined();
  });

  it("bounds it at 30s rather than at some value", async () => {
    // A control that accepted any value would pass against a timeout of a day,
    // which is the shape of a bound that exists and bounds nothing.
    const [row] = await sql<{ config: string[] | null }[]>`
      select rolconfig as config from pg_roles where rolname = 'marginsheet_sync'
    `;
    const timeout = (row.config ?? []).find((s) => s.startsWith("statement_timeout="));
    expect(timeout).toBe("statement_timeout=30s");
  });

  it("does not apply it to marginsheet_app, which was not measured", async () => {
    // Direction 2, and it is not ceremonial: a migration that set this on every
    // role would satisfy both assertions above while making a decision nobody
    // took. The app role serves household requests, where a hung query holds a
    // request rather than a lock, and it wants its own value against its own
    // figures.
    const [row] = await sql<{ config: string[] | null }[]>`
      select rolconfig as config from pg_roles where rolname = 'marginsheet_app'
    `;
    const timeout = (row.config ?? []).find((s) => s.startsWith("statement_timeout="));
    expect(
      timeout,
      "marginsheet_app acquired a statement_timeout it was never measured for",
    ).toBeUndefined();
  });
});
