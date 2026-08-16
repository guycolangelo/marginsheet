// The rotation guard, proven by attempting the forbidden operation.
//
// This file needs no database, deliberately. A guard that can only be tested
// against the thing it protects is a guard nobody runs, and this one has to
// hold on a laptop pointed anywhere. It uses a recording stand-in for the
// connection so it can assert the strongest property available: a refused
// rotation issues NO SQL AT ALL. "It threw" and "it threw before touching the
// database" are different claims, and only the second one is worth having.

import { describe, it, expect, afterEach } from "vitest";
import {
  BRANCH_VAR,
  ForbiddenRotation,
  canRotate,
  declaredBranch,
  rotateAppRole,
} from "./helpers/app-role.js";

const OWNER_URL = "postgresql://neondb_owner:pw@ep-probe-123.us-east-2.aws.neon.tech/marginsheet";

/** Records every statement instead of executing one. */
function recordingConnection() {
  const statements: string[] = [];
  const conn = {
    unsafe: async (sql: string) => {
      statements.push(sql);
      return [];
    },
  };
  return { conn, statements };
}

const original = process.env[BRANCH_VAR];
afterEach(() => {
  if (original === undefined) delete process.env[BRANCH_VAR];
  else process.env[BRANCH_VAR] = original;
});

function pointedAt(branch: string | undefined) {
  if (branch === undefined) delete process.env[BRANCH_VAR];
  else process.env[BRANCH_VAR] = branch;
}

describe("rotation is refused anywhere that is not an ephemeral PR branch", () => {
  // The three that broke dev, plus the shapes that would sneak past a
  // careless check. "main" is included because it is production.
  const forbidden = [
    ["dev", "the branch that actually broke on 16 Aug 2026"],
    ["staging", "a long-lived branch"],
    ["main", "production"],
    ["", "nobody declared a target"],
    ["   ", "whitespace is not a declaration"],
    ["pr-", "the prefix without a number"],
    ["pr-abc", "a number is required"],
    ["PR-51", "case matters, so a near miss is still a miss"],
    ["pr-51-old", "a suffix does not make it the PR branch"],
    ["notpr-51", "the prefix must start the name"],
    ["dev pr-51", "naming a PR branch does not launder the real target"],
  ] as const;

  for (const [branch, why] of forbidden) {
    it(`refuses "${branch}" (${why}), and issues no SQL`, async () => {
      pointedAt(branch);
      const { conn, statements } = recordingConnection();

      await expect(
        rotateAppRole(conn as never, OWNER_URL, "probe")
      ).rejects.toBeInstanceOf(ForbiddenRotation);

      // The assertion that matters. A guard that throws after running the
      // ALTER has already broken whatever it was pointed at.
      expect(statements, `a refused rotation still issued SQL: ${statements.join("; ")}`).toEqual(
        []
      );
      expect(canRotate()).toBe(false);
    });
  }

  it("refuses when the variable is absent entirely", async () => {
    pointedAt(undefined);
    const { conn, statements } = recordingConnection();
    await expect(rotateAppRole(conn as never, OWNER_URL, "probe")).rejects.toBeInstanceOf(
      ForbiddenRotation
    );
    expect(statements).toEqual([]);
  });
});

describe("rotation is permitted on an ephemeral PR branch", () => {
  // Without this the guard could refuse everything and every test above would
  // still pass, which is a control that cannot succeed rather than one that
  // cannot fail. Both directions or neither.
  for (const branch of ["pr-1", "pr-51", "pr-1234"]) {
    it(`allows "${branch}" and rotates exactly once`, async () => {
      pointedAt(branch);
      const { conn, statements } = recordingConnection();

      const url = await rotateAppRole(conn as never, OWNER_URL, "probe");

      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain("ALTER ROLE marginsheet_app LOGIN PASSWORD");
      expect(declaredBranch()).toBe(branch);

      // The returned string is the app role's, not the owner's. Handing back
      // an owner URL would restore the BYPASSRLS problem the whole role split
      // exists to remove.
      expect(new URL(url).username).toBe("marginsheet_app");
      expect(url.startsWith("postgresql://marginsheet_app:")).toBe(true);
    });
  }

  it("never reuses a password between rotations", async () => {
    pointedAt("pr-51");
    const a = recordingConnection();
    const b = recordingConnection();

    const first = await rotateAppRole(a.conn as never, OWNER_URL, "probe");
    const second = await rotateAppRole(b.conn as never, OWNER_URL, "probe");

    expect(first).not.toBe(second);
    expect(a.statements[0]).not.toBe(b.statements[0]);
  });

  it("the password never appears in the statement as a bare label", async () => {
    // Cheap check that the label is a prefix and not the whole secret.
    pointedAt("pr-51");
    const { conn, statements } = recordingConnection();
    await rotateAppRole(conn as never, OWNER_URL, "probe");
    expect(statements[0]).not.toContain("'probe'");
  });
});
