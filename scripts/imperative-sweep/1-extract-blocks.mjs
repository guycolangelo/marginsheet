// Group comment lines into BLOCKS, so a unit is a claim rather than a fragment.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const TREES = ["services", "packages", "scripts", ".github/scripts", "config", "apps"];
const EXT = [".ts", ".tsx", ".mjs", ".js", ".sql", ".sh", ".json", ".jsonc", ".yml", ".html"];
// imperative-sweep excludes itself, the same reason packages/lint is absent
// from its own repo-scan: this file must contain the imperative vocabulary to
// define it, and a tool that surveys itself reports on its own wordlist.
const SKIP = new Set(["node_modules", "dist", ".sweep", "coverage", "imperative-sweep"]);
const IMPERATIVE =
  /\b(must not|must never|must|always|never|forces?|forced|only|exactly|cannot|can never|shall|required|requires|prohibited|refuses?|refused|composes?|obligates?|implies|guarantees?|ensures?)\b/i;

function walk(dir, out = []) {
  let entries; try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP.has(name) || name.startsWith(".git")) continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out); else if (EXT.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

// Created here so the sweep runs from a clean checkout. A survey that needs a
// directory somebody made by hand is a survey that will not re-run.
mkdirSync(join(ROOT, ".sweep"), { recursive: true });

const files = TREES.flatMap((t) => walk(join(ROOT, t)));
const blocks = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const isJson = rel.endsWith(".json") || rel.endsWith(".jsonc");
  const lines = readFileSync(file, "utf8").split("\n");
  let cur = null, inBlock = false;
  const flush = () => {
    if (cur && IMPERATIVE.test(cur.text)) blocks.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    let isComment = false;
    if (inBlock) { isComment = true; if (t.includes("*/")) inBlock = false; }
    else if (t.startsWith("/*")) { isComment = true; if (!t.includes("*/")) inBlock = true; }
    else if (t.startsWith("//") || t.startsWith("*") || t.startsWith("--") || t.startsWith("#") || t.startsWith("<!--")) isComment = true;
    else if (isJson && /^"/.test(t)) isComment = true;
    if (isComment) {
      const clean = t.replace(/^[\/*\-#<!]+\s?/, "").replace(/\s*\*\/\s*$/, "").replace(/^"|",?$/g, "").trim();
      if (!cur) cur = { file: rel, line: i + 1, text: clean };
      else cur.text += " " + clean;
    } else flush();
  }
  flush();
}
writeFileSync(join(ROOT, ".sweep/blocks.json"), JSON.stringify(blocks, null, 2));
console.log(`imperative comment BLOCKS: ${blocks.length}`);
const byFile = {};
for (const b of blocks) byFile[b.file] = (byFile[b.file] ?? 0) + 1;
console.log(`files: ${Object.keys(byFile).length}`);
const byTree = {};
for (const b of blocks) { const t = b.file.split("/").slice(0,2).join("/"); byTree[t] = (byTree[t] ?? 0) + 1; }
console.log("\nby tree:");
for (const [t, n] of Object.entries(byTree).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}  ${t}`);
