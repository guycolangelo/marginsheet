// The derivation every Worker's health block uses.
//
// One statement of what should be present, examined by two checks asking
// different questions: secret-inventory asks Cloudflare which NAMES exist, and
// this asks the running Worker which are NON-EMPTY. Neither reads its
// expectation from the thing it checks.

import { describe, it, expect } from "vitest";
import { requiredSecrets, secretPresence } from "../src/required-secrets.js";

describe("requiredSecrets derives from the declaration", () => {
  it("knows every Worker and environment that is declared", () => {
    for (const worker of ["api", "conversation", "sync"]) {
      for (const environment of ["dev", "staging", "production"]) {
        expect(requiredSecrets(worker, environment).length).toBeGreaterThan(0);
      }
    }
  });

  it("FAILS CLOSED on an environment nobody declared", () => {
    // An empty list would look like success while verifying nothing, which is
    // the failure this whole layer exists to prevent.
    expect(() => requiredSecrets("api", "nonexistent")).toThrow(/declares no secrets/);
    expect(() => requiredSecrets("nonexistent", "production")).toThrow(/declares no secrets/);
  });

  it("production api declares the auth secrets, which is the case that prompted this", () => {
    expect(requiredSecrets("api", "production")).toContain("BETTER_AUTH_SECRET");
  });
});

describe("secretPresence reports booleans and nothing else", () => {
  it("is false for an empty string, which is the whole point", () => {
    expect(
      secretPresence("sync", "production", {
        NEON_DATABASE_URL: "postgres://real",
        TOKEN_ENCRYPTION_KEY: "",
      })
    ).toEqual({ NEON_DATABASE_URL: true, TOKEN_ENCRYPTION_KEY: false });
  });

  it("is false for a missing value as well as an empty one", () => {
    expect(secretPresence("sync", "production", { NEON_DATABASE_URL: "x" }).TOKEN_ENCRYPTION_KEY).toBe(false);
  });

  it("leaks no part of any value", () => {
    const secret = "super-secret-signing-key-value";
    const presence = secretPresence("sync", "production", {
      NEON_DATABASE_URL: secret,
      TOKEN_ENCRYPTION_KEY: secret,
    });
    expect(JSON.stringify(presence)).not.toContain(secret);
    expect(Object.values(presence).every((v) => typeof v === "boolean")).toBe(true);
  });
});
