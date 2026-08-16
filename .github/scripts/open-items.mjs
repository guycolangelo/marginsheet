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
