// Does each Worker hold exactly the secrets it is permitted to hold? (4.2.3)
//
// THE POINT IS THE REMOVAL HALF. M4 section 2a puts the Plaid token's key on a
// Worker with no public routes. That ruling is undone by one secret nobody
// deleted, and nothing fails when it happens: every sync test passes whether or
// not api kept its copy. Asked the standing question, this is the only control
// that goes red on an un-removed key. A sync-path test does not, and a code
// scan does not, because the secret can sit in the store with nothing reading
// it, which is exactly the state being detected.
//
// "ABSENT" AND "COULD NOT READ" ARE DIFFERENT ANSWERS AND THIS NEVER CONFLATES
// THEM. They look identical from a green tick and mean opposite things: one is
// the boundary holding, the other is the check having no idea. The same
// distinction cost forty minutes on the Cloudflare permission hunt, where
// 10000: Authentication error read identically for three different causes. So a
// Worker that cannot be read is a FAILURE with its own message, never a pass
// and never folded into the diff.
//
// Secret NAMES only. Wrangler does not return values and neither does this.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const config = JSON.parse(readFileSync("config/worker-secrets.json", "utf8"));

const unreadable = [];
const differences = [];

/** Live secret names for one Worker in one environment, or a reason it could not be read. */
async function liveNames(service, envName) {
  const args = ["exec", "wrangler", "secret", "list", "--format", "json"];
  if (envName !== "dev") args.push("--env", envName);
  try {
    const { stdout } = await run("pnpm", args, {
      cwd: `services/${service}`,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    const start = stdout.indexOf("[");
    if (start === -1) return { error: `no JSON array in wrangler output` };
    const parsed = JSON.parse(stdout.slice(start, stdout.lastIndexOf("]") + 1));
    if (!Array.isArray(parsed)) return { error: "wrangler returned a non-array" };
    return { names: parsed.map((s) => s.name).sort() };
  } catch (error) {
    // Includes auth failures, a missing Worker, and a wrangler that would not
    // start. All of them mean the same thing for the RESULT (this check did not
    // run) and completely different things for the FIX, so the message has to
    // carry the cause.
    //
    // Taking the last few lines was the first attempt and it reported only
    // wrangler's "Logs were written to ..." footer, which names no cause at
    // all. That is the failure this project keeps meeting: a message that
    // cannot distinguish its causes invites guessing. Signal lines are
    // preferred and the noise is dropped.
    // Strip ANSI, or the cause arrives wrapped in colour codes in CI logs.
    const raw = String(error?.stderr || error?.message || error).replace(/\u001b\[[0-9;]*m/g, "");
    const NOISE = /Logs were written to|^\s*$|^\s*[|]?\s*$/;
    const lines = raw.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !NOISE.test(l));
    const signal = lines.filter((l) => /error|denied|unauthor|forbidden|not found|token|credential|10\d{3}/i.test(l));
    const chosen = (signal.length > 0 ? signal : lines).slice(0, 3).join(" | ");
    return { error: chosen.slice(0, 500) || "wrangler failed and produced no readable reason" };
  }
}

for (const [service, environments] of Object.entries(config.workers)) {
  for (const [envName, allowed] of Object.entries(environments)) {
    const result = await liveNames(service, envName);
    const where = `${service}/${envName}`;

    if (result.error) {
      unreadable.push({ where, error: result.error });
      console.log(`?? ${where}: COULD NOT READ`);
      continue;
    }

    const live = result.names;
    const unexpected = live.filter((n) => !allowed.includes(n));
    const missing = allowed.filter((n) => !live.includes(n));

    if (unexpected.length === 0 && missing.length === 0) {
      console.log(`ok ${where}: ${live.length} secrets, exactly as declared`);
      continue;
    }
    for (const name of unexpected) {
      const key = `${service}.${envName}.${name}`;
      differences.push({
        where,
        kind: "PRESENT BUT NOT DECLARED",
        name,
        expected: config.expectedFailures?.[key],
      });
    }
    for (const name of missing) {
      differences.push({ where, kind: "DECLARED BUT ABSENT", name });
    }
    console.log(`XX ${where}: ${unexpected.length} undeclared, ${missing.length} missing`);
  }
}

console.log("\n" + "=".repeat(72));

if (unreadable.length > 0) {
  console.log("\nCOULD NOT READ, which is NOT the same as 'nothing to report':\n");
  for (const u of unreadable) console.log(`  ${u.where}\n    ${u.error}\n`);
  console.log(
    "  A Worker whose secrets cannot be listed has been checked by nobody. This\n" +
      "  fails rather than passing, because absent and unreadable look identical\n" +
      "  from a green tick and mean opposite things.\n"
  );
}

if (differences.length > 0) {
  console.log("\nDIFFERENCES:\n");
  for (const d of differences) {
    console.log(`  ${d.where}: ${d.name} ${d.kind}`);
    if (d.expected) console.log(`    EXPECTED, and still a failure: ${d.expected}`);
    console.log();
  }
}

if (unreadable.length === 0 && differences.length === 0) {
  console.log("\nEvery Worker holds exactly the secrets it is declared to hold.");
  process.exit(0);
}

console.log(
  `FAILING: ${differences.length} difference(s), ${unreadable.length} unreadable.\n` +
    `Declared inventory: config/worker-secrets.json`
);
process.exit(1);
