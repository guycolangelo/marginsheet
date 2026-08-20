// What the sync Worker touches, against what marginsheet_sync actually holds.
//
// WHY THIS EXISTS. On 20 Aug 2026 the first real production sync failed with
// "permission denied for table households". markFirstSyncCompleted writes a
// household-level milestone, migration 0023 had narrowed the role to ten
// tables, and households was not among them. Nothing anywhere compared the two.
//
// THAT IS THE THIRD INSTANCE OF ONE SHAPE IN TWO HOURS. last_cursor_at was a
// column in no migration. This was a table in no grant. Both were caught by a
// real run rather than by CI, and both passed their own suites, because
// markFirstSyncCompleted's tests pass a RECORDER as `tx`: it captures the
// statement and returns canned rows. A RECORDER PROVES A STATEMENT WAS
// CONSTRUCTED. IT PROVES NOTHING ABOUT WHETHER IT CAN EXECUTE. The code and
// the fixtures agreed with each other and both disagreed with the database.
//
// columns-the-code-writes-exist.test.ts closed the column half against
// migrations. This closes the privilege half against the CATALOG, which is the
// only thing that knows what a role actually holds. It is the class rather
// than the instance: a table, a column or a privilege the Worker reaches for
// and the role lacks fails here, whatever the next one turns out to be.
//
// WHY has_column_privilege AND NOT THE GRANT STATEMENTS. Reviewing a GRANT is
// what fooled the 15 Aug experiment recorded in column-privileges.test.ts: a
// table-level grant silently covers columns a column-level control claims to
// protect, so the migration text reads as a boundary that is not there.
// has_column_privilege is Postgres's own answer and accounts for the masking.
//
// WHAT IT ASSERTS, AND THE HALF IT CANNOT. The reach is derived by STATIC
// SCAN of the Worker's SQL literals, so it sees statements, not execution: a
// table named only in a code path nothing calls still counts. The scan is
// written to OVER-claim rather than under-claim, because an over-claim fails
// this test and sends somebody to look, while an under-claim is the silent gap
// the whole file exists to close. A control that must err errs toward refusing
// to proceed.

import { describe, it, expect, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const ROLE = "marginsheet_sync";
const SRC = join(import.meta.dirname, "..", "..", "..", "..", "services", "sync", "src");
const MIGRATIONS = join(import.meta.dirname, "..", "..", "migrations");

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
afterAll(async () => {
  await sql.end();
});

type Priv = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

/** Every column any migration creates, by table. Used to tell a column name
 *  from any other word in a statement. */
function schemaColumns(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (t: string, c: string) => {
    if (!out.has(t)) out.set(t, new Set());
    out.get(t)!.add(c);
  };
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes(".down."))) {
    const text = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of text.matchAll(/CREATE TABLE "([a-z_]+)"\s*\(([\s\S]*?)\n\);/g)) {
      for (const c of m[2].matchAll(/^\s*"([a-z_]+)"/gm)) add(m[1], c[1]);
    }
    for (const m of text.matchAll(/ALTER TABLE "([a-z_]+)"\s*ADD COLUMN "([a-z_]+)"/g)) add(m[1], m[2]);
  }
  return out;
}

/** Every template literal in the Worker's source that reads as SQL.
 *  Tag-agnostic on purpose: a statement issued through a differently named
 *  handle is still a statement the role has to be allowed to run. */
function statements(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(SRC, f), "utf8");
    for (const m of src.matchAll(/`([^`]*)`/g)) {
      const body = m[1];
      if (/\b(insert\s+into|update\s+[a-z_]+\s+set|select\b|delete\s+from)/i.test(body)) out.push(body);
    }
  }
  return out;
}

/** The (table, privilege) pairs some migration narrows for this role BY COLUMN.
 *
 *  PER PRIVILEGE, NOT PER TABLE, and that precision was paid for immediately:
 *  household_state_signals holds SELECT and INSERT at table level by 0024 and
 *  UPDATE by column by 0028, all three deliberately. A per-table notion of
 *  "narrowed" would report the two table grants as findings and teach whoever
 *  read it to stop believing this test.
 *
 *  Read from the migration text on purpose, and it is not the forbidden shape
 *  of a check reading its expectation from its subject. The SUBJECT here is the
 *  catalog, which answers what the role holds; the migrations answer only which
 *  privileges somebody INTENDED to narrow. Two different artifacts, two
 *  different questions. Nothing below takes a privilege from migration text. */
function columnScopedPairs(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes(".down."))) {
    const text = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of text.matchAll(/GRANT\s+([A-Z]+)\s*\([^)]*\)((?:\s*,\s*[A-Z]+\s*\([^)]*\))*)\s+ON\s+"?([a-z_]+)"?\s+TO\s+marginsheet_sync/gi)) {
      const privs = [m[1], ...[...m[2].matchAll(/([A-Z]+)\s*\(/gi)].map((x) => x[1])];
      for (const priv of privs) out.add(`${m[3]}:${priv.toUpperCase()}`);
    }
  }
  return out;
}

const schema = schemaColumns();
const reach = new Map<string, Map<string, Set<Priv>>>();
const need = (table: string, column: string, priv: Priv) => {
  if (!schema.get(table)?.has(column)) return;
  if (!reach.has(table)) reach.set(table, new Map());
  const cols = reach.get(table)!;
  if (!cols.has(column)) cols.set(column, new Set());
  cols.get(column)!.add(priv);
};

for (const raw of statements()) {
  // Interpolations are values, never identifiers, so they cannot name a column.
  const text = raw.replace(/\$\{[^}]*\}/g, " ? ");
  const tables = [...text.matchAll(/\b(?:from|into|update|join)\s+([a-z_]+)/gi)].map((m) => m[1]);
  const known = tables.filter((t) => schema.has(t));
  if (known.length === 0) continue;

  for (const m of text.matchAll(/insert\s+into\s+([a-z_]+)\s*\(([^)]*)\)/gi)) {
    for (const c of m[2].split(",")) need(m[1], c.trim(), "INSERT");
  }
  for (const m of text.matchAll(/\bset\s+([\s\S]*?)(?=\bwhere\b|\breturning\b|$)/gi)) {
    for (const c of m[1].matchAll(/(?:^|,)\s*([a-z_]+)\s*=/g)) {
      for (const t of known) need(t, c[1], "UPDATE");
    }
  }
  if (/\bdelete\s+from\b/i.test(text)) for (const t of known) need(t, "id", "DELETE");

  // Everything else that names a real column of a table this statement
  // touches is read at some point in the statement: a WHERE predicate, an ON
  // CONFLICT target, a RETURNING list, a select list. Attributing an ambiguous
  // name to every candidate table over-claims, which is the safe direction.
  //
  // The one exclusion: the LEFT side of an assignment is written, not read, so
  // `set updated_at = now()` is UPDATE and not SELECT. Anything on the right of
  // the `=` survives the blanking, so `set n = n + 1` still derives SELECT.
  const readable = text.replace(/\bset\s+[\s\S]*?(?=\bwhere\b|\breturning\b|$)/gi, (clause) =>
    clause.replace(/(^|,)(\s*)([a-z_]+)(\s*=)/g, (_m, lead, ws, name, tail) => lead + ws + " ".repeat(name.length) + tail),
  );
  for (const w of readable.matchAll(/[a-z_][a-z0-9_]*/gi)) {
    for (const t of known) need(t, w[0], "SELECT");
  }
}

describe("the sync Worker's reach is inside what marginsheet_sync holds", () => {
  it("derived a reach large enough to be worth checking", () => {
    // The ninth finding: assert the fixture can tell a pass from a failure
    // BEFORE measuring anything. A parser that silently matched nothing would
    // report a perfect boundary over an empty set.
    expect(reach.size, "no tables derived: the SQL scan matched nothing").toBeGreaterThanOrEqual(5);
    expect(reach.get("households")?.get("first_sync_completed_at"), "the statement this control was built for is not in the derived reach").toBeDefined();
  });

  it("holds every privilege the Worker's statements require", async () => {
    const missing: string[] = [];
    for (const [table, cols] of reach) {
      for (const [column, privs] of cols) {
        for (const priv of privs) {
          const [row] = await sql<{ allowed: boolean }[]>`
            select has_column_privilege(${ROLE}, ${table}, ${column}, ${priv}) as allowed
          `;
          if (!row.allowed) missing.push(`${priv} on ${table}.${column}`);
        }
      }
    }
    expect(
      missing,
      `${ROLE} cannot run statements the sync Worker issues. Each of these fails at runtime, on a real sync, the way households did on 20 Aug 2026:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("holds nothing beyond that on any table narrowed by column", async () => {
    // A column grant exists to withhold the rest. Two ways it stops doing that,
    // and this asserts against both.
    //
    // THE FIRST IS THE ONE THAT WOULD ACTUALLY BE WRITTEN. Widening a narrowed
    // table to a plain table grant is the cheap obvious fix, it is what both
    // people looking at the 20 Aug failure reached for first, and it silently
    // covers every column the column grant was enumerated to withhold. A check
    // that only compared column privileges would never see it, because there
    // would be no column privileges left to compare.
    //
    // The second is drift: a column added to the enumerated list over time.
    const scoped = columnScopedPairs();
    expect(scoped.size, "no privilege is narrowed by column, so this compared nothing").toBeGreaterThan(0);

    const findings: string[] = [];
    for (const pair of scoped) {
      const [table, priv] = pair.split(":") as [string, Priv];
      const cols = reach.get(table) ?? new Map<string, Set<Priv>>();
      const [t] = await sql<{ allowed: boolean }[]>`
        select has_table_privilege(${ROLE}, ${table}, ${priv}) as allowed
      `;
      if (t.allowed) {
        findings.push(`${priv} on ${table} is held at TABLE level, which covers every column the column grant enumerates`);
        continue;
      }
      for (const column of schema.get(table) ?? []) {
        const [c] = await sql<{ allowed: boolean }[]>`
          select has_column_privilege(${ROLE}, ${table}, ${column}, ${priv}) as allowed
        `;
        if (c.allowed && !cols.get(column)?.has(priv)) {
          findings.push(`${priv} on ${table}.${column} is granted and never used`);
        }
      }
    }
    expect(
      findings,
      `${ROLE} reaches more than its statements use, on a table narrowed by column precisely to stop that:\n  ${findings.join("\n  ")}`,
    ).toEqual([]);
  });

  it("cannot reach a household's income, entitlement state, address or hardship flag", async () => {
    // The doctrine's own sentence as the fixture, rather than a derived set.
    // These four are why the 20 Aug ruling was a column grant and not a table
    // grant, and naming them keeps the reason legible to whoever reads a
    // failure. The derived check above would catch a drift here too; this one
    // says what the drift would COST.
    const sensitive = ["avg_monthly_income", "entitlement_state", "address", "hardship_flag"];
    const known = schema.get("households") ?? new Set<string>();
    for (const c of sensitive) {
      expect(known.has(c), `households.${c} is not in the schema: this fixture has gone stale`).toBe(true);
      expect(reach.get("households")?.has(c), `the sync Worker now touches households.${c}, which needs a ruling rather than a grant`).toBeFalsy();
    }

    const reachable: string[] = [];
    for (const column of sensitive) {
      for (const priv of ["SELECT", "INSERT", "UPDATE"] as const) {
        const [row] = await sql<{ allowed: boolean }[]>`
          select has_column_privilege(${ROLE}, 'households', ${column}, ${priv}) as allowed
        `;
        if (row.allowed) reachable.push(`${priv} on households.${column}`);
      }
    }
    expect(
      reachable,
      `${ROLE} can reach household columns it has no business with:\n  ${reachable.join("\n  ")}`,
    ).toEqual([]);
  });
});
