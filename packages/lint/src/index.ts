// Library entry. The conversation service calls lint() on every outbound
// artifact; CI calls scanFiles() over source and prompt trees. Same engine,
// same rules, one source of truth.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RULES, type LintContext, type Rule } from "./rules.js";

export { RULES, type LintContext, type Rule } from "./rules.js";

export interface Finding {
  ruleId: string;
  message: string;
  match: string;
  index: number;
  line: number;
}

export function lint(
  text: string,
  contexts: LintContext[] = ["universal"]
): Finding[] {
  const active = RULES.filter((r) =>
    r.contexts.some((c) => contexts.includes(c))
  );
  const findings: Finding[] = [];
  for (const rule of active) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const m of text.matchAll(re)) {
      findings.push({
        ruleId: rule.id,
        message: rule.message,
        match: m[0],
        index: m.index ?? 0,
        line: text.slice(0, m.index ?? 0).split("\n").length,
      });
    }
  }
  return findings;
}

export interface FileFinding extends Finding {
  file: string;
}

const SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".md", ".txt", ".html", ".jsonc"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

export function scanFiles(
  roots: string[],
  contexts: LintContext[] = ["universal"]
): FileFinding[] {
  const findings: FileFinding[] = [];
  for (const root of roots) {
    const files = statSync(root).isDirectory() ? walk(root) : [root];
    for (const file of files) {
      for (const f of lint(readFileSync(file, "utf8"), contexts)) {
        findings.push({ ...f, file });
      }
    }
  }
  return findings;
}
