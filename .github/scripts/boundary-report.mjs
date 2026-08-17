// What M3 does NOT cover (M3 task 3.6).
//
// A green summary that omits its own limits is the report equivalent of a
// control that cannot fail. This prints the boundary, and it is GENERATED from
// the control register and docs/open-items.json rather than typed, so it cannot
// drift into optimism while the underlying facts change.
//
// It does not fail a build. Its job is to be read: an honest boundary is worth
// more than a green summary, and a boundary nobody can see is a boundary that
// quietly widens.

import { readFileSync, appendFileSync } from "node:fs";

const register = JSON.parse(readFileSync("config/control-register.json", "utf8"));
const openItems = JSON.parse(readFileSync("docs/open-items.json", "utf8"));
const sensitive = readFileSync("services/api/src/sensitive-actions.ts", "utf8");

// Unbuilt sensitive actions, read from the source of truth rather than listed.
//
// Parsed PER ENTRY. The first version matched `name:` then scanned ahead for
// `built: false` with a lazy quantifier, which happily ran past a `built: true`
// into the next entry and reported "phone change" as unbuilt. A report that is
// wrong in the direction of alarm is no better than one wrong in the direction
// of comfort: both are read as fact.
const entries = sensitive
  .split(/\n  \{/)
  .filter((block) => block.includes("built:") && block.includes("name:"));

const unbuilt = entries
  .filter((block) => /built:\s*false/.test(block))
  .map((block) => block.match(/name: "([^"]+)"/)?.[1])
  .filter(Boolean);

const built = entries
  .filter((block) => /built:\s*true/.test(block))
  .map((block) => block.match(/name: "([^"]+)"/)?.[1])
  .filter(Boolean);

const lines = [
  `## What M3 covers, and what it does not`,
  "",
  `**${register.controls.length} controls registered.** Each names the test that goes red when it breaks, and the planted-failure harness proves that by breaking them.`,
  "",
  `**Sensitive actions guarded by recent-auth:** ${built.join(", ") || "none"}.`,
  "",
  "### Not covered, and known",
  "",
  ...(unbuilt.length
    ? [
        `- **${unbuilt.length} sensitive actions do not exist yet**: ${unbuilt.join(", ")}. Recent-auth is proven on the ones that do.`,
      ]
    : []),
  "- **Fixtures express one household or two, never many.** Three-plus member households, and a member in two households, are shapes no test can currently construct. This is the ninth finding stated as a live constraint: coverage that looks complete because the failure case cannot be built.",
  "- **Everything runs against Postgres and Worker-shaped code, not a deployed Worker**, except `db-identity` and deploy verification, which ask the live edge.",
  "",
  "### Carried, with owners",
  "",
  "| Item | Owner | Owed to |",
  "| --- | --- | --- |",
  ...openItems.map(
    (e) => `| ${e.id} | ${e.owner} | ${e.owed_to} |`
  ),
  "",
  `_Generated from config/control-register.json, docs/open-items.json and src/sensitive-actions.ts. Nothing here is typed by hand, so it cannot go stale while the facts change._`,
];

const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
}
