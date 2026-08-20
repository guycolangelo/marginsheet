// Prints the open items, and fails when one is not accountable.
//
// CLAUDE.md has said since M0 that "open items travel with named owners and
// print in CI". Nothing implemented it. On 16 Aug 2026 an open item needed
// recording "like the others" and there were no others: the practice was
// documented and unenforced, which is the same shape as the ci.yml comment
// warning against rotating the role on a long-lived branch, and the workflow
// header that described a required reviewer which did not exist.
//
// WHAT THIS FAILS ON, and what it deliberately does not. It does NOT fail
// because open items exist; they are legitimate and hiding them would be the
// point of the exercise inverted. It fails when an item has no owner, no thing
// it is owed to, or no date, because an item nobody owns is not tracked, it is
// merely written down. That is the difference this job exists to enforce.
//
// The output goes to the job summary so it is read without opening logs.

import { readFileSync, appendFileSync } from "node:fs";

const PATH = "docs/open-items.json";
const REQUIRED = ["id", "item", "owner", "owed_to", "raised"];

/** THE ONLY TWO OWNERS. AN ENUM, NOT A PRESENCE TEST.
 *
 *  A non-empty string check passed on `owner: "closed by ruling"`, which is a
 *  STATUS in the owner field, and on `owner: "M7, 3.5 and M8 respectively"`,
 *  which is THREE obligations pretending to be one: nobody owes it, and the
 *  check could not fail on either row.
 *
 *  An item is a thing somebody owes. A module is not somebody, so modules live
 *  in the trigger where they already belonged, and a decision belongs in the
 *  decision record rather than here. Guy, 19 Aug 2026. */
const OWNERS = ["Guy", "build"];

/** Accepts "Guy", "build", and a qualified form like
 *  "build, gated on Guy's approval of the plan", which still names one party as
 *  responsible. Rejects anything whose first word is not an owner. */
function ownerIsAPerson(value) {
  const first = String(value).trim().split(/[\s,(]/)[0];
  return OWNERS.includes(first);
}

let items;
try {
  items = JSON.parse(readFileSync(PATH, "utf8"));
} catch (error) {
  console.error(`Could not read ${PATH}: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(items)) {
  console.error(`${PATH} must be an array.`);
  process.exit(1);
}

const problems = [];
const seen = new Set();

for (const [index, entry] of items.entries()) {
  const where = entry?.id ? `"${entry.id}"` : `entry ${index}`;
  for (const field of REQUIRED) {
    const value = entry?.[field];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`${where} is missing "${field}". An item nobody owns is not tracked.`);
    }
  }
  if (typeof entry?.owner === "string" && entry.owner.trim() !== "" && !ownerIsAPerson(entry.owner)) {
    problems.push(
      `${where} has owner="${entry.owner}", which is not one of ${OWNERS.join(" or ")}. ` +
        `A module is not somebody: put it in the trigger. A status is not an owner: ` +
        `put the decision in the decision record.`
    );
  }
  if (entry?.id) {
    if (seen.has(entry.id)) problems.push(`duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }
  if (typeof entry?.raised === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(entry.raised)) {
    problems.push(`${where} has raised="${entry.raised}", which is not YYYY-MM-DD.`);
  }
}

const lines = [
  `## Open items (${items.length})`,
  "",
  "Carried deliberately. Each names an owner and what it is owed to.",
  "",
  "| Item | Owner | Owed to | Raised |",
  "| --- | --- | --- | --- |",
  ...items.map(
    (e) =>
      `| **${e?.id ?? "?"}**<br>${String(e?.item ?? "").replace(/\|/g, "\\|")} | ${e?.owner ?? "?"} | ${e?.owed_to ?? "?"} | ${e?.raised ?? "?"} |`
  ),
];

const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

if (problems.length > 0) {
  console.error("\nOpen items that are not accountable:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`\nAll ${items.length} open items name an owner and what they are owed to.`);
