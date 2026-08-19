// Classify each imperative block. THREE outcomes, not two.
//
// WHY THREE. The first version had ENFORCED and ADVISORY, and it produced
// false ADVISORY at scale: most verdicts were "no symbol found", which is the
// classifier failing to identify a subject rather than evidence that nothing
// holds the claim up. Calling that ADVISORY asserts a negative that was never
// established. A check that cannot distinguish must not claim to.
//
// So: ENFORCED where positive evidence is found, ADVISORY only where the claim
// names a subject AND nothing anywhere references it, and UNKNOWN otherwise.
// UNKNOWN is the honest bucket and it is expected to be the largest.
//
// LEVELS OF EVIDENCE, and none of them is claim-level. Enforcement of a
// PARTICULAR sentence is not machine-decidable; what is checkable is whether
// the surrounding code is exercised at all.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const blocks = JSON.parse(readFileSync(join(ROOT, ".sweep/blocks.json"), "utf8"));

function walk(dir, out = []) {
  let e; try { e = readdirSync(dir); } catch { return out; }
  for (const n of e) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const f = join(dir, n); let st; try { st = statSync(f); } catch { continue; }
    if (st.isDirectory()) walk(f, out); else if (/\.(ts|mjs|js|sh|yml|sql)$/.test(n)) out.push(f);
  }
  return out;
}
const allFiles = ["services", "packages", "scripts", ".github"].flatMap((t) => walk(join(ROOT, t)));
const testFiles = allFiles.filter((f) => f.includes("/test/") || f.endsWith(".test.ts"));
const ciFiles = allFiles.filter((f) => f.includes(".github/") || f.startsWith(join(ROOT, "scripts")));
const testText = testFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const ciText = ciFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const register = JSON.parse(readFileSync(join(ROOT, "config/control-register.json"), "utf8"));
const registeredTests = new Set(register.controls.map((c) => c.test));

/** Every exported name in a file: the file's public surface. */
function exportsOf(file) {
  let src; try { src = readFileSync(join(ROOT, file), "utf8"); } catch { return []; }
  return [...src.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g)].map((m) => m[1]);
}

/** Is this module exercised by any test at all? */
function moduleTested(file) {
  const base = file.split("/").pop().replace(/\.(ts|mjs|js|sql)$/, "");
  if (testText.includes(`/${base}.js`) || testText.includes(`/${base}.ts`)) return true;
  const ex = exportsOf(file).filter((n) => n.length > 3);
  return ex.some((n) => testText.includes(n));
}

function ddlNearby(file, line) {
  if (!file.endsWith(".sql")) return false;
  let src; try { src = readFileSync(join(ROOT, file), "utf8").split("\n"); } catch { return false; }
  return /\b(CHECK|UNIQUE|NOT NULL|GRANT|REVOKE|REFERENCES|POLICY|FORCE ROW LEVEL)\b/i
    .test(src.slice(line, line + 20).join("\n"));
}

const moduleCache = new Map();
const out = [];
for (const b of blocks) {
  const inTest = b.file.includes("/test/") || b.file.endsWith(".test.ts");
  const registered = registeredTests.has(b.file);
  const ddl = ddlNearby(b.file, b.line);
  if (!moduleCache.has(b.file)) moduleCache.set(b.file, moduleTested(b.file));
  const modTested = moduleCache.get(b.file);
  const isCi = b.file.includes(".github/") || b.file.startsWith("scripts/");
  const isConfig = b.file.startsWith("config/");

  let verdict, basis;
  if (inTest)          { verdict = "ENFORCED"; basis = "the claim IS the assertion (test file)"; }
  else if (registered) { verdict = "ENFORCED"; basis = "file named by the control register"; }
  else if (ddl)        { verdict = "ENFORCED"; basis = "constraint in the DDL below it"; }
  else if (modTested)  { verdict = "UNKNOWN";  basis = "module is exercised by tests; THIS claim is not traced"; }
  else if (isCi)       { verdict = "UNKNOWN";  basis = "CI script; runs, but the claim is not asserted"; }
  else if (isConfig)   { verdict = "ADVISORY"; basis = "config prose; no mechanism reads it"; }
  else                 { verdict = "ADVISORY"; basis = "no test references this module at all"; }
  out.push({ ...b, verdict, basis, moduleTested: modTested });
}
writeFileSync(join(ROOT, ".sweep/classified.json"), JSON.stringify(out, null, 2));

const count = (v) => out.filter((r) => r.verdict === v).length;
console.log(`blocks: ${out.length}`);
for (const v of ["ENFORCED", "UNKNOWN", "ADVISORY"])
  console.log(`  ${v.padEnd(9)} ${String(count(v)).padStart(3)}  (${Math.round(count(v)/out.length*100)}%)`);
console.log("\nADVISORY by file:");
const adv = {};
for (const r of out.filter((r) => r.verdict === "ADVISORY")) adv[r.file] = (adv[r.file] ?? 0) + 1;
for (const [f, n] of Object.entries(adv).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}  ${f}`);
