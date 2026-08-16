// The §1 tightening, as pure logic. The endpoint-level proof lands with the
// minimal phone-change endpoint; this pins the decision table itself, which is
// where an implementation would go wrong quietly.

import { describe, it, expect } from "vitest";
import { mayChangePhone, isPasskeySession } from "../src/auth-guard.js";

describe("the three cases §1 requires", () => {
  it("REFUSES a phone change behind a magic-link session when a passkey exists", () => {
    // The control. This is the SIM-swap path being closed.
    const d = mayChangePhone({ sessionAuthMethod: "magic_link", memberHasPasskey: true });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("passkey_required");
  });

  it("ALLOWS the same change behind a passkey session", () => {
    // Proof the control is not simply blocking everything.
    expect(mayChangePhone({ sessionAuthMethod: "passkey", memberHasPasskey: true }).allowed).toBe(
      true
    );
  });

  it("ALLOWS a magic-link session when the member has NO passkey", () => {
    // Guy: "the one that matters". Without this case, refusing every
    // magic-link phone change passes the two above while locking out every
    // member who has not registered a passkey. §1 makes magic link the weaker
    // path, not an excluded one.
    expect(
      mayChangePhone({ sessionAuthMethod: "magic_link", memberHasPasskey: false }).allowed
    ).toBe(true);
  });
});

describe("unknown provenance is the weakest class, never the strongest", () => {
  it("treats a NULL auth_method as not-a-passkey", () => {
    // Sessions predating migration 0014. Defaulting the other way would mean
    // every pre-existing session silently satisfied the tightening.
    expect(isPasskeySession(null)).toBe(false);
    expect(mayChangePhone({ sessionAuthMethod: null, memberHasPasskey: true }).allowed).toBe(false);
  });

  it("still allows a NULL session when the member has no passkey", () => {
    // Weakest class, not "denied". The rule is conditional on a stronger
    // credential existing.
    expect(mayChangePhone({ sessionAuthMethod: null, memberHasPasskey: false }).allowed).toBe(true);
  });
});

describe("NEGATIVE CONTROL: the guard is not returning a constant", () => {
  it("produces both outcomes across the input space", () => {
    // A guard that always allowed, or always refused, would pass some of the
    // assertions above. This requires it to actually discriminate.
    const inputs: Array<[import("../src/auth-guard.js").AuthMethod, boolean]> = [
      ["passkey", true],
      ["passkey", false],
      ["magic_link", true],
      ["magic_link", false],
      [null, true],
      [null, false],
    ];
    const results = inputs.map(([m, has]) =>
      mayChangePhone({ sessionAuthMethod: m, memberHasPasskey: has }).allowed
    );
    expect(results).toContain(true);
    expect(results).toContain(false);
    // Exactly the two refusing cases: a passkey exists and the session is not one.
    expect(results.filter((r) => !r)).toHaveLength(2);
  });
});
