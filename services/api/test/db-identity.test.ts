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
// WHY THIS IS NOT PART OF isolation.test.ts: that suite derives its own
// NEON_DATABASE_URL from neonctl as neondb_owner at job time and asks it
// `select 1`. It never reads the credential the Worker actually runs with, so
// it passed on every run while all six Worker secrets were empty and while no
// long-lived branch had a single table. It validates the credentials CI can
// derive; this file asks the running Worker what it actually is.
//
// No secrets. These are public endpoints returning two non-credential fields.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Addresses come from config/environments.json, never from a hostname pattern.
// A pattern is an assumption about deployment shape: on 16 Aug 2026 adding a
// custom domain made Cloudflare disable the workers.dev hostname, and this
// check went red against an address nobody reaches while production was
// healthy. The config is the one place an address is written down.
const ENVIRONMENTS = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "config", "environments.json"), "utf8")
) as Record<string, Record<string, string>>;

const HOSTS = Object.fromEntries(
  Object.entries(ENVIRONMENTS)
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, services]) => [name, Object.values(services)])
) as Record<string, string[]>;

// The application connects as this role, and only this role.
const EXPECTED_ROLE = "marginsheet_app";

// The response is allowed to carry these keys and nothing else.
const ALLOWED_KEYS = ["current_user", "bypassrls"] as const;

type Identity = { current_user?: unknown; bypassrls?: unknown };

// A check that goes red without saying why costs more than it saves. This
// called res.json() directly, so anything that was not JSON threw a parse
// error naming the first character of the response and nothing else. On
// 16 Aug 2026 that read `Unexpected token '<', "<!DOCTYPE "...` across three
// PRs while the endpoint answered correctly to every human who tried it, and
// the check could not say whether it had been served a Cloudflare challenge,
// a WAF block, a disabled hostname, or an origin error. Those are four
// different problems with four different owners.
//
// The failure now carries the status, the content type and the CF-Ray, which
// is enough to tell them apart without adding a temporary debugging step
// to CI. The parse failure itself is not the finding; what answered is.
async function identity(
  origin: string
): Promise<{ status: number; body: Identity; note: string }> {
  const url = `${origin}/debug/db-identity`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();

  try {
    return { status: res.status, body: JSON.parse(text) as Identity, note: "" };
  } catch {
    // Deliberately the first line only: an intercepting page is not ours and
    // may be arbitrarily large. The leak scan still runs over what we return.
    const firstLine = text.trim().split("\n")[0]?.slice(0, 120) ?? "";
    return {
      status: res.status,
      body: {},
      note:
        ` Did not answer with JSON, so something between CI and the Worker` +
        ` answered instead of the Worker.` +
        ` status=${res.status}` +
        ` content-type=${res.headers.get("content-type") ?? "<none>"}` +
        ` cf-ray=${res.headers.get("cf-ray") ?? "<none>"}` +
        ` first-line=${JSON.stringify(firstLine)}`,
    };
  }
}

describe.each(Object.entries(HOSTS))("db identity: %s", (env, origins) => {
  for (const host of origins) {
    it(`${host} connects as ${EXPECTED_ROLE} and holds no BYPASSRLS`, async () => {
      const { status, body, note } = await identity(host);

      expect(
        status,
        `${host} could not report its database identity: ${JSON.stringify(body)}${note}`
      ).toBe(200);

      // A 200 carrying a non-JSON body is the disguised case: the edge
      // intercepted and answered success on the Worker's behalf. Without this,
      // the assertions below would read an empty object and fail by naming the
      // wrong role rather than naming the interception.
      expect(note, `${host}:${note}`).toBe("");

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
