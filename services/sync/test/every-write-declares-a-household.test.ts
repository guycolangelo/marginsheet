// Every write in the sync Worker declares a household. Step 4c-i.
//
// WHY THIS EXISTS BEFORE THE POLICY. Task 4c narrows `sync_worker_access` from
// `USING (true)` to a predicate on the declared household. Under that policy a
// write from a transaction that never set `marginsheet.household_id` is
// REFUSED. That is fail-closed and correct, and it means the policy would take
// the sync Worker down for any path nobody remembered to declare.
//
// So this lands FIRST, on its own, and changes no behaviour: setting the GUC
// does nothing while the policy is still `USING (true)`. Then the policy is the
// only variable when something breaks (Guy, 19 Aug 2026).
//
// WHAT IT ASSERTS, AND WHAT IT CANNOT. It is a SOURCE SCAN, not a database
// test. It proves each write statement either names a household column itself
// or sits in a file that sets the GUC. It does NOT prove the GUC is set on the
// same transaction as the write, because that is a runtime property and a
// static scan cannot see it. The database-level proof is 4c-iii's negative
// controls, which is why those exist and this is not sufficient on its own.
//
// BOTH DIRECTIONS, same shape as plaid-call-sites:
//   1. no write statement lacks a household
//   2. THE SCAN ACTUALLY FINDS WRITES, so a refactor cannot empty it silently

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));

/** A tagged SQL template's body, normalised. Nested `${}` may contain braces
 *  but not backticks in this codebase, which is what makes this tractable. */
function sqlTemplates(source: string): string[] {
  const out: string[] = [];
  const re = /\b(?:tx|sql)`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1].replace(/\s+/g, " ").trim());
  return out;
}

const WRITE = /^(insert\s+into|update|delete\s+from)\b/i;
/** Names a household, either as the scoping column or as `households.id`. */
const NAMES_HOUSEHOLD = /household_id|\bupdate\s+households\b/i;

/** Tables with NO household dimension to name, so a write to one cannot declare
 *  a household and is not evading anything.
 *
 *  DECLARED AND THEN VERIFIED AGAINST THE MIGRATIONS, because an exemption
 *  asserted in a test is a claim the test also makes: the check below reads
 *  every migration and refuses if the table turns out to have a household_id
 *  after all. A list somebody can add to freely is a suppression. */
const HOUSEHOLDLESS_TABLES: Record<string, string> = {
  sweep_runs:
    "the watchdog's own trace, written once per sweep across all households. It holds two counts and a timestamp, so there is no household to name, and 0044's policy says true because there is nothing to compare rather than because the boundary was forgotten.",
};

const WRITES_HOUSEHOLDLESS = new RegExp(
  `^(?:insert\\s+into|update|delete\\s+from)\\s+"?(?:${Object.keys(HOUSEHOLDLESS_TABLES).join("|")})"?\\b`,
  "i"
);

interface Finding { file: string; sql: string }
const findings: Finding[] = [];
let writesSeen = 0;

for (const file of files) {
  const source = readFileSync(join(SRC, file), "utf8");
  const setsGuc = /set_config\('marginsheet\.household_id'/.test(source);
  for (const sql of sqlTemplates(source)) {
    if (!WRITE.test(sql)) continue;
    writesSeen += 1;
    if (NAMES_HOUSEHOLD.test(sql) || setsGuc) continue;
    if (WRITES_HOUSEHOLDLESS.test(sql)) continue;
    findings.push({ file, sql: sql.slice(0, 100) });
  }
}

describe("the householdless exemption is true, not merely claimed", () => {
  const MIGRATIONS = join(SRC, "..", "..", "..", "packages", "schema", "migrations");

  for (const [table, reason] of Object.entries(HOUSEHOLDLESS_TABLES)) {
    it(`${table} really has no household_id column`, () => {
      expect(reason, `${table} is exempt and gives no reason`).toBeTruthy();

      // THE CREATE STATEMENT IS READ RATHER THAN TRUSTED. An exemption is a
      // claim about the schema, and a test that only records the claim is the
      // weakest form of a rule. If somebody later adds household_id to this
      // table, the exemption becomes an evasion and this goes red.
      const created = readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
        .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
        .find((body) => new RegExp(`CREATE TABLE "${table}"`, "i").test(body));

      expect(created, `no migration creates ${table}, so the exemption names nothing`).toBeTruthy();
      const block = created!.slice(created!.indexOf(`CREATE TABLE "${table}"`));
      const body = block.slice(0, block.indexOf(");"));
      expect(
        /household_id/i.test(body),
        `${table} HAS a household_id column, so a write to it can and must name one. Remove the exemption.`
      ).toBe(false);
    });
  }
});

describe("every sync write declares a household", () => {
  it("no write statement is unscoped", () => {
    expect(
      findings,
      "A write in the sync Worker neither names a household nor sits in a file\n" +
        "that declares one. Under 4c's policy this write is REFUSED, so the Worker\n" +
        "breaks in production rather than here.\n\n" +
        findings.map((f) => `  ${f.file}\n    ${f.sql}`).join("\n")
    ).toEqual([]);
  });

  it("the scan actually finds writes", () => {
    // DIRECTION 2. Without it, a refactor that moves SQL into a helper or
    // changes the tag name leaves this scanning nothing and passing perfectly,
    // which is the degenerate-coverage failure rather than a control failure.
    expect(writesSeen, "the scan found no write statements; its matcher is stale").toBeGreaterThan(4);
  });

  it("names the write path that does not exist yet", () => {
    // THE FIFTH PATH, AND IT IS A HOLE RATHER THAN A STATEMENT. runTransactionsSync
    // takes `persistInFlight` as an injected callback, so the cursor write lives
    // in a caller that HAS NOT BEEN WRITTEN. A scan cannot find a statement that
    // is not there, and 4c's policy would find it by refusing it in production.
    //
    // So the requirement is attached here, where whoever wires it will be
    // running this suite: the cursor write targets plaid_items, which carries
    // household_id, and its transaction must declare the household.
    const source = readFileSync(join(SRC, "transactions-sync.ts"), "utf8");
    expect(
      source,
      "PersistCursor was removed or renamed. If the cursor write is now inline, " +
        "it must name a household and this test should be replaced by the scan above."
    ).toMatch(/export type PersistCursor/);
  });
});
