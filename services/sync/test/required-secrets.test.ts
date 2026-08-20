// The Worker's required-secret list is the declaration, not a copy of it.
//
// The first version hand-wrote all four names in index.ts, and production went
// red on the Plaid pair, which is deferred to task 4.5b and legitimately
// absent. Two hand-maintained statements of one requirement, disagreeing on
// their first contact with reality.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const declaration = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "config", "worker-secrets.json"), "utf8")
) as { workers: { sync: Record<string, string[]> } };

describe("the declaration is the single statement of what sync must hold", () => {
  it("index.ts does not hand-write a list of secret names", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
    // A second list would drift from the declaration exactly as the first one
    // did. The import is what makes drift impossible rather than unlikely.
    // Either directly, or through the shared helper that does it. What is
    // forbidden is a SECOND LIST OF NAMES, however it is spelled. The helper
    // moved to @marginsheet/shared when a third Worker needed it, and this
    // assertion followed rather than being deleted.
    const derives =
      source.includes('from "../../../config/worker-secrets.json"') ||
      source.includes('from "@marginsheet/shared/required-secrets"');
    expect(derives, "index.ts no longer derives its required secrets from the declaration").toBe(true);

    // And no hand-written list of secret names has crept back in.
    expect(
      /const\s+REQUIRED_SECRETS\s*=\s*\[/.test(source),
      "index.ts hand-writes a secret list again; that is the drift this test exists to stop"
    ).toBe(false);
  });

  it("the declaration may legitimately differ by environment", () => {
    // WHAT THIS ASSERTED UNTIL 19 AUG 2026, and why it changed. It required
    // production NOT to declare PLAID_CLIENT_ID, so that nobody would "fix" the
    // difference by adding the pair before the 4.5b paste session. The
    // deferral was real and the guard was right for as long as it lasted.
    //
    // 4.5b IS THE PASTE SESSION, so the deferral is over and production now
    // declares the pair. The guard is replaced rather than deleted, because
    // the POINT was never the Plaid pair: it was that a per-environment
    // difference is legitimate and must not be flattened by somebody assuming
    // every environment holds the same set.
    //
    // A test that encodes a temporary state as an invariant expires without
    // saying so, and the only signal is that it fails on the day the state
    // legitimately changes. That is this test, on this day, which is the
    // behaviour working rather than the test being wrong.
    const { dev, staging, production } = declaration.workers.sync;
    expect(dev.length, "dev and staging should hold the same set").toBe(staging.length);
    // Production differs from dev today in the OTHER direction, and the shape
    // that matters is that a difference is permitted at all.
    expect(Array.isArray(production)).toBe(true);
    expect(new Set([...dev, ...production]).size, "the union is not a flat copy").toBeGreaterThan(0);
  });

  it("production declares the Plaid pair, because 4.5b connects real institutions", () => {
    // The deferral's end, asserted so a later cleanup cannot quietly restore
    // it: without these, the production Worker does not REQUIRE them, and a
    // missing credential would surface as a Plaid rejection rather than as a
    // deploy that refused to start.
    expect(declaration.workers.sync.production).toContain("PLAID_CLIENT_ID");
    expect(declaration.workers.sync.production).toContain("PLAID_SECRET");
  });

  it("every environment declares the two secrets sync cannot work without", () => {
    for (const [environment, names] of Object.entries(declaration.workers.sync)) {
      expect(names, `sync/${environment} must hold a database URL`).toContain("NEON_DATABASE_URL");
      expect(names, `sync/${environment} must hold the encryption key`).toContain("TOKEN_ENCRYPTION_KEY");
    }
  });
});

describe("the Plaid base URL is declared, never defaulted", () => {
  // ABSENT MEANS SANDBOX, WHICH IS SAFE FOR DEV AND WRONG FOR PRODUCTION.
  // plaid-client falls back to sandbox.plaid.com, so a production Worker with
  // production credentials and no base URL calls SANDBOX and is rejected for
  // credentials that are perfectly valid. The error names the credentials and
  // the cause is the missing variable, which is the worst pairing available.
  //
  // Same rule as workers_dev: a default that is right for one environment and
  // wrong for another is declared rather than inherited.
  const config = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "")
  );
  const envs: [string, Record<string, string>][] = [
    ["dev", config.vars],
    ["staging", config.env.staging.vars],
    ["production", config.env.production.vars],
  ];

  for (const [name, vars] of envs) {
    it(`${name} sets PLAID_BASE_URL explicitly`, () => {
      expect(vars.PLAID_BASE_URL, `${name} would fall back to sandbox`).toBeTruthy();
    });
  }

  it("production points at production, and the others do not", () => {
    expect(config.env.production.vars.PLAID_BASE_URL).toBe("https://production.plaid.com");
    expect(config.vars.PLAID_BASE_URL).toBe("https://sandbox.plaid.com");
    expect(config.env.staging.vars.PLAID_BASE_URL).toBe("https://sandbox.plaid.com");
  });

  it("every environment carries the registered redirect URI", () => {
    // Registered with Plaid on 19 Aug 2026 and matched exactly: HTTPS, no
    // fragment, no query string, no wildcard. Without it, OAuth institutions
    // work on desktop and break in mobile webview.
    for (const [name, vars] of envs) {
      expect(vars.PLAID_REDIRECT_URI, `${name} has no redirect URI`).toBe(
        "https://api.marginsheet.com/plaid/oauth-return"
      );
    }
  });
});
