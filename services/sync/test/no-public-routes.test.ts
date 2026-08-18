// The sync Worker must have no public routes (M4 section 2a).
//
// The whole argument for a third deployable is that the key which decrypts
// every household's Plaid token lives somewhere a household request cannot
// reach. ONE ROUTE ADDED HERE UNDOES THAT, and nothing else would fail: the
// Worker would still work, every sync test would still pass, and the boundary
// would be gone. So its absence is asserted rather than left to review.

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

describe("marginsheet-sync is unreachable from the public internet", () => {
  for (const [where, env] of environments) {
    it(`${where} declares no routes`, () => {
      expect(env.routes, `${where} has routes; the third-Worker ruling is undone`).toBeUndefined();
      expect(env.route, `${where} has a route; the third-Worker ruling is undone`).toBeUndefined();
    });

    it(`${where} declares no custom domain and is not on workers.dev`, () => {
      expect(env.workers_dev, `${where} is published on workers.dev, which is a public route`).not.toBe(true);
    });
  }
});
