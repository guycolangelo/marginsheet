// The sensitive-action enumeration, checked in BOTH directions (3.4).
//
// §1 names four sensitive actions requiring recent-auth. One exists. The list in
// src/sensitive-actions.ts is the enforcement mechanism, and this file is what
// makes it one rather than a reference.
//
// TWO DIRECTIONS OF DRIFT, and the second was Guy's addition on 17 Aug 2026:
//
//   1. A sensitive route exists OUTSIDE the list. That is how a fifth action
//      arrives unguarded, added by somebody who never read §1.
//
//   2. An entry marked `built` is NOT REACHABLE. That is the other direction,
//      and it is not hypothetical: the §1 phone-change tightening was found to
//      have been nominally live for 2 days with no endpoint, because
//      mayChangePhone() decided correctly and had no callers. A list asserting
//      "built" about something unreachable repeats that exactly.
//
// Reachability is proven by FETCHING, not by scanning the router source. A
// mounted route answers something other than 404; a source scan proves a string
// appears in a file. The first is the claim being made.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BUILT_SENSITIVE_ACTIONS,
  NOT_SENSITIVE,
  SENSITIVE_ACTIONS,
  UNBUILT_SENSITIVE_ACTIONS,
} from "../src/sensitive-actions.js";
import { router, type Env as WorkerEnv } from "../src/index.js";

const SRC = join(import.meta.dirname, "..", "src");
const ORIGIN = "http://localhost:8787";

/**
 * A deliberately UNCONFIGURED environment.
 *
 * Reachability is about routing, not about the database. With no connection
 * string a mounted route answers 503 "not configured" and an unmounted one
 * answers 404, which is exactly the distinction being tested, and it needs no
 * Neon branch to make it.
 */
const unconfigured = { ENVIRONMENT: "dev" } as unknown as WorkerEnv;

function sources(): { file: string; text: string }[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));
}

function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("direction 1: no sensitive route exists outside the list", () => {
  it("every routed path that looks sensitive is enumerated", () => {
    // Paths the router actually mounts, pulled from the comparisons it makes.
    const routed = new Set<string>();
    for (const { text } of sources()) {
      for (const m of code(text).matchAll(/url\.pathname\s*===\s*"([^"]+)"/g)) {
        routed.add(m[1]);
      }
      for (const m of code(text).matchAll(/url\.pathname\.startsWith\("([^"]+)"\)/g)) {
        routed.add(m[1]);
      }
    }

    // What counts as sensitive by §1's own vocabulary. Deliberately broad: a
    // false positive costs somebody a list entry, a false negative costs the
    // recent-auth defence on an action that moves money or access.
    const SENSITIVE_SHAPES = [/phone/i, /cancel/i, /\bexport\b/i, /members?\/|removal/i, /invit/i];
    const enumerated = new Set([
      ...SENSITIVE_ACTIONS.map((a) => a.path),
      ...NOT_SENSITIVE.map((e) => e.path),
    ]);

    const unlisted = [...routed].filter(
      (p) => SENSITIVE_SHAPES.some((re) => re.test(p)) && !enumerated.has(p)
    );

    expect(
      unlisted,
      "a route that looks like a sensitive action is not in SENSITIVE_ACTIONS. §1 requires recent-auth on phone change, cancellation, member removal and export. Add it to the list, or explain in the list why it is not one."
    ).toEqual([]);
  });

  it("every exclusion carries a reason, because that list is where care leaks", () => {
    // The scan found /auth/recovery/phone on its first run, which is the list
    // working: it forced a decision instead of an assumption. The bar for an
    // exclusion is that the action CANNOT require recent-auth, not that it
    // would be inconvenient.
    for (const e of NOT_SENSITIVE) {
      expect(e.why.length, `${e.path} is excluded without a reason`).toBeGreaterThan(80);
    }
  });

  it("the scan can actually see routed paths, so its silence means something", () => {
    // Without this, "nothing unlisted" is indistinguishable from a scan that
    // finds no routes at all.
    const routed = new Set<string>();
    for (const { text } of sources()) {
      for (const m of code(text).matchAll(/url\.pathname\s*===\s*"([^"]+)"/g)) routed.add(m[1]);
    }
    expect(routed.size, "the router scan found no paths at all").toBeGreaterThan(3);
    expect(routed).toContain("/auth/phone");
  });
});

describe("direction 2: every BUILT entry is actually reachable", () => {
  it("has at least one built entry, so this suite is not vacuous", () => {
    expect(BUILT_SENSITIVE_ACTIONS.length).toBeGreaterThan(0);
  });

  for (const action of BUILT_SENSITIVE_ACTIONS) {
    it(`${action.name} (${action.method} ${action.path}) is mounted and answers`, async () => {
      const res = await router.fetch(
        new Request(`${ORIGIN}${action.path}`, {
          method: action.method,
          headers: { "content-type": "application/json" },
          body: action.method === "GET" ? undefined : "{}",
        }),
        unconfigured
      );

      // 404 is the failure. It means the list claims this action is built while
      // nothing routes it, which is the shape found on 17 Aug: a control that
      // decided correctly and had no callers.
      expect(
        res.status,
        `${action.path} answered 404, so SENSITIVE_ACTIONS claims it is built while nothing routes it. That is a control with no caller, which cannot go red however broken it is.`
      ).not.toBe(404);
    });
  }
});

describe("the unbuilt entries stay explicitly empty", () => {
  it("carries all four of §1's actions, built or not", () => {
    // An enumeration that omits what has not been built is how three unguarded
    // endpoints arrive in six months.
    // Five since amendment 11 added invitation creation to §1's four.
    expect(SENSITIVE_ACTIONS).toHaveLength(5);
    expect(SENSITIVE_ACTIONS.map((a) => a.name).sort()).toEqual([
      "cancellation",
      "export",
      "invitation creation",
      "member removal",
      "phone change",
    ]);
  });

  it("every unbuilt entry names an owner and a reason", () => {
    for (const action of UNBUILT_SENSITIVE_ACTIONS) {
      expect(action.owner, `${action.name} has no owner`).toBeTruthy();
      expect(action.why.length, `${action.name} does not say why it is sensitive`).toBeGreaterThan(
        30
      );
    }
  });

  for (const action of UNBUILT_SENSITIVE_ACTIONS) {
    it(`${action.name} has NO route yet, so it cannot ship unguarded`, async () => {
      // The mirror of direction 2. If somebody builds the route and forgets to
      // flip `built`, this fails and they have to come here, where the
      // recent-auth requirement is written down.
      const res = await router.fetch(
        new Request(`${ORIGIN}${action.path.replace(":id", "probe")}`, {
          method: action.method,
          headers: { "content-type": "application/json" },
          body: action.method === "GET" ? undefined : "{}",
        }),
        unconfigured
      );

      expect(
        res.status,
        `${action.path} now routes, but SENSITIVE_ACTIONS still says built: false. Flip it and confirm recent-auth guards it: §1 requires the 10-minute window on this action.`
      ).toBe(404);
    });
  }
});
