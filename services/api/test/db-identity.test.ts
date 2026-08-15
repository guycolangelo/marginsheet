// The application's database identity, asserted against the live edge.
//
// WHY THIS EXISTS: every Worker's NEON_DATABASE_URL was issued for
// neondb_owner in Task 0.3. That role holds BYPASSRLS, which supersedes even
// FORCE ROW LEVEL SECURITY, so the application would have read past every
// household_isolation policy. M1 recorded that as the `rls-not-forced` debt
// and assigned it to M3. This is the check that closes it, and the check that
// keeps it closed.
//
// It asserts the POSITIVE, not merely the absence. A check that only tests
// "not neondb_owner" passes for any wrong role, including one that does not
// exist yet, and including an empty credential that never connected at all.
// On 15 Aug 2026 all six secrets held the empty string, because a broken pipe
// delivered nothing and `wrangler secret put` stored it without complaint.
// Every environment reported healthy throughout. Nothing failed, because
// nothing was asking.
//
// No secrets. These are public endpoints returning two non-credential fields.

import { describe, it, expect } from "vitest";

const HOSTS = {
  dev: ["marginsheet-api-dev", "marginsheet-conversation-dev"],
  staging: ["marginsheet-api-staging", "marginsheet-conversation-staging"],
  production: ["marginsheet-api", "marginsheet-conversation"],
} as const;

const ZONE = "guy-a84.workers.dev";

// The application connects as this role, and only this role.
const EXPECTED_ROLE = "marginsheet_app";

// The response is allowed to carry these keys and nothing else.
const ALLOWED_KEYS = ["current_user", "bypassrls"] as const;

type Identity = { current_user?: unknown; bypassrls?: unknown };

async function identity(host: string): Promise<{ status: number; body: Identity }> {
  const res = await fetch(`https://${host}.${ZONE}/debug/db-identity`, {
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: (await res.json()) as Identity };
}

describe.each(Object.entries(HOSTS))("db identity: %s", (env, hosts) => {
  for (const host of hosts) {
    it(`${host} connects as ${EXPECTED_ROLE} and holds no BYPASSRLS`, async () => {
      const { status, body } = await identity(host);

      expect(
        status,
        `${host} could not report its database identity: ${JSON.stringify(body)}`
      ).toBe(200);

      // The positive assertion. Not "not the owner" - this role specifically.
      expect(
        body.current_user,
        `${host} connects as ${String(body.current_user)}, not ${EXPECTED_ROLE}`
      ).toBe(EXPECTED_ROLE);

      // And the property that made the swap necessary in the first place.
      expect(
        body.bypassrls,
        `${host} connects as a role holding BYPASSRLS, which supersedes every RLS policy`
      ).toBe(false);
    });

    it(`${host} leaks nothing credential-shaped`, async () => {
      const { status, body } = await identity(host);
      const serialized = JSON.stringify(body);

      // The shape scan runs unconditionally: a 503 body must be as clean as a
      // 200 body, since a misconfigured environment is exactly where a
      // connection string is most likely to end up in an error message.
      for (const shape of ["://", "password", "sslmode", "@ep-"]) {
        expect(serialized, `${host} response contains "${shape}"`).not.toContain(shape);
      }

      // Guy's condition on shipping this endpoint to production: on success it
      // returns the role name and the flag, and nothing else. The 503 shape is
      // checked above rather than here, so a broken environment reports one
      // failure (it is broken) instead of two.
      if (status === 200) {
        for (const key of Object.keys(body)) {
          expect(
            ALLOWED_KEYS as readonly string[],
            `${host} returned unexpected key "${key}"`
          ).toContain(key);
        }
      }
    });
  }
});

describe("the check can actually fail", () => {
  // Negative control. The assertion above is only worth something if these
  // shapes are rejected. Each of these passed the weaker "not neondb_owner"
  // formulation, which is why that formulation was not used.
  const rejected: Array<[string, Identity]> = [
    ["the owner role", { current_user: "neondb_owner", bypassrls: true }],
    ["a role that does not exist yet", { current_user: "marginsheet_reader", bypassrls: false }],
    ["a typo in the role name", { current_user: "marginsheet_apps", bypassrls: false }],
    ["the right role holding BYPASSRLS", { current_user: EXPECTED_ROLE, bypassrls: true }],
    ["an unreachable database", {}],
  ];

  it.each(rejected)("rejects %s", (_label, body) => {
    const passes = body.current_user === EXPECTED_ROLE && body.bypassrls === false;
    expect(passes).toBe(false);
  });

  it("accepts only the one correct shape", () => {
    const body: Identity = { current_user: EXPECTED_ROLE, bypassrls: false };
    expect(body.current_user === EXPECTED_ROLE && body.bypassrls === false).toBe(true);
  });
});
