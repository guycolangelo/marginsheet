// Deletes ephemeral Neon branches whose reason to exist is gone.
//
// ALLOWLISTED BY NAME, NEVER BLOCKLISTED. Only `pr-<digits>` is touchable, so
// dev, staging, main and anything else nobody anticipated are unreachable from
// here by construction rather than by a list somebody has to maintain. Same
// shape as the rotation target guard and the enumerated column grants: naming
// what may be destroyed fails closed on everything else.
//
// TWO KINDS OF EPHEMERAL BRANCH, and they are aged differently:
//   pr-<n> where n is a real PR   -> deletable once that PR is closed
//   pr-98<runNumber>              -> a CI scratch branch, deletable when old
//
// The scratch form has no PR to ask about, so age is the only signal. Six
// hours is far longer than any run and short enough to keep the ceiling clear.

import { execFileSync } from "node:child_process";

const ONLY = (process.env.ONLY ?? "").trim();
const EPHEMERAL = /^pr-(\d+)$/;
const SCRATCH_PREFIX = "98";
const MAX_SCRATCH_AGE_MS = 6 * 60 * 60 * 1000;

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

const branches = JSON.parse(
  sh("pnpm", ["exec", "neonctl", "branches", "list", "--project-id", process.env.NEON_PROJECT_ID, "--output", "json"])
);

const candidates = [];
for (const b of branches) {
  const match = EPHEMERAL.exec(b.name);
  if (!match) continue;
  if (ONLY && b.name !== ONLY) continue;
  const number = match[1];

  if (number.startsWith(SCRATCH_PREFIX)) {
    const age = Date.now() - new Date(b.created_at).getTime();
    if (age > MAX_SCRATCH_AGE_MS) {
      candidates.push({ name: b.name, why: `CI scratch branch, ${Math.round(age / 3.6e6)}h old` });
    }
    continue;
  }

  // A real PR number: ask GitHub whether it is still open. An API failure must
  // NOT read as "closed", or a rate limit would delete live branches, so the
  // unknown case is skipped rather than swept.
  let state;
  try {
    state = JSON.parse(sh("gh", ["pr", "view", number, "--json", "state"])).state;
  } catch {
    console.log(`  ${b.name}: could not read PR #${number}; skipping rather than guessing`);
    continue;
  }
  if (state !== "OPEN") candidates.push({ name: b.name, why: `PR #${number} is ${state}` });
}

if (candidates.length === 0) {
  console.log("Nothing to sweep.");
  process.exit(0);
}

let failed = 0;
for (const c of candidates) {
  console.log(`deleting ${c.name} (${c.why})`);
  try {
    sh("scripts/neon-pr-branch.sh", ["delete", c.name.replace(/^pr-/, "")]);
  } catch (error) {
    failed += 1;
    console.error(`  FAILED: ${c.name}: ${error.message}`);
  }
}
// A failed sweep is reported, never swallowed. The whole reason this script
// exists is that a delete which reported success while leaking is what filled
// the project.
if (failed > 0) process.exit(1);
console.log(`Swept ${candidates.length} branch(es).`);
