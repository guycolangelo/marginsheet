// The sync Worker must be unreachable from the public internet (M4 section 2a).
//
// The whole argument for a third deployable is that the key which decrypts
// every household's Plaid token lives somewhere a household request cannot
// reach. ONE ROUTE ADDED HERE UNDOES THAT, and nothing else would fail: the
// Worker would still work, every sync test would still pass, and the boundary
// would be gone.
//
// THIS FILE'S FIRST VERSION WAS FALSE FOR THE ENTIRE LIFE OF THE WORKER, and
// the way it was false is worth more than the fix.
//
// It was titled "unreachable from the public internet". It checked the right
// key. It asserted `expect(env.workers_dev).not.toBe(true)`. And
// `workers_dev` was ABSENT from every environment, so the assertion compared
// `undefined` against `true`, passed, and reported a boundary.
//
// ABSENT MEANS ENABLED. Cloudflare publishes a Worker on workers.dev unless
// the config says otherwise, so the omission this test read as safe was the
// setting being ON. Verified 19 Aug 2026 by curl, which is how it was found:
// https://marginsheet-sync.guy-a84.workers.dev/health answered 200 in
// PRODUCTION, /debug/crypto-selftest answered 200, and /internal/exchange
// answered 400 to an empty body, which is the handler rejecting the body
// rather than the route being absent.
//
// THE RULE THIS COST: an assertion about configuration must state what
// ABSENCE means, and a default-on setting is not disabled by omission.
// `not.toBe(true)` is the wrong shape for any such key, because it is
// satisfied by the very state that turns the feature on. The right shape is
// `toBe(false)`: it demands the config say so, and it cannot be satisfied by
// silence.
//
// AND CONFIGURATION IS NOT REACHABILITY. This file reads a file. That is a
// report, and the rule in CLAUDE.md is to verify against the thing itself.
// The live check lives in the `public-surface` CI job, which asks the
// internet rather than the repo and keeps "reachable" distinct from "could
// not tell".

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raw = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
// Strip // comments so the config can carry the reasoning without breaking JSON.
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));

const environments: [string, Record<string, unknown>][] = [
  ["top level (dev)", config],
  ["staging", config.env.staging],
  ["production", config.env.production],
];

describe("marginsheet-sync declares no public surface", () => {
  for (const [where, env] of environments) {
    it(`${where} declares no routes`, () => {
      expect(env.routes, `${where} has routes; the third-Worker ruling is undone`).toBeUndefined();
      expect(env.route, `${where} has a route; the third-Worker ruling is undone`).toBeUndefined();
    });

    it(`${where} turns workers.dev OFF explicitly, rather than omitting it`, () => {
      // toBe(false), never not.toBe(true). The second passes on `undefined`,
      // and `undefined` is how this Worker came to be published publicly in
      // all three environments while this file reported a boundary.
      expect(
        env.workers_dev,
        `${where} does not set workers_dev: false. Absent means PUBLISHED on workers.dev, ` +
          `so omission is the exposed state rather than the safe one.`
      ).toBe(false);
    });
  }
});
