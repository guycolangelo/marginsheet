// Magic-link send limits, proven by exceeding them (M3 task 3.2e).
//
// Every assertion here drives the limiter until it refuses. None of them read
// config and assert a number matches, because that tests arithmetic rather
// than a control: a limiter wired to nothing passes a config comparison.
//
// The limits themselves come from config/rate-limits.json rather than from
// constants, so the values a reviewer sees are the values that run. The tests
// pass their OWN limits, deliberately: pinning assertions to production's
// numbers would make a legitimate limit change a test failure, and the
// behaviour under test is "it refuses past the limit", not "the limit is 3".
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import {
  MAGIC_LINK,
  limitsFor,
  recordSendIfPermitted,
  type KindLimits,
} from "../src/send-limits.js";
import shippedConfig from "../../../config/rate-limits.json";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "limits");
  app = postgres(appUrl, { max: 1 });
});

afterAll(async () => {
  if (owner) await owner.end();
  if (app) await app.end();
});

const address = () => `limit-${crypto.randomUUID()}@marginsheet.test`;

/** Small windows so a test can fill them without waiting. */
const limits = (perEmail: number, global = 10_000): KindLimits => ({
  per_email: { max: perEmail, window_seconds: 900 },
  global: { max: global, window_seconds: 900 },
});

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the send-limits suite");
});

describe.skipIf(!configured)("the per-email limit refuses past its maximum", () => {
  it("allows exactly the maximum, then refuses", async () => {
    const email = address();
    const configuredLimits = limits(3);

    for (let i = 1; i <= 3; i++) {
      const decision = await recordSendIfPermitted(app, email, configuredLimits);
      expect(decision.allowed, `send ${i} of 3 was refused before the limit`).toBe(true);
    }

    const beyond = await recordSendIfPermitted(app, email, configuredLimits);
    expect(beyond.allowed, "the fourth send was allowed past a limit of 3").toBe(false);
    expect(beyond).toEqual({ allowed: false, reason: "per_email" });
  });

  it("does not spend one address's budget on another", async () => {
    // Without this, a limiter that counted globally would pass every
    // assertion above while locking out every household at once.
    const configuredLimits = limits(2);
    const first = address();
    await recordSendIfPermitted(app, first, configuredLimits);
    await recordSendIfPermitted(app, first, configuredLimits);
    expect((await recordSendIfPermitted(app, first, configuredLimits)).allowed).toBe(false);

    const second = address();
    expect(
      (await recordSendIfPermitted(app, second, configuredLimits)).allowed,
      "a different address was refused because of the first one's attempts"
    ).toBe(true);
  });

  it("a refused send is not recorded, so a refusal cannot extend the block", async () => {
    const email = address();
    const configuredLimits = limits(1);
    await recordSendIfPermitted(app, email, configuredLimits);

    for (let i = 0; i < 5; i++) await recordSendIfPermitted(app, email, configuredLimits);

    const [{ count }] = await app<{ count: string }[]>`
      select count(*) as count from auth_send_attempts
       where kind = ${MAGIC_LINK} and subject = ${email}
    `;
    expect(
      Number(count),
      "refused attempts were recorded, so hammering the endpoint would extend the lockout"
    ).toBe(1);
  });

  it("only counts attempts inside the window", async () => {
    // Proven by moving the row's clock rather than by waiting, the same way
    // magic-link expiry is proven.
    const email = address();
    const configuredLimits = limits(1);
    expect((await recordSendIfPermitted(app, email, configuredLimits)).allowed).toBe(true);
    expect((await recordSendIfPermitted(app, email, configuredLimits)).allowed).toBe(false);

    // Moved with the OWNER connection, because the application role holds no
    // UPDATE on this table by design. Discovering that here rather than
    // assuming it is the reason the negative control below exists.
    await owner`
      update auth_send_attempts
         set created_at = now() - make_interval(secs => ${configuredLimits.per_email.window_seconds + 60})
       where subject = ${email}
    `;

    expect(
      (await recordSendIfPermitted(app, email, configuredLimits)).allowed,
      "an attempt older than the window still counted, so the limit never lifts"
    ).toBe(true);
  });
});

describe.skipIf(!configured)("the ledger cannot be rewritten by the application", () => {
  it("NEGATIVE CONTROL: the app role cannot move an attempt's timestamp", async () => {
    // A role that could rewrite created_at could rewrite its own way past
    // every limit above, so 0017 grants SELECT, INSERT and DELETE and no
    // UPDATE. This attempts the forbidden write rather than reading the grant.
    // It was found by the window test failing, not by reasoning.
    const email = address();
    await recordSendIfPermitted(app, email, limits(3));

    await expect(
      app`update auth_send_attempts set created_at = now() where subject = ${email}`
    ).rejects.toThrow(/permission denied/i);
  });

  it("but the app role can still insert and count, so the grant is surgical", async () => {
    const email = address();
    expect((await recordSendIfPermitted(app, email, limits(3))).allowed).toBe(true);
    const [{ count }] = await app<{ count: string }[]>`
      select count(*) as count from auth_send_attempts where subject = ${email}
    `;
    expect(Number(count)).toBe(1);
  });
});

describe.skipIf(!configured)("the global ceiling is a cost backstop", () => {
  it("refuses once the ceiling is reached, whatever the address", async () => {
    // The runaway-loop case: every send is to a different address, so the
    // per-email limit never fires and only the ceiling stands between a bug
    // and the Postmark bill.
    const [{ count: before }] = await app<{ count: string }[]>`
      select count(*) as count from auth_send_attempts
       where kind = ${MAGIC_LINK} and created_at > now() - make_interval(secs => 900)
    `;
    const ceiling = Number(before) + 3;
    const configuredLimits: KindLimits = {
      per_email: { max: 100, window_seconds: 900 },
      global: { max: ceiling, window_seconds: 900 },
    };

    for (let i = 0; i < 3; i++) {
      expect((await recordSendIfPermitted(app, address(), configuredLimits)).allowed).toBe(true);
    }

    const beyond = await recordSendIfPermitted(app, address(), configuredLimits);
    expect(beyond, "a fresh address was allowed past the global ceiling").toEqual({
      allowed: false,
      reason: "global",
    });
  });
});

describe.skipIf(!configured)("it fails closed", () => {
  it("refuses when the ledger cannot be reached", async () => {
    // The property that matters most. A limiter that answers "allowed" when
    // its store is down is an unlimited send endpoint at exactly the moment
    // the system is least healthy.
    const unreachable = postgres("postgresql://nobody:nobody@127.0.0.1:1/none", {
      max: 1,
      connect_timeout: 1,
      idle_timeout: 1,
    });
    try {
      const decision = await recordSendIfPermitted(unreachable, address(), limits(3));
      expect(decision, "an unreachable ledger allowed the send").toEqual({
        allowed: false,
        reason: "unavailable",
      });
    } finally {
      await unreachable.end({ timeout: 1 }).catch(() => {});
    }
  });
});

describe("the shipped config is usable by every environment", () => {
  // No database needed. This is the one place reading config is right: a
  // missing environment throws at request time in production otherwise, and
  // that is a worse place to find out.
  for (const environment of ["dev", "staging", "production"]) {
    it(`${environment} has both limits, and they are positive`, () => {
      const found = limitsFor(environment, shippedConfig);
      expect(found.per_email.max).toBeGreaterThan(0);
      expect(found.per_email.window_seconds).toBeGreaterThan(0);
      expect(found.global.max).toBeGreaterThan(0);
      expect(found.global.window_seconds).toBeGreaterThan(0);
    });
  }

  it("a sign-in link cannot outlive its own per-email window", () => {
    // If the window were shorter than a link's 15 minutes, a household could
    // hold several live links at once and the limit would cap nothing useful.
    const found = limitsFor("production", shippedConfig);
    expect(found.per_email.window_seconds).toBeGreaterThanOrEqual(15 * 60);
  });

  it("throws for an environment it has never heard of", () => {
    expect(() => limitsFor("qa", shippedConfig)).toThrow(/no magic_link limits configured/);
  });
});
