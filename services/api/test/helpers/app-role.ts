// Rotating marginsheet_app's password, and refusing to do it in the wrong place.
//
// WHY THIS EXISTS. On 16 Aug 2026 the role-rotating suites were run locally
// with DATABASE_URL pointed at the shared dev branch. They did what they are
// written to do: ALTER ROLE marginsheet_app LOGIN PASSWORD '<random>'. On the
// ephemeral pr-<n> branch CI uses, that role is branch-local and disposable.
// On dev it is the credential both deployed Workers hold, so dev's Workers
// began failing authentication and /health went 503 until the secret was
// reissued. Staging and production were untouched.
//
// THE FINDING, which generalises past this file. The guard that existed,
// AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE, gated the ACTION and not the TARGET. It
// asked "am I allowed to rotate" when the question that mattered was "am I
// allowed to rotate HERE". A permission to perform a destructive operation is
// not a permission to perform it in a particular place, and the operator who
// sets the flag is answering the first question while the damage is decided by
// the second. Any destructive operation guarded that way has the same hole.
//
// The workflow also carried a comment saying "Never point this at a long-lived
// branch". It was accurate, it was prominent, and it stopped nothing, because
// a comment is documentation and documentation is not a control.
//
// WHY AN ALLOWLIST, ruled by Guy 16 Aug 2026. The alternative was to resolve
// the endpoint host and refuse dev, staging and main. That is a blocklist, and
// a blocklist is wrong by default the moment a new long-lived branch exists:
// the branch nobody remembered to add is the one that gets rotated. Naming the
// target and refusing anything that is not pr-<n> fails closed on everything
// unanticipated instead. Same shape as the enumerated column grants in
// migrations 0002 and 0011, which list the columns the role may write rather
// than granting ALL and subtracting.
//
// RESIDUAL RISK, stated rather than implied: this trusts the caller's
// declaration of where they are pointed. Someone can still set
// NEON_TEST_BRANCH=pr-1 while DATABASE_URL points at dev. That is a deliberate
// false statement about the target rather than the accident this prevents,
// which was setting a permission flag that never mentioned a target at all.
// Verifying the declaration against Neon's branch endpoint would close it, and
// is not built.

import type postgres from "postgres";

/** Ephemeral CI branches, and nothing else, may have their role rotated. */
const EPHEMERAL_BRANCH = /^pr-\d+$/;

/** The variable naming WHERE these tests are pointed. CI sets it from the PR number. */
export const BRANCH_VAR = "NEON_TEST_BRANCH";

export class ForbiddenRotation extends Error {
  constructor(declared: string) {
    super(
      `REFUSING to rotate marginsheet_app: ${BRANCH_VAR} is ` +
        `${declared ? `"${declared}"` : "unset"}, and only an ephemeral pr-<n> ` +
        `branch may be rotated.\n` +
        `Rotating the role on a long-lived branch breaks every deployed Worker ` +
        `holding the previous password, which is what happened to dev on 16 Aug 2026.\n` +
        `If you need this locally, point DATABASE_URL at a PR branch and set ` +
        `${BRANCH_VAR} to its name.`
    );
    this.name = "ForbiddenRotation";
  }
}

/** Where the caller says these tests are pointed. Empty when nobody said. */
export function declaredBranch(): string {
  return (process.env[BRANCH_VAR] ?? "").trim();
}

/**
 * Whether the rotating suites can run at all. Both halves are required: a
 * database to talk to, and a target that is safe to break.
 */
export function canRotate(): boolean {
  return Boolean(process.env.DATABASE_URL) && EPHEMERAL_BRANCH.test(declaredBranch());
}

/**
 * Rotates marginsheet_app's password and returns a connection string for it.
 *
 * The refusal lives HERE, at the operation, rather than in each caller's skip
 * condition. Four files carried their own copy of this ALTER ROLE and their own
 * copy of the gate; a control that has to be remembered in four places is a
 * control that will be correct in three. A caller whose skip logic is wrong
 * still cannot rotate anything.
 */
/** The roles a suite may rotate. ALLOWLISTED, NEVER BLOCKLISTED: naming the
 *  two that exist fails closed on a third somebody adds later, which is the
 *  same shape as the enumerated column grants and the pr-<n> branch guard. */
const ROTATABLE = ["marginsheet_app", "marginsheet_sync"] as const;
export type RotatableRole = (typeof ROTATABLE)[number];

/**
 * THE REFUSAL LIVES HERE, NOT IN THE CALLER. Four test files once carried
 * their own ALTER ROLE and their own gate, and a control that must be
 * remembered in four places will be correct in three.
 */
export async function rotateRole(
  owner: ReturnType<typeof postgres>,
  ownerUrl: string,
  label: string,
  role: RotatableRole = "marginsheet_app"
): Promise<string> {
  const branch = declaredBranch();
  if (!EPHEMERAL_BRANCH.test(branch)) {
    // Thrown BEFORE the connection is used, so a refused call issues no SQL.
    throw new ForbiddenRotation(branch);
  }
  if (!ROTATABLE.includes(role)) {
    throw new ForbiddenRotation(`role ${role} is not rotatable`);
  }

  const password = `${label}_${crypto.randomUUID().replace(/-/g, "")}`;
  await owner.unsafe(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);

  const u = new URL(ownerUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

export async function rotateAppRole(
  owner: ReturnType<typeof postgres>,
  ownerUrl: string,
  label: string
): Promise<string> {
  return rotateRole(owner, ownerUrl, label, "marginsheet_app");
}

/**
 * A skipped suite reports green, which is how a rotating suite quietly stops
 * running and nobody finds out. Locally a skip is legitimate. In CI the
 * workflow sets both variables, so a skip there means the harness broke and
 * whatever the suite guards is unguarded. Call this OUTSIDE the skipped
 * describe block, or it skips too and proves nothing.
 */
export function assertNotSkippedInCI(expect: (v: unknown, m?: string) => { toBe(v: unknown): void }, suite: string): void {
  if (!process.env.CI) return;
  expect(canRotate(), `${suite} skipped in CI, so nothing it covers was checked`).toBe(true);
}
