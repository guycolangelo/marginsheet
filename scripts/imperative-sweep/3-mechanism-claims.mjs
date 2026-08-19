// THE ACTIONABLE CUT: comments that CLAIM A MECHANISM EXISTS.
//
// The raw imperative sweep over-counts, and the reason is worth stating: most
// comments in this codebase EXPLAIN WHY a design is right, and an explanation
// is not a rule awaiting a test. "Escaped rather than trusted, because it looks
// like base64url is not a security property" is reasoning, and it is correctly
// unenforced because there is nothing to enforce.
//
// The two failures that prompted this sweep were narrower and share a shape:
//   ledgers_diverge "true FORCES the two-ledger answer shape"   forced nothing
//   no-burden-verbs written from a list, claimed to implement it, did not
//
// Both are a comment ASSERTING THAT A MECHANISM IS IN PLACE. That is the class
// that can be false. An explanation cannot be false in this way; it can only be
// wrong, which is a different problem.
import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(".sweep/classified.json", "utf8"));

// Present-tense assertions that something IS enforced, prevented or guaranteed.
const MECHANISM = new RegExp([
  /\bforces?\b/, /\bobligates?\b/, /\bguarantees?\b/, /\bensures?\b/,
  /\bis enforced\b/, /\benforced by\b/, /\benforces\b/,
  /\bcannot\b/, /\bcan never\b/, /\bmakes it impossible\b/,
  /\bthe (?:test|check|constraint|index|policy|harness|job|gate|scan|guard) (?:asserts|proves|refuses|fails|catches|requires|blocks)\b/,
  /\bfails? closed\b/, /\brefuses to\b/, /\bblocks the merge\b/,
  /\bnothing (?:can|may|else)\b/, /\bprevents?\b/,
].map((r) => r.source).join("|"), "i");

// An explanation of intent, not a claim of mechanism.
const EXPLANATORY = /\b(because|why this|the reason|so that a reader|recorded so|worth stating|for the reason)\b/i;

const claims = rows.filter((r) => MECHANISM.test(r.text));
const unheld = claims.filter((r) => r.verdict !== "ENFORCED");

console.log(`imperative blocks:            ${rows.length}`);
console.log(`MECHANISM CLAIMS:             ${claims.length}`);
console.log(`  of those, ENFORCED:         ${claims.filter(r=>r.verdict==="ENFORCED").length}`);
console.log(`  of those, UNKNOWN:          ${claims.filter(r=>r.verdict==="UNKNOWN").length}`);
console.log(`  of those, ADVISORY:         ${claims.filter(r=>r.verdict==="ADVISORY").length}`);
writeFileSync(".sweep/mechanism-claims.json", JSON.stringify(unheld, null, 2));

console.log(`\nNOT ENFORCED, by file (${unheld.length} claims):`);
const byFile = {};
for (const r of unheld) (byFile[r.file] ??= []).push(r);
for (const [f, rs] of Object.entries(byFile).sort((a,b)=>b[1].length-a[1].length).slice(0, 14))
  console.log(`  ${String(rs.length).padStart(2)}  ${f}`);
