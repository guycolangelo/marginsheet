// The control register, checked per PR (M3 task 3.6).
//
// The constitution asks of every control: if the thing this guards were
// completely broken, would this go red? Nine controls failed that question in
// two weeks. Answering "yes" is worth nothing, so the register answers it by
// NAMING the test that would fail, and this file checks the register is honest
// about what it names.
//
// It does NOT prove the tests are sensitive. That is the planted-failure
// harness's job, and it runs nightly, on demand, and automatically on any PR
// touching a test this register names. This file is the cheap half: it catches
// a register that points at a test which no longer exists, or a name that
// matches nothing, which is how a register rots into decoration.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const register = JSON.parse(
  readFileSync(join(ROOT, "config", "control-register.json"), "utf8")
) as {
  controls: {
    id: string;
    control: string;
    guards: string;
    test: string;
    name: string;
    status?: "owed";
    owedTo?: string;
    planted: { kind: "source" | "sql"; file?: string; find?: string; apply?: string };
  }[];
};

// An entry for a control that is DESIGNED but not yet BUILT. Registered rather
// than omitted, because an enumeration that silently omits what is not built is
// how unguarded things arrive later. Same shape as SENSITIVE_ACTIONS, where
// unbuilt actions carry built:false and a test asserts each has NO route.
const owed = register.controls.filter((c) => c.status === "owed");
const built = register.controls.filter((c) => c.status !== "owed");

describe("every registered control names a test that exists", () => {
  it("has controls at all, so this suite is not vacuous", () => {
    expect(register.controls.length).toBeGreaterThan(8);
  });

  for (const control of built) {
    it(`${control.id} points at a real test`, () => {
      const path = join(ROOT, control.test);
      expect(existsSync(path), `${control.test} does not exist`).toBe(true);

      // The -t filter must match something. A register naming a test that was
      // renamed would run zero tests and the harness would report a control as
      // "went red" when nothing ran at all.
      const body = readFileSync(path, "utf8");
      expect(
        body.includes(control.name),
        `${control.test} contains no test matching "${control.name}". The harness would run zero tests and read that as a pass.`
      ).toBe(true);
    });

    it(`${control.id} describes what it guards`, () => {
      expect(control.guards.length, `${control.id} does not say what it guards`).toBeGreaterThan(
        25
      );
    });
  }
});

describe("every planted failure is applicable", () => {
  for (const control of built.filter((c) => c.planted.kind === "source")) {
    it(`${control.id}'s mutation still applies to ${control.planted.file}`, () => {
      // The find text going missing means the control was refactored. The
      // register must then be updated rather than the entry deleted, and this
      // is where somebody finds that out.
      const source = readFileSync(join(ROOT, control.planted.file!), "utf8");
      expect(
        source.includes(control.planted.find!),
        `the mutation for ${control.id} no longer matches ${control.planted.file}. The control was probably refactored: update the register rather than dropping the entry.`
      ).toBe(true);
    });
  }

  for (const control of built.filter((c) => c.planted.kind === "sql")) {
    it(`${control.id} carries a proof query, so its mutation can be verified`, () => {
      // Non-negotiable per Guy: a harness that cannot prove it broke something
      // cannot prove the test noticed.
      expect(control.planted).toHaveProperty("proof");
      expect(control.planted).toHaveProperty("restore");
    });
  }
});

describe("no control is registered twice, and none is missing an id", () => {
  it("ids are unique", () => {
    const ids = register.controls.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("owed entries are honest about being owed", () => {
  it("there are some, or this suite is decoration", () => {
    // Not an assertion that owed entries must exist forever. If M4 closes all
    // of them this becomes a one-line edit, and the edit is the point at which
    // somebody confirms they were built rather than deleted.
    expect(owed.length).toBeGreaterThan(0);
  });

  for (const control of owed) {
    it(`${control.id} names what it is owed to`, () => {
      expect(control.owedTo, `${control.id} is owed to nobody in particular`).toBeTruthy();
    });

    // THE DIRECTION THAT MATTERS. An owed entry's test must NOT yet exist.
    // Writing it without clearing the status fails here, which sends the
    // author to the entry where the planted failure and the reasoning are
    // already written, rather than letting a built control keep an owed label
    // and never be exercised by the harness.
    it(`${control.id}'s test does not exist yet, so the status is true`, () => {
      expect(
        existsSync(join(ROOT, control.test)),
        `${control.test} EXISTS but ${control.id} is still marked owed. If the ` +
          `control was built, remove the status and the harness will start ` +
          `exercising it. An owed label on a built control is a control nobody runs.`
      ).toBe(false);
    });
  }
});
