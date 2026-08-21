// Every household GUC is set on a transaction handle.
//
// THE DB TEST BESIDE THIS ONE PROVES THE SEMANTICS: an is_local setting made
// outside an explicit transaction is gone before the next statement, and
// household_isolation then matches nothing while raising nothing. THIS one
// enforces the consequence across the repository, because the semantics being
// demonstrated somewhere does not stop the next call site getting it wrong.
//
// WHAT IT CHECKS AND WHAT IT CANNOT. It is a static scan, and it checks that
// the RECEIVER of every set_config call is a transaction handle rather than a
// connection. That is a convention, not a proof: a handle named tx that is not
// a transaction would satisfy it. The convention is uniform in this repo and
// the alternative is brace-matching TypeScript with a regex, which would fail
// in a way nobody could read. The pairing is deliberate: this scan catches the
// mistake, the db test explains why it matters.
//
// FOUND BY WRITING NEW CODE, WHICH IS THE PART WORTH KEEPING. Three sites had
// it wrong, and two were live: /plaid/accounts answered an empty account list
// for every household, and the invitation actor lookup refused with no_member.
// Neither raised anything, and an empty list is indistinguishable from a
// household with nothing connected.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  join(import.meta.dirname, "..", "src"),
  join(import.meta.dirname, "..", "..", "sync", "src"),
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const calls: Array<{ file: string; line: number; receiver: string }> = [];
for (const root of ROOTS) {
  for (const file of sources(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, i) => {
        // The receiver is whatever the tagged template is called on.
        const m = text.match(/(\w+)`select set_config\('marginsheet\.household_id'/);
        if (m) calls.push({ file: file.replace(/.*\/(services\/.*)/, "$1"), line: i + 1, receiver: m[1] });
      });
  }
}


/** Files that OPEN THEIR OWN CONNECTION and write. Those owe a GUC; a helper
 *  that receives a tx from its caller does not, because the caller set it.
 *
 *  THE DISTINCTION IS THE WHOLE RULE. apply-streams.ts and outbox.ts write
 *  constantly and correctly set nothing: they take a Tx and the runner that
 *  opened it declared the household. A file that calls postgres() itself has no
 *  caller to rely on. */
const writers = ROOTS.flatMap((root) =>
  sources(root)
    .map((file) => ({ file, src: readFileSync(file, "utf8") }))
    .filter(({ src }) => /\bpostgres\(/.test(src))
    .filter(({ src }) => /`[^`]*\b(update\s+[a-z_]+\s+set|insert\s+into\s+[a-z_]+|delete\s+from\s+[a-z_]+)/is.test(src))
    .map(({ file, src }) => ({
      file: file.replace(/.*\/(services\/.*)/, "$1"),
      setsGuc: /select set_config\('marginsheet\.household_id'/.test(src),
    }))
);

describe("the household GUC is always set on a transaction handle", () => {
  it("found the call sites, so this is not scanning an empty set", () => {
    // Direction 2. A regex that stopped matching would leave every assertion
    // below iterating over nothing and passing perfectly.
    expect(calls.length, "no set_config call sites found: the scan matched nothing").toBeGreaterThan(4);
  });

  it("is set at all by every file that opens a connection and writes", () => {
    // THE GAP THIS CLOSES, AND IT WAS FOUND BY BEING BITTEN. The scan above
    // reads the RECEIVER of every set_config call, so a file with NO call
    // contributes no rows and passes perfectly. disconnect.ts shipped on
    // 20 Aug 2026 with an UPDATE and no GUC, was inside the scanned roots the
    // whole time, and the scan was green.
    //
    // The failure was silent in SQL: sync_worker_read on plaid_items is
    // USING (true) so the SELECT succeeded, sync_worker_write requires the
    // household, and an unset setting made the predicate NULL. The UPDATE
    // matched nothing and raised nothing. It was visible only because the route
    // returned rows ACTUALLY updated rather than the id it was handed.
    //
    // A SCAN THAT CHECKS THE FORM OF WHAT EXISTS CANNOT SEE WHAT IS ABSENT.
    expect(writers.length, "no writing modules found: this scan matched nothing").toBeGreaterThan(2);
    const missing = writers.filter((w) => !w.setsGuc).map((w) => w.file);
    expect(
      missing,
      `these modules open their own connection and write, but never declare the household. Every write policy from migration 0026 reads current_setting, so an unset one makes the predicate NULL: the statement matches nothing and raises nothing.\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("sets it on a transaction, never on a connection", () => {
    const loose = calls.filter((c) => c.receiver !== "tx");
    expect(
      loose,
      `set_config's third argument is is_local, so a setting made outside an explicit transaction is gone before the next statement and every policy then reads an unset household. These sites set it on something that is not a transaction handle:\n  ${loose
        .map((c) => `${c.file}:${c.line} (on \`${c.receiver}\`)`)
        .join("\n  ")}`,
    ).toEqual([]);
  });
});
