// The half no type can reach: SQL is a string.
//
// The accessors in src/balances.ts carry the rule for TypeScript callers. A
// route that writes `select fa.current_balance` never touches them, so this
// scans every package's src for the balance columns and requires each site to
// be a declared reader.
//
// SAME SHAPE AS every-write-declares-a-household AND plaid-call-sites, and
// deliberately so: a fourth scanner with its own idea of what counts as a site
// is its own drift.
//
// BOTH DIRECTIONS:
//   1. a file naming a balance column that is not a declared reader fails
//   2. a declared reader that no longer names one fails, so the list cannot rot
//   3. the scan finds files at all, so an empty walk cannot pass

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** The columns whose reach this guards, and the ONE consumer each has.
 *  Mirrors migrations 0032 and 0033, which are the authority. */
const COLUMNS = [
  "current_balance",
  "available_balance",
  "credit_limit",
  "last_statement_balance",
];

/** Files entitled to name a balance column, and why.
 *
 *  A LITERAL LIST, NOT A PATTERN. A pattern like "anything under sync/src" is
 *  a rule that admits the next file somebody adds there, which is how a
 *  boundary stops being one. Adding a reader is a diff somebody reviews. */
const DECLARED: Record<string, string> = {
  "packages/shared/src/balances.ts":
    "the accessors themselves; this module IS the one consumer per column",
  "services/sync/src/apply-balances.ts":
    "the WRITER. Writes what Plaid sends and reads nothing back.",
  "services/sync/src/exchange.ts":
    "the WRITER at first connection, same statement shape as apply-balances",
  "services/sync/src/ledger-readout-sql.ts":
    "the diagnostic readout, which reports raw per-account values to an operator and never aggregates across types",
  "packages/schema/src/schema.ts":
    "the column definitions",
  "services/sync/src/reconcile-balances.ts":
    "4.6 reconciliation, which is credit current's ONE consumer and reads depository current to VERIFY rather than to interpret. It selects the column and immediately hands it to forReconciliation, so the branded value is what the rest of the module sees. THE SCAN CAUGHT THIS FILE ON ITS FIRST RUN, which is the declaration working as designed: adding a reader is a diff somebody reviews rather than a column that was already in scope.",
};

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

const files = sources();
const naming = files
  .filter((f) => {
    const body = readFileSync(f, "utf8");
    return COLUMNS.some((c) => body.includes(c));
  })
  .map((f) => f.slice(ROOT.length + 1))
  .sort();

describe("every balance column is read through its one consumer", () => {
  it("finds source files at all", () => {
    expect(files.length, "the walk is looking in the wrong place").toBeGreaterThan(20);
  });

  it("no undeclared file names a balance column", () => {
    const undeclared = naming.filter((f) => !(f in DECLARED));
    expect(
      undeclared,
      "these files read a balance column directly. Each column has ONE consumer " +
        "(CLAUDE.md, migrations 0032 and 0033) and reading it elsewhere is the hazard: " +
        "current means money HELD on a depository account and money OWED on a card, " +
        "and available on either type has no consumer at all. Use packages/shared/src/balances.ts, " +
        "or add a reason here if this file is genuinely a writer or a diagnostic."
    ).toEqual([]);
  });

  it("every declared reader still names one, so the list cannot rot", () => {
    const stale = Object.keys(DECLARED).filter((f) => !naming.includes(f));
    expect(stale, "declared as a balance-column reader and no longer reads one").toEqual([]);
  });
});
