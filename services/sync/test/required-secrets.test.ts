// The Worker's required-secret list is the declaration, not a copy of it.
//
// The first version hand-wrote all four names in index.ts, and production went
// red on the Plaid pair, which is deferred to task 4.5b and legitimately
// absent. Two hand-maintained statements of one requirement, disagreeing on
// their first contact with reality.

import { describe, it, expect } from "vitest";
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
    expect(
      source.includes('from "../../../config/worker-secrets.json"'),
      "index.ts no longer derives its required secrets from the declaration"
    ).toBe(true);
  });

  it("production legitimately declares fewer secrets than dev", () => {
    // The case that caused the failure, asserted so nobody 'fixes' it by
    // adding the Plaid pair to production before Guy's 4.5b paste session.
    expect(declaration.workers.sync.production).not.toContain("PLAID_CLIENT_ID");
    expect(declaration.workers.sync.dev).toContain("PLAID_CLIENT_ID");
  });

  it("every environment declares the two secrets sync cannot work without", () => {
    for (const [environment, names] of Object.entries(declaration.workers.sync)) {
      expect(names, `sync/${environment} must hold a database URL`).toContain("NEON_DATABASE_URL");
      expect(names, `sync/${environment} must hold the encryption key`).toContain("TOKEN_ENCRYPTION_KEY");
    }
  });
});
