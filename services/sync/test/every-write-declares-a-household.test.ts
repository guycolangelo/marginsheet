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
    findings.push({ file, sql: sql.slice(0, 100) });
  }
}

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
