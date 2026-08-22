// Break each control on purpose, and require the right test to go red (3.6).
//
// Task 0.4's planted-failure proof, applied to M3's controls. A control nobody
// has watched fail is a control nobody should trust, and nine of them failed
// the standing question in two weeks while every suite was green.
//
// PER CONTROL:
//   1. apply the breakage
//   2. ASSERT THE BREAKAGE TOOK EFFECT
//   3. run ONLY the named test, and require it to FAIL
//   4. restore
//   5. run it again, and require it to PASS
//
// STEP 2 IS NON-NEGOTIABLE (Guy, 17 Aug 2026). A harness that silently stopped
// mutating anything would report every control as "correctly went red" while
// having done nothing: a control that cannot fail, built to prove controls can.
// That would be the tenth finding and the most embarrassing one. So a mutation
// that does not change the file, or a statement whose effect cannot be read
// back, aborts the run rather than passing.
//
// STEP 5 MATTERS AS MUCH AS STEP 3. A test that fails after the mutation AND
// after restoration is broken, not sensitive, and would otherwise look like a
// pass here.
//
// The tree is restored in `finally` and checked with `git status` at the end,
// because a harness that can leave the working tree modified is a harness that
// will.

import { execFileSync, execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import postgres from "postgres";

const run = promisify(execFile);
const REGISTER = "config/control-register.json";
const ONLY = process.argv[2]; // optional control id, for a single run

// The tree as it was FOUND, not as it "should" be. The harness must leave
// nothing different from how it arrived; asserting a clean tree instead would
// fail on any unrelated work in progress and teach people to ignore it.
const treeBefore = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });

const register = JSON.parse(readFileSync(REGISTER, "utf8"));
// Owed entries are DESIGNED but not built, so there is nothing to mutate. They
// are PRINTED rather than skipped silently: a harness that quietly ignores part
// of its register reports on a smaller set than the register describes, which
// is how "all controls verified" comes to mean something narrower than it says.
const owedEntries = register.controls.filter((c) => c.status === "owed");
const runnable = register.controls.filter((c) => c.status !== "owed");

const controls = ONLY
  ? runnable.filter((c) => c.id === ONLY)
  : runnable;

if (owedEntries.length > 0 && !ONLY) {
  process.stdout.write(`\n${owedEntries.length} OWED control(s), designed and not yet built:\n`);
  for (const c of owedEntries) {
    process.stdout.write(`  ${c.id}: owed to ${c.owedTo}, test ${c.test}\n`);
  }
  process.stdout.write("  These are not failures. They are not verified either.\n");
}

if (controls.length === 0) {
  console.error(ONLY ? `No control with id "${ONLY}"` : "The register is empty.");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
const sql = DATABASE_URL ? postgres(DATABASE_URL, { max: 1 }) : null;

/** Who last touched a test, so a red has an owner rather than a mystery. */
function blame(file) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%h %an, %ar: %s", "--", file], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "(no git history)";
  }
}

/** Runs one named test. Returns whether it passed. */
/** Which workspace package owns a test path, and the path relative to it.
 *
 * THE HARNESS RAN EVERYTHING AGAINST @marginsheet/api. Registered controls whose
 * tests live in services/sync were handed a path that does not exist there, so
 * vitest exited non-zero EVERY TIME. That reads as RED, and red is what the
 * mutation step wants, so step 3 passed for four controls the harness had never
 * actually run.
 *
 * ONLY THE RESTORE CHECK CAUGHT IT. Step 5 requires the test to go GREEN again
 * after restoring, and a test that cannot run is red in both states. Without
 * step 5 this would have reported four controls as correctly sensitive while
 * executing nothing, which is the exact class this harness exists to find,
 * occurring inside the harness. Found 18 Aug 2026. */
function packageFor(testPath) {
  const match = testPath.match(/^(services|packages)\/([^/]+)\//);
  if (!match) throw new Error(`cannot tell which package owns ${testPath}`);
  const [, kind, name] = match;
  return { pkg: `@marginsheet/${name}`, relative: testPath.replace(`${kind}/${name}/`, "") };
}

/** Runs the control's test. Returns whether it passed AND what it said.
 *
 *  THE OUTPUT IS KEPT BECAUSE DISCARDING IT FORCED GUESSING. On 19 Aug 2026
 *  cross-household-upsert-cannot-land reported "restored -> STILL RED" and
 *  nothing else, and a control that stays red after restore has SEVERAL
 *  possible causes: the property it guards is genuinely violated, the fixture
 *  is invalid, a grant is missing, or the restore did not restore. Those have
 *  different owners and different urgencies, and the report could not tell
 *  them apart.
 *
 *  That is the enumerate-causes rule applied to this harness: when a message
 *  cannot distinguish its causes, build the diagnostic rather than reason
 *  harder. The raw body is printed alongside the verdict so a reader can
 *  disagree with the interpretation. */
async function testPasses(control) {
  const { pkg, relative } = packageFor(control.test);
  try {
    const { stdout = "", stderr = "" } = await run(
      "pnpm",
      [
        "--filter",
        pkg,
        "exec",
        "vitest",
        "run",
        "--no-file-parallelism",
        relative,
        "-t",
        control.name,
      ],
      { cwd: process.cwd(), env: process.env, maxBuffer: 32 * 1024 * 1024 }
    );
    return { passed: true, output: `${stdout}\n${stderr}` };
  } catch (error) {
    const e = error ?? {};
    return { passed: false, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}` };
  }
}

/** The part of a vitest run that says WHY, without the passing noise. */
function whyItFailed(output) {
  const lines = String(output).split("\n");
  const kept = lines.filter((l) =>
    /AssertionError|Error:|expected|→|✕|×|FAIL|Tests\s+\d|No test files found|skipped/i.test(l)
  );
  return (kept.length > 0 ? kept : lines).slice(-40).join("\n");
}

async function readProof(control) {
  const [row] = await sql.unsafe(control.planted.proof);
  return Number(Object.values(row)[0]);
}

/** Applies the breakage and PROVES it took effect. Returns a restore function. */
async function breakIt(control) {
  const p = control.planted;

  if (p.kind === "source") {
    const before = readFileSync(p.file, "utf8");
    if (!before.includes(p.find)) {
      throw new Error(
        `the register's find text is not present in ${p.file}. The control was ` +
          `probably refactored; update the register rather than deleting the entry.`
      );
    }
    const after = before.replace(p.find, p.replace);
    if (after === before) {
      throw new Error(`the mutation for ${control.id} changed nothing in ${p.file}`);
    }
    writeFileSync(p.file, after);

    // Proof, read back off disk rather than assumed from the write.
    //
    // The file must have CHANGED and must now contain the replacement. It must
    // NOT be required to have lost the find text: an insertion-style mutation
    // legitimately keeps the original line and prepends to it, and requiring
    // the find text to vanish rejected exactly that. Found by running the
    // harness, where channel-gate-static aborted with "did not take effect"
    // while the mutation had applied perfectly.
    //
    // Note which way it failed: it refused to proceed rather than reporting a
    // pass it had not earned. A took-effect check that is too strict costs a
    // run; one that is too loose costs the whole point of the harness.
    const onDisk = readFileSync(p.file, "utf8");
    if (onDisk === before || !onDisk.includes(p.replace)) {
      writeFileSync(p.file, before);
      throw new Error(`the mutation for ${control.id} did not take effect on disk`);
    }
    return () => writeFileSync(p.file, before);
  }

  if (p.kind === "sql") {
    if (!sql) throw new Error(`${control.id} needs DATABASE_URL and none is set`);
    await sql.unsafe(p.apply);
    const value = await readProof(control);
    if (value !== p.appliedValue) {
      await sql.unsafe(p.restore);
      throw new Error(
        `the mutation for ${control.id} did not take effect: proof read ${value}, expected ${p.appliedValue}`
      );
    }
    return async () => {
      for (const statement of p.restore.split(";").map((x) => x.trim()).filter(Boolean)) {
        await sql.unsafe(statement);
      }
      const back = await readProof(control);
      if (back !== p.restoredValue) {
        throw new Error(
          `RESTORE FAILED for ${control.id}: proof read ${back}, expected ${p.restoredValue}. ` +
            `The branch is left mutated.`
        );
      }
    };
  }

  throw new Error(`unknown planted kind "${p.kind}" for ${control.id}`);
}

const results = [];

for (const control of controls) {
  process.stdout.write(`\n=== ${control.id}: ${control.control}\n`);
  let restore;
  try {
    // THE TARGET MUST BE GREEN IN ISOLATION BEFORE ANYTHING IS MUTATED.
    //
    // The harness runs the named test ALONE, via -t, and runs it TWICE against
    // one database. Neither is a property of a good test; both are properties
    // of being a plant target, and the obligation is invisible from the test.
    //
    // WITHOUT THIS, A RED RESULT CANNOT BE TRUSTED EITHER. A target that fails
    // in isolation reddens under the mutation for a reason that has nothing to
    // do with the mutation, and the harness reports "went red" and passes it.
    // The restore then reports STILL RED and the reading is that the control is
    // broken. reconciliation-detects cost two cycles to that on 22 Aug 2026:
    // its fixture inherited state from siblings that -t skipped.
    //
    // IT IS A DISTINCT VERDICT rather than a failure of the control, because
    // they send a reader to opposite places: one is a fixture that needs
    // isolating, the other is a test that does not notice its own subject.
    const before = await testPasses(control);
    if (!before.passed) {
      process.stdout.write(`  TARGET NOT SELF-CONTAINED: it is already red before any mutation\n`);
      process.stdout.write(`  WHY (raw, trust this over any reading):\n`);
      for (const line of whyItFailed(before.output).split("\n")) {
        process.stdout.write(`    | ${line}\n`);
      }
      results.push({
        control,
        ok: false,
        notSelfContained: true,
        error:
          "TARGET NOT SELF-CONTAINED: the named test is already red before any mutation. " +
          "The harness runs it ALONE via -t and TWICE against one database, so it must pass " +
          "in isolation and be idempotent. That is a property of being a plant target rather " +
          "than of being a good test. Fix the fixture, not the control.",
      });
      continue;
    }

    restore = await breakIt(control);
    process.stdout.write(`  broke it, and confirmed the break took effect\n`);

    const broken = await testPasses(control);
    const redWhenBroken = !broken.passed;
    process.stdout.write(
      `  ${control.test} -t "${control.name}" -> ${redWhenBroken ? "RED" : "still green"}\n`
    );

    await restore();
    restore = undefined;

    const restored = await testPasses(control);
    const greenWhenRestored = restored.passed;
    process.stdout.write(`  restored -> ${greenWhenRestored ? "green" : "STILL RED"}\n`);
    if (!greenWhenRestored) {
      // The whole point of this block: a STILL RED must arrive with its reason.
      process.stdout.write(`  WHY IT IS STILL RED (raw, trust this over any reading):\n`);
      for (const line of whyItFailed(restored.output).split("\n")) {
        process.stdout.write(`    | ${line}\n`);
      }
    }
    if (!redWhenBroken) {
      process.stdout.write(`  WHY THE MUTATION DID NOT REDDEN IT (raw):\n`);
      for (const line of whyItFailed(broken.output).split("\n")) {
        process.stdout.write(`    | ${line}\n`);
      }
    }

    results.push({
      control,
      ok: redWhenBroken && greenWhenRestored,
      redWhenBroken,
      greenWhenRestored,
    });
  } catch (error) {
    results.push({ control, ok: false, error: error.message });
  } finally {
    // A restore that already threw must not be attempted again, and an
    // exception here must not take the whole run down: found by running the
    // harness, where a failed restore threw inside finally and crashed the
    // process, which would have left the branch mutated with no report.
    if (restore) {
      try {
        await restore();
      } catch (error) {
        results.push({
          control,
          ok: false,
          error: `RESTORE FAILED and the branch may be left mutated: ${error?.message ?? error}`,
        });
      }
    }
  }
}

if (sql) await sql.end();

const failed = results.filter((r) => !r.ok);
const lines = [
  `## Planted failures (${results.length} controls)`,
  "",
  "| Control | Broke it | Went red | Green again |",
  "| --- | --- | --- | --- |",
  ...results.map(
    (r) =>
      `| ${r.control.id} | ${r.error ? "**failed**" : "yes"} | ${
        r.error ? "n/a" : r.redWhenBroken ? "yes" : "**NO**"
      } | ${r.error ? "n/a" : r.greenWhenRestored ? "yes" : "**NO**"} |`
  ),
];

console.log("\n" + lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

// The tree must be exactly as it was found. A harness that can leave source
// mutated is a harness that will, and the mutation it leaves is a control
// silently switched off.
//
// CHECKED AFTER THE REPORT, deliberately. An earlier version exited here
// first, so a tree change hid every result the run had produced. Diagnostics
// before enforcement: whatever went wrong, the findings are still worth
// reading.
//
// It compares against what it FOUND rather than asserting a clean tree, and it
// cannot tell the harness apart from a concurrent edit. In CI nothing else
// touches the tree; locally, an edit made while this runs will trip it, which
// is the safe direction.
const treeAfter = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
const treeChanged = treeAfter !== treeBefore;
if (treeChanged) {
  console.error("\nThe working tree changed during the run. Before:\n" + treeBefore);
  console.error("After:\n" + treeAfter);
  console.error(
    "If the harness caused this, a control is left switched off. If a concurrent\n" +
      "edit caused it, re-run on a quiet tree before trusting the table above."
  );
}


if (failed.length > 0) {
  console.error("\n" + "=".repeat(70));
  console.error("CONTROLS THAT DID NOT BEHAVE AS REGISTERED");
  console.error("=".repeat(70));
  for (const r of failed) {
    console.error(`\n${r.control.id}: ${r.control.control}`);
    console.error(`  guards: ${r.control.guards}`);
    if (r.error) {
      console.error(`  the harness could not run it: ${r.error}`);
    } else if (!r.redWhenBroken) {
      // TWO CAUSES, AND THE HARNESS CANNOT TELL THEM APART. The took-effect
      // check proves the FILE changed, not that BEHAVIOUR did, and proving the
      // second is undecidable in general. So the message names both rather
      // than accusing the test, because an inert mutation blamed on a control
      // sends somebody to rewrite a test that was fine.
      console.error(`  THE TEST DID NOT GO RED. Either:`);
      console.error(
        `    a) the control is INSENSITIVE, and whatever ${r.control.test} now`
      );
      console.error(`       proves, it is not this control; or`);
      console.error(
        `    b) the planted mutation is INERT: it changed the file without`
      );
      console.error(`       changing behaviour, which tests the harness, not the control.`);
      console.error(`  Read the mutation in the register before touching the test.`);
    } else {
      console.error(`  BROKEN. It stayed red after the mutation was reverted.`);
    }
    // A nightly red with no owner is a nightly red that gets ignored by
    // Thursday, so every failure names who last touched the test.
    console.error(`  test:  ${r.control.test}`);
    console.error(`  last touched: ${blame(r.control.test)}`);
  }
  process.exit(1);
}

if (treeChanged) process.exit(1);

console.log(`\nAll ${results.length} controls went red when broken, and green when restored.`);
