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

describe("the household GUC is always set on a transaction handle", () => {
  it("found the call sites, so this is not scanning an empty set", () => {
    // Direction 2. A regex that stopped matching would leave every assertion
    // below iterating over nothing and passing perfectly.
    expect(calls.length, "no set_config call sites found: the scan matched nothing").toBeGreaterThan(4);
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
