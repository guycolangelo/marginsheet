// ONE PLACE CONSTRUCTS A PLAID REQUEST (invariant 7, static half).
//
// WHY THIS IS THE CONTROL AND THE GREP IS THE COURTESY. The leak probe in
// token-never-escapes.test.ts guards plaid-client.ts, and its value depends
// entirely on that being the ONLY place a Plaid request is built. A second call
// site added in M5 or M13 makes the probe's coverage partial while every test
// stays green. That is the coverage-degenerate failure, not a control failure:
// nothing breaks, nothing reddens, and the guarantee quietly becomes narrower
// than the sentence describing it.
//
// BOTH DIRECTIONS, same shape as the sensitive-actions enumeration:
//   1. no Plaid request is constructed outside the named module
//   2. THE NAMED MODULE IS ACTUALLY THE ONE THE PROBE COVERS
//
// Direction 2 is the one that stops this emptying itself. A rename or a move
// would otherwise leave direction 1 scanning for a thing that no longer exists
// anywhere, passing perfectly while guarding nothing.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CALL_SITE = "services/sync/src/plaid-client.ts";
const PROBE = "services/sync/test/token-never-escapes.test.ts";

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, acc);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) acc.push(rel);
  }
  return acc;
}

const files = [...sources("services"), ...sources("packages")];

/** Does this file BUILD a Plaid HTTP request, as opposed to calling one?
 *
 * The first version looked for "plaid.com" or for access_token beside a fetch,
 * AND MATCHED NOTHING, including the call site itself: plaid-client.ts takes
 * its base URL from config and its params are a generic record, so neither
 * string appears in it. Direction 2 caught that immediately, which is the
 * entire reason direction 2 exists. Left alone, direction 1 would have scanned
 * for a signal that matches no file in the repo and passed forever.
 *
 * The signal now is a fetch beside any Plaid credential field, which is what
 * building one of these requests actually requires.
 *
 * AND IT EXCLUDES cdn.plaid.com, WHICH IS NOT AN API HOST. On 19 Aug 2026 the
 * connect page matched, because it loads Plaid Link's browser SDK from
 * cdn.plaid.com beside a fetch to our own endpoints. That page never sees a
 * client secret and never sees an access token: the link token is minted
 * server-side and Link runs in the household's browser.
 *
 * THE DETECTOR WAS FIXED RATHER THAN THE PAGE, for the same reason as every
 * other time: making somebody restructure correct code to satisfy a scanner is
 * the ceremony that gets a rule suppressed. What this control guards is a
 * server-side call that could carry a CREDENTIAL, so it now looks for an API
 * host or a credential field, and a script tag is neither. */
const PLAID_API_HOST = /\b(sandbox|production|development|api)\.plaid\.com/;

function constructsPlaidRequest(path: string): boolean {
  const body = readFileSync(join(ROOT, path), "utf8");
  const sends = /\bfetch\s*\(/.test(body);
  const plaidShaped =
    PLAID_API_HOST.test(body) || /client_id/.test(body) || /access_token/.test(body);
  return sends && plaidShaped;
}

describe("direction 1: nothing outside the named module builds a Plaid request", () => {
  it("scans a non-trivial number of files, so it is not vacuous", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  // Tests are excluded from direction 1 and covered by direction 2. A test may
  // legitimately hold a token-shaped literal and stub fetch; that is what the
  // probe does.
  const production = files.filter((f) => !f.includes("/test/"));

  it("finds Plaid request construction in exactly one place", () => {
    const found = production.filter(constructsPlaidRequest);
    expect(
      found,
      `Plaid requests are constructed outside ${CALL_SITE}. The leak probe guards ` +
        `one module, so a second call site makes its coverage partial while every ` +
        `test stays green. Route it through callPlaid, or extend the probe and this list.`
    ).toEqual([CALL_SITE]);
  });
});

describe("direction 2: the named module is the one the probe actually covers", () => {
  it("the call site exists at the path this scan names", () => {
    // A rename would otherwise leave direction 1 scanning for nothing and
    // passing perfectly.
    expect(files, `${CALL_SITE} does not exist; this scan is guarding nothing`).toContain(CALL_SITE);
  });

  it("the call site still constructs requests, so the scan's signal is real", () => {
    expect(
      constructsPlaidRequest(CALL_SITE),
      `${CALL_SITE} no longer looks like a Plaid call site. Either the construction ` +
        `moved, in which case this scan is now empty, or the detection is stale.`
    ).toBe(true);
  });

  it("the probe imports from the call site this scan names", () => {
    // Binds the two controls together. If the probe is pointed somewhere else,
    // the enumeration is guarding a module nobody is probing.
    const probe = readFileSync(join(ROOT, PROBE), "utf8");
    expect(
      /from\s+"\.\.\/src\/plaid-client\.js"/.test(probe),
      `${PROBE} does not import from ${CALL_SITE}. The enumeration and the leak ` +
        `probe have drifted apart and each is guarding something the other is not.`
    ).toBe(true);
  });
});

// SECONDARY, and explicitly a courtesy rather than the control. It catches the
// obvious careless line. It cannot catch a token reaching a log through a
// variable, which is why the enumeration above is the thing being trusted.
describe("secondary: no obvious logging of a token", () => {
  it("no source line logs something named like an access token", () => {
    const offenders: string[] = [];
    for (const file of files.filter((f) => !f.includes("/test/"))) {
      readFileSync(join(ROOT, file), "utf8").split("\n").forEach((line, i) => {
        if (/console\.(log|info|warn|error|debug)|captureMessage|captureException/.test(line) &&
            /access_token|accessToken|access_token_ciphertext/.test(line)) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offenders, "a log line names an access token").toEqual([]);
  });
});
