// The database half of /health, proven against a real database.
//
// WHY THIS EXISTS: /health reported {service, environment, build} and nothing
// else. It proved the Worker had booted and the edge served the right commit,
// and it returned green for ten merged PRs against three Neon branches that
// held zero tables. The check was not weak, it was misleading: it converted an
// outage into a silence.
//
// A health check is only worth something if it can go red. Most of this file
// is the proof that it does.

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSchemaHealth } from "@marginsheet/shared/db";

const DATABASE_URL = process.env.DATABASE_URL!;

// The same Neon branch's other database. Neon creates `neondb` alongside
// `marginsheet` on every branch and no migration ever touches it, so it is a
// real, reachable, correctly-credentialed database with no schema: exactly the
// state all three long-lived branches were in on 15 Aug 2026.
function emptyDatabaseUrl(): string {
  const u = new URL(DATABASE_URL);
  u.pathname = "/neondb";
  return u.toString();
}

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "migrations");

function migrationFileCount(): number {
  return readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith(".sql") && !f.endsWith(".down.sql")
  ).length;
}

describe("schema health against a migrated database", () => {
  it("reports ok, and a migration count matching the files in this commit", async () => {
    const health = await readSchemaHealth(DATABASE_URL);

    expect(health.ok, `health failed: ${health.error}`).toBe(true);
    // The assertion that ties the database to the code. A Worker built against
    // eleven migrations talking to a database holding ten is the failure this
    // whole change exists to make loud.
    expect(health.migrations).toBe(migrationFileCount());
    expect(health.tables).toBeGreaterThan(30);
    expect(health.error).toBeUndefined();
  });

  it("runs a real query against a real table, not select 1", async () => {
    // households is read by readSchemaHealth and its value discarded. If the
    // implementation were reduced to `select 1`, an empty database would pass,
    // which is precisely what the test below forbids. This asserts the source
    // still names a domain table.
    const src = readdirSync(join(import.meta.dirname, "..", "..", "..", "shared", "src"));
    expect(src).toContain("db.ts");
    const contents = await import("node:fs").then((fs) =>
      fs.readFileSync(join(import.meta.dirname, "..", "..", "..", "shared", "src", "db.ts"), "utf8")
    );
    expect(contents).toContain("from households");
  });

  it("never reports the households count, which is a business fact", async () => {
    const health = await readSchemaHealth(DATABASE_URL);
    expect(Object.keys(health).sort()).toEqual(["migrations", "ok", "tables"]);
  });
});

describe("NEGATIVE CONTROL: an empty database must fail the check", () => {
  it("returns ok=false against a reachable database with no schema", async () => {
    // Reachable, correctly credentialed, and empty. `select 1` would pass here.
    const health = await readSchemaHealth(emptyDatabaseUrl());

    expect(health.ok, "an empty database passed the health check").toBe(false);
    expect(health.migrations).toBeNull();
    expect(health.tables).toBeNull();
    expect(health.error).toBeTruthy();
  });

  it("returns ok=false against an unreachable database", async () => {
    const u = new URL(DATABASE_URL);
    u.hostname = "ep-does-not-exist-00000000.us-east-1.aws.neon.tech";
    const health = await readSchemaHealth(u.toString());
    expect(health.ok).toBe(false);
  });

  it("scrubs anything connection-shaped out of the error it reports", async () => {
    // /health is unauthenticated, and a Postgres error can carry a host or a
    // database name in its text.
    const u = new URL(DATABASE_URL);
    u.hostname = "ep-secret-host-12345678.us-east-1.aws.neon.tech";
    const health = await readSchemaHealth(u.toString());

    expect(health.ok).toBe(false);
    expect(health.error).not.toContain("ep-secret-host-12345678");
    expect(health.error).not.toContain("postgresql://");
    expect(health.error!.length).toBeLessThanOrEqual(200);
  });
});
