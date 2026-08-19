// A COMMENT ASSERTING A MECHANISM NAMES ITS ENFORCEMENT, OR IT IS DESCRIPTION.
//
// WHY THIS EXISTS, AND WHY IT COMES BEFORE ANY CLEANUP.
//
// This project records rulings in comments. That method works when a control
// enforces the comment and FAILS SILENTLY when none does, which is how 126
// mechanism claims accumulated with nothing found holding them up
// (docs/imperative-inventory.md). Two were checked by hand and both were false:
// `ledgers_diverge` said FORCES and forced nothing, and `HeraldHeadlineFacts`
// claimed a subset BY CONSTRUCTION between two unrelated interfaces.
//
// Cleanup on a pile that is still growing is not worth starting. This stops the
// pile growing. Everything else is cleanup.
//
// THE RULE. A comment may assert that a mechanism is in place only if the same
// block names what enforces it. Otherwise it is rewritten as description.
//
//   asserting:  "true FORCES the two-ledger answer shape"
//   naming:     "true forces the two-ledger shape. Enforced by
//                forcing-fields.test.ts."
//   describing: "true means the answer covers both ledgers."
//
// The third is not a lesser option. Most comments here explain WHY a design is
// right, and an explanation cannot be false in this way. Downgrading an
// over-claim to description is a real fix, not a dodge.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Present-tense assertions that something IS enforced, prevented or guaranteed. */
export const MECHANISM_CLAIM = new RegExp(
  [
    /\bforces?\b/, /\bobligates?\b/, /\bguarantees?\b/,
    /\bis enforced\b/, /\benforces\b/,
    /\bcan never\b/, /\bmakes it impossible\b/,
    /\bby construction\b/,
    /\b(?:the|this) (?:test|check|constraint|index|policy|harness|gate|scan|guard) (?:asserts|proves|refuses|catches|blocks)\b/,
    /\bblocks the merge\b/, /\bnothing (?:can|may) \w+\b/,
  ].map((r) => r.source).join("|"),
  "i"
);

/** A comment that DISCLAIMS enforcement is doing exactly what this rule asks.
 *
 * "NOT ENFORCED: a compose-time obligation with no field to check, owed to
 * M13" contains the vocabulary while asserting the opposite, and an earlier
 * version of this rule fired on it. Punishing the honest form is how a rule
 * gets routed around: the author's options become lie, stay silent, or fight
 * the linter, and the first two are worse than the claim.
 *
 * Found by the rule firing on its own author's rewrites, minutes after the
 * rewrites were made to satisfy it. */
export const DISCLAIMS_ENFORCEMENT = new RegExp(
  [
    /\bnot enforced\b/, /\bunenforced\b/, /\bnothing enforces\b/,
    /\bdescribed,? not asserted\b/, /\bowed to\b/,
    /\bcannot be (?:checked|enforced|tested)\b/,
  ].map((r) => r.source).join("|"),
  "i"
);

/** Evidence, in the same block, of what holds the claim up. */
export const NAMES_ENFORCEMENT = new RegExp(
  [
    /enforced by/i,
    /\b[\w.-]+\.(?:test|spec)\.ts\b/,           // a named test file
    /\bcontrol register\b/i,
    /\bplanted failure\b/i,
    /\bCHECK constraint\b/i, /\bunique index\b/i, /\bcolumn grant\b/i,
    /\bthe type (?:system|admits|forbids)\b/i,  // carried by the type
    /\bmigration \d{4}\b/i,
    /\bCI (?:job|fails|refuses)\b/i,
    /\bno-[a-z][a-z-]{4,}\b/,                  // a named lint rule id
    /\bbinds to the \S+ context\b/i,
  ].map((r) => r.source).join("|"),
  // "i" IS ON THE COMBINED PATTERN, NOT THE PARTS. `.source` drops per-regex
  // flags silently, so the /i on each fragment above is decorative: without
  // this the whole thing is case sensitive and "Enforced by" never matches
  // "enforced by". Found by a fixture, not by reading, which is the same
  // lesson as the eleven inflection gaps.
  "i"
);

export interface ClaimBlock {
  file: string;
  line: number;
  text: string;
  /** The lines immediately after the block, so a SQL claim can be checked
   *  against the DDL it sits above rather than only against its own words. */
  follows: string;
  /** Stable across line moves: the file plus the claim's opening words. */
  key: string;
}

const EXT = [".ts", ".tsx", ".mjs", ".js", ".sql"];
const SKIP = new Set(["node_modules", "dist", "coverage", "imperative-sweep"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXT.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Contiguous comment lines, joined into one claim. */
export function commentBlocks(root: string, trees: string[]): ClaimBlock[] {
  const blocks: ClaimBlock[] = [];
  for (const tree of trees) {
    for (const file of walk(join(root, tree))) {
      const rel = relative(root, file);
      const lines = readFileSync(file, "utf8").split("\n");
      let cur: { line: number; text: string } | null = null;
      let i = 0;
      let inBlock = false;
      const flush = () => {
        if (cur) {
          const text = cur.text.replace(/\s+/g, " ").trim();
          // The key ignores line numbers, which drift on every edit above.
          const endLine = i;
          blocks.push({
            file: rel,
            line: cur.line,
            text,
            follows: lines.slice(endLine, endLine + 25).join("\n"),
            key: `${rel}::${text.slice(0, 80)}`,
          });
        }
        cur = null;
      };
      for (i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        let isComment = false;
        if (inBlock) { isComment = true; if (t.includes("*/")) inBlock = false; }
        else if (t.startsWith("/*")) { isComment = true; if (!t.includes("*/")) inBlock = true; }
        else if (t.startsWith("//") || t.startsWith("*") || t.startsWith("--")) isComment = true;
        if (isComment) {
          const clean = t.replace(/^[/*\-]+\s?/, "").replace(/\s*\*\/\s*$/, "").trim();
          if (!cur) cur = { line: i + 1, text: clean };
          else cur.text += " " + clean;
        } else flush();
      }
      flush();
    }
  }
  return blocks;
}

/** Files whose comments are exempt, and the reason for each.
 *
 * The lint package itself, for the same reason it is absent from its own
 * repo-scan: this module must contain the vocabulary to define it.
 *
 * Test files, because a claim in a test sits beside its own assertion. The
 * exemption is about WHERE the claim lives, not about it being less of a
 * claim. */
function exempt(file: string): boolean {
  if (file.startsWith("packages/lint/")) return true;
  if (file.includes("/test/") || file.endsWith(".test.ts")) return true;
  return false;
}

/** A SQL comment sitting directly above the DDL that enforces it.
 *
 * PREDICTED, THEN TESTED. Four migration claims were in the first baseline and
 * all four were false positives: 0022's comment argues for a constraint and the
 * CHECK is sixteen lines below it, already carried in the control register. The
 * detector was reading the comment and stopping at the blank line.
 *
 * Requiring "Enforced by the CHECK constraint below" would be asking an author
 * to describe what is already visible one line down, which is the kind of
 * ceremony that makes a rule feel like an obstacle. */
function backedByAdjacentDdl(b: ClaimBlock): boolean {
  if (!b.file.endsWith(".sql")) return false;
  return /\b(CHECK|UNIQUE INDEX|CONSTRAINT|GRANT|REVOKE|POLICY|FORCE ROW LEVEL|NOT NULL|REFERENCES)\b/i
    .test(b.follows);
}

/** Blocks that assert a mechanism and do not name what enforces it. */
export function unbackedClaims(root: string, trees: string[]): ClaimBlock[] {
  return commentBlocks(root, trees).filter(
    (b) =>
      !exempt(b.file) &&
      MECHANISM_CLAIM.test(b.text) &&
      !NAMES_ENFORCEMENT.test(b.text) &&
      !DISCLAIMS_ENFORCEMENT.test(b.text) &&
      !backedByAdjacentDdl(b)
  );
}
