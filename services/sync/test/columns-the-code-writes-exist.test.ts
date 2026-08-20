// Every column the sync Worker writes exists in a migration.
//
// WHY THIS EXISTS. On 20 Aug 2026 the first real sync failed with "column
// last_cursor_at of relation plaid_items does not exist". The column was in no
// migration and never had been. It is read by the watchdog through
// sweepReason(), whose tests construct an ItemSyncState BY HAND, so no test
// ever read the value from a database: THE CODE AND THE FIXTURES AGREED WITH
// EACH OTHER AND BOTH DISAGREED WITH THE SCHEMA.
//
// That is the third instance of something passing its own tests while being
// unable to run, and the first two were caught the same way: by trying to use
// them. This is the cheap version of trying.
//
// WHAT IT ASSERTS AND WHAT IT CANNOT. It reads column names out of the
// migration text and out of SQL literals in the Worker's source. It is a
// STATIC scan: it proves a name appears in a CREATE TABLE or ADD COLUMN
// somewhere, not that the migration applied, and not that the type is right.
// A schema built from these migrations is what CI provisions, so a name
// present here is a name a real database has.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "schema", "migrations");
const SRC = join(import.meta.dirname, "..", "src");

/** Every column name any migration creates, by table. */
function columnsByTable(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    if (!out.has(table)) out.set(table, new Set());
    out.get(table)!.add(col);
  };
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes(".down."))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE "([a-z_]+)"\s*\(([\s\S]*?)\n\);/g)) {
      for (const c of m[2].matchAll(/^\s*"([a-z_]+)"/gm)) add(m[1], c[1]);
    }
    for (const m of sql.matchAll(/ALTER TABLE "([a-z_]+)"\s*ADD COLUMN "([a-z_]+)"/g)) add(m[1], m[2]);
  }
  return out;
}

/** Columns the Worker WRITES, read from `set x =` and insert column lists. */
function writesByTable(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    if (!out.has(table)) out.set(table, new Set());
    out.get(table)!.add(col);
  };
  for (const file of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(SRC, file), "utf8");
    for (const m of src.matchAll(/update\s+([a-z_]+)\s+set\s+([\s\S]*?)\s+where/gi)) {
      for (const c of m[2].matchAll(/(?:^|,)\s*([a-z_]+)\s*=/g)) add(m[1], c[1]);
    }
    for (const m of src.matchAll(/insert\s+into\s+([a-z_]+)\s*\(([^)]*)\)/gi)) {
      for (const c of m[2].split(",")) {
        const name = c.trim();
        if (/^[a-z_]+$/.test(name)) add(m[1], name);
      }
    }
  }
  return out;
}

const columns = columnsByTable();
const writes = writesByTable();

describe("every column the sync Worker writes exists in a migration", () => {
  const missing: string[] = [];
  for (const [table, cols] of writes) {
    const known = columns.get(table);
    if (!known) continue; // a table no migration creates is a different finding
    for (const col of cols) if (!known.has(col)) missing.push(`${table}.${col}`);
  }

  it("names no column the schema does not have", () => {
    expect(
      missing,
      "The sync Worker writes a column no migration creates. It will fail on the\n" +
        "first statement that reaches it, which is the first REAL sync rather than\n" +
        "any test, because unit tests construct their state by hand.\n\n  " +
        missing.join("\n  ")
    ).toEqual([]);
  });

  it("actually found columns and writes, so it cannot pass by scanning nothing", () => {
    // DIRECTION 2. A regex that stops matching leaves this comparing two empty
    // sets and passing perfectly, which is the degenerate-coverage failure the
    // whole register exists to notice.
    expect(columns.get("plaid_items")?.size ?? 0, "no plaid_items columns parsed").toBeGreaterThan(8);
    expect(writes.get("plaid_items")?.size ?? 0, "no plaid_items writes parsed").toBeGreaterThan(2);
    expect(writes.get("transactions")?.size ?? 0, "no transactions writes parsed").toBeGreaterThan(5);
  });

  it("includes the column whose absence caused this", () => {
    expect(columns.get("plaid_items")).toContain("last_cursor_at");
  });
});
