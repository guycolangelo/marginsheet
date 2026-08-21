// WHO WRITES THIS COLUMN? Nothing in this repository could answer that, and a
// comment had been asserting an answer since 0004.
//
// THE SHAPE, NAMED BY GUY ON 21 AUG 2026. A comment asserting singularity is
// NOT CHECKABLE BY READING EITHER WRITER. Reading the named source tells you
// what it does; reading the actual writer tells you what IT does; neither
// contains the claim that there is only one. The claim is about a RELATIONSHIP
// BETWEEN FILES and no file holds it.
//
// THE INSTANCE. transaction_direction's comment has said since 0004 that
// `resolveDirection` is THE SINGLE SOURCE OF TRUTH for the stored value.
// resolveDirection exists in the spec and in three migration comments and in NO
// CODE. apply-streams.ts writes the column with its own sign rule. So the named
// source was not a writer, the actual writer was not named, and the sentence
// was false for four migrations.
//
// AND COUNTING ALONE WOULD NOT HAVE CAUGHT IT, which sharpens the rule rather
// than restating it. There was exactly ONE writer. A cardinality check reads
// 1, agrees with "single source", and passes. THE FAILURE WAS CARDINALITY ONE
// WITH THE WRONG MEMBER, so the check has to be on the IDENTITY of the writer
// set and not its size. That is the difference between "how many" and "which",
// which this codebase has already paid for once in the Plaid cross-check.
//
// WHY A CONTROL RATHER THAN A NOTE. The finding is that a comment cannot carry
// a singularity claim. Recording it as a comment would repeat the failure it
// describes, in the same repository, about the same class of claim.
//
// BOTH DIRECTIONS, so the declaration cannot rot:
//   1. a writer nobody declared is a failure
//   2. a declared writer that no longer writes is a failure
//   3. the scan actually finds writes, so a refactor cannot empty it silently

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const declaration = JSON.parse(
  readFileSync(join(ROOT, "config", "single-writer-columns.json"), "utf8")
) as {
  columns: Array<{
    table: string;
    column: string;
    declared_writers: string[];
    claimed_writer: string;
    claim_holds: boolean;
    reason?: string | null;
  }>;
};

/** Every .ts source file under any package's or service's src/. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
    }
  };
  for (const group of ["services", "packages", "apps"]) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const pkg of readdirSync(base)) walk(join(base, pkg, "src"));
  }
  return out;
}

/** A tagged SQL template's body, normalised. Same extraction as
 *  every-write-declares-a-household, deliberately: two scanners disagreeing
 *  about what counts as a statement is its own drift. */
function sqlTemplates(source: string): string[] {
  const out: string[] = [];
  const re = /\b(?:tx|sql)`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1].replace(/\s+/g, " ").trim());
  return out;
}

/** Does this statement WRITE `column` on `table`?
 *
 *  Deliberately generous about the statement and strict about the pair: an
 *  insert naming the column in its column list, or an update to that table
 *  whose SET clause names it. A scanner that missed a write would make this
 *  control fail open, which is the direction that ships a second writer. */
function writesColumn(sql: string, table: string, column: string): boolean {
  const lower = sql.toLowerCase();
  const col = column.toLowerCase();
  const tbl = table.toLowerCase();

  const insert = new RegExp(`insert\\s+into\\s+"?${tbl}"?\\s*\\(([^)]*)\\)`, "i").exec(lower);
  if (insert && insert[1].split(",").some((c) => c.trim().replace(/"/g, "") === col)) return true;

  if (new RegExp(`^update\\s+"?${tbl}"?\\b`, "i").test(lower)) {
    const set = lower.slice(lower.indexOf(" set "));
    if (new RegExp(`[\\s,("]${col}\\s*=`, "i").test(set)) return true;
    // `insert ... on conflict do update set col = excluded.col` is an update to
    // this table too, and it is how apply-streams writes. Caught by the insert
    // branch above, but an UPDATE-only path must not slip through on spacing.
  }
  if (new RegExp(`on\\s+conflict[\\s\\S]*?\\bset\\b[\\s\\S]*?[\\s,]${col}\\s*=`, "i").test(lower)
      && new RegExp(`insert\\s+into\\s+"?${tbl}"?`, "i").test(lower)) return true;
  return false;
}

const files = sources();

describe("who writes this column", () => {
  it("finds source files at all, so an empty scan cannot pass", () => {
    expect(files.length, "no .ts sources found: the walk is looking in the wrong place").toBeGreaterThan(20);
  });

  for (const spec of declaration.columns) {
    const label = `${spec.table}.${spec.column}`;

    const actual = files
      .filter((f) => sqlTemplates(readFileSync(f, "utf8")).some((s) => writesColumn(s, spec.table, spec.column)))
      .map((f) => f.slice(ROOT.length + 1))
      .sort();

    it(`${label}: the writers are exactly the declared ones`, () => {
      const declared = [...spec.declared_writers].sort();

      // BOTH DIRECTIONS IN ONE ASSERTION. A set comparison catches an
      // undeclared writer appearing AND a declared writer that stopped
      // writing, and the second is what stops this file rotting into fiction.
      expect(
        actual,
        `writers of ${label} disagree with config/single-writer-columns.json. ` +
          `A new writer here is a second source of truth for a value something claims has one.`
      ).toEqual(declared);
    });

    it(`${label}: the scan actually located a write, unless none is declared`, () => {
      // WITHOUT THIS, a change to the SQL extraction empties `actual`, and an
      // empty set equals an empty declaration, so the control passes while
      // seeing nothing.
      //
      // ZERO DECLARED WRITERS IS A LEGITIMATE STATE AND NOT AN EXEMPTION FROM
      // THE CHECK. transactions.direction has none as of 0035, because it is
      // M5's filing and M5 does not exist. The set comparison above still runs
      // and still catches a writer appearing. What is suspended is only the
      // non-empty requirement, and only where the declaration says so, so a
      // scanner that silently stopped seeing writes still reddens on every
      // column that HAS one.
      if (spec.declared_writers.length === 0) {
        expect(actual, `${label} declares no writers but something writes it`).toEqual([]);
        return;
      }
      expect(actual.length, `no write to ${label} was found anywhere; the scanner has stopped seeing it`).toBeGreaterThan(0);
    });

    it(`${label}: claim_holds is not asserted while the named source is absent`, () => {
      // THE FORCING FIELD. claim_holds true OBLIGATES the declared writers to
      // be the claimed one. False is legitimate and must carry a reason, so a
      // known-false claim is recorded data rather than an unexamined comment.
      if (spec.claim_holds) {
        expect(
          actual.some((f) => readFileSync(join(ROOT, f), "utf8").includes(spec.claimed_writer)),
          `claim_holds is true for ${label} but no writer mentions ${spec.claimed_writer}`
        ).toBe(true);
      } else {
        expect(spec.reason, `claim_holds is false for ${label} and carries no reason`).toBeTruthy();
      }
    });
  }
});
