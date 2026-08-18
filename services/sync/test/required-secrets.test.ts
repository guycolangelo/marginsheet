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
