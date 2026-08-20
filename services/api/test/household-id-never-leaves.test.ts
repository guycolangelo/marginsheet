// NO HOUSEHOLD ID REACHES A CALLER.
//
// WHY THIS EXISTS. Fixing /plaid/exchange removed a caller-supplied household
// id, and the severity of what came before rested on a second fact: a stranger
// cannot obtain a household id, because it appears in no response body, URL,
// email or client surface. That was TRUE when traced on 19 Aug 2026 and it is
// A MITIGATION, NOT A BOUNDARY: nothing maintained it. The first feature to put
// a household id in a link would have removed it and nothing would have gone
// red.
//
// A household id is a bare UUID with no structure to recognise, so this cannot
// scan payloads at runtime. It scans SOURCE for the shapes that put one in
// front of a caller, the way plaid-call-sites enumerates rather than probes.
//
// BOTH DIRECTIONS, same as that file:
//   1. no household id is composed into anything a caller receives
//   2. THE SURFACES SCANNED ARE THE SURFACES THAT REACH CALLERS, so a new
//      response-building module cannot quietly fall outside the scan
//
// WHAT THIS DOES NOT CLAIM. It cannot see a household id reaching a caller
// through a variable renamed along the way, and it does not read the database.
// It catches the shape that actually occurs: a household id named as such,
// placed into a response, a URL, or an email body.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** Directories whose code composes something a caller receives. */
const CALLER_FACING = ["services/api/src", "services/conversation/src", "services/sync/src", "services/web", "services/site"];

function sources(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "build" || entry.startsWith(".")) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, acc);
    else if (/\.(ts|tsx|js|jsx|html)$/.test(entry) && !entry.endsWith(".d.ts")) acc.push(rel);
  }
  return acc;
}

const files = CALLER_FACING.flatMap((d) => sources(d));

/** A line naming a household id. Both spellings, because the codebase uses
 *  camelCase in TypeScript and snake_case in SQL and both end up in objects. */
const NAMES_A_HOUSEHOLD_ID = /\bhousehold_?[Ii]d\b/;

/** Shapes that hand a value to a caller. Deliberately narrow: a broad matcher
 *  fires on every SQL predicate in the codebase and a rule that fires on
 *  legitimate code is a rule people learn to suppress. */
const REACHES_A_CALLER = [
  /Response\.json\(/,
  /new Response\(/,
  /JSON\.stringify\(/,
  /searchParams\.set\(/,
  /\?[a-zA-Z_]*household/i,
  /res\.(?:send|json)\(/,
];

/** The line with every quoted string blanked out. A household id NAMED inside
 *  a message carries no value: `"publicToken and householdId are required"`
 *  mentions the field and emits nothing. Both false positives on the first run
 *  were of this family or the next, AND THE DETECTOR WAS FIXED RATHER THAN THE
 *  CODE, because rewriting an error message to satisfy a scanner is the
 *  ceremony that teaches people to suppress a rule. */
function withoutStringLiterals(line: string): string {
  return line.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
}

/** Lines that name a household id for a reason that never reaches a caller. */
function isInternalUse(line: string): boolean {
  return (
    /set_config\(/.test(line) ||
    /^\s*(?:\/\/|\*|\/\*)/.test(line) ||
    /\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bwhere\b|\bvalues\b/i.test(line)
  );
}

/** Is this line part of a request aimed at a SERVICE BINDING rather than at a
 *  caller? The `.internal` host sits on the `new Request(...)` line, several
 *  lines above the body, so a same-line check cannot see it. Bounded window,
 *  because an unbounded search upward would eventually excuse everything. */
function targetsAnInternalBinding(lines: string[], index: number): boolean {
  const from = Math.max(0, index - 8);
  return lines
    .slice(from, index)
    .some((l) => /\.internal|env\.(?:SYNC|CONVERSATION)\.fetch/.test(l));
}

interface Finding { file: string; line: number; text: string }

const findings: Finding[] = [];
for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // The NAME must appear as code, not inside a message.
    if (!NAMES_A_HOUSEHOLD_ID.test(withoutStringLiterals(line))) return;
    if (isInternalUse(line)) return;
    if (targetsAnInternalBinding(lines, i)) return;
    // The name must sit INSIDE the thing that reaches a caller, not merely on
    // the same line as one. `if (!householdId) return Response.json({ error:
    // "household id is required" })` is a GUARD: the identifier is the
    // condition and the response carries a static string. Flagging it would
    // teach people to restructure correct code to satisfy a scanner, which is
    // the ceremony that gets a rule suppressed.
    const insidePayload = REACHES_A_CALLER.some((p) => {
      const m = p.exec(line);
      if (!m) return false;
      const after = withoutStringLiterals(line.slice(m.index + m[0].length));
      return NAMES_A_HOUSEHOLD_ID.test(after);
    });
    if (insidePayload) {
      findings.push({ file, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
}

describe("a household id never reaches a caller", () => {
  it("is composed into no response, URL or message", () => {
    expect(
      findings,
      "A household id is being placed somewhere a caller can read it.\n" +
        "That UUID's unguessability is what limits the damage of anything that\n" +
        "takes a household id as input, and it is a mitigation nothing else\n" +
        "maintains. If this surface is intended, the mitigation is gone and the\n" +
        "handlers that trust it need revisiting first.\n\n" +
        findings.map((f) => `  ${f.file}:${f.line}\n    ${f.text}`).join("\n")
    ).toEqual([]);
  });

  it("scans the surfaces that actually reach callers", () => {
    // DIRECTION 2. Without this, a rename or a new service directory leaves
    // the scan above looking at nothing and passing perfectly. It asserts the
    // scan found real files in the places responses are built.
    expect(files.length, "the scan found no source files; its paths are stale").toBeGreaterThan(20);
    for (const dir of ["services/api/src"]) {
      expect(
        files.some((f) => f.startsWith(dir)),
        `${dir} is not being scanned, and it is where responses are built`
      ).toBe(true);
    }
    // The handler this rule was written for must be in scope.
    expect(files).toContain("services/api/src/index.ts");
  });
});
