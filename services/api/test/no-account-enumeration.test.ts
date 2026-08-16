// The sign-in send endpoint reveals nothing about whether an account exists.
//
// WHY THIS IS PART OF 3.2e. Rate limiting per email caps how often one address
// can be mailed. It does nothing about an attacker walking a list of addresses
// one request each, and that attack is only worth mounting if the endpoint
// answers differently for a registered address than an unregistered one. Guy
// asked for this to be verified rather than assumed (16 Aug 2026), because
// per-email limits do not touch enumeration and the whole per-source half of
// the design rests on what this endpoint gives away.
//
// WHAT COUNTS AS GIVING IT AWAY. Not just the status code. A different body, a
// different error shape, or a reliably different response time are all oracles.
// The timing assertion here is deliberately loose: it is a smoke check for an
// order-of-magnitude difference (a database write on one path and an early
// return on the other), not a constant-time proof, and it is written not to
// flake on a shared CI runner. A tight timing assertion on a noisy box is a
// test that fails for reasons nobody can act on.
//
// WHAT THE PROPERTY ACTUALLY RESTS ON, so a future change cannot remove it by
// accident. There is no oracle today because signup happens on first use: an
// unrecognised address creates a user and is sent a link, so both paths do the
// same work and return the same bytes. Setting Better Auth's `disableSignUp`
// would make an unregistered address answer differently and hand an attacker
// exactly the oracle this file exists to deny. These assertions fail if anyone
// does, which is the point of measuring it rather than reasoning about it.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { createAuth, type AuthEnv } from "../src/auth.js";
import { RecordingSender } from "../src/email.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

let env: AuthEnv;
let owner: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "enum");
  env = {
    NEON_DATABASE_URL: appUrl,
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: "http://localhost:8787",
  };
});

afterAll(async () => {
  if (owner) await owner.end();
});

interface Answer {
  status: number;
  body: string;
  sent: number;
  ms: number;
}

async function askForLink(email: string): Promise<Answer> {
  const mail = new RecordingSender();
  const auth = createAuth(env, mail);
  const started = performance.now();
  const res = await auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Enumeration Probe" }),
    })
  );
  const body = await res.text();
  return { status: res.status, body, sent: mail.sent.length, ms: performance.now() - started };
}

/** An address that has asked for a link before, so a user row exists. */
async function registered(): Promise<string> {
  const email = `known-${crypto.randomUUID()}@marginsheet.test`;
  await askForLink(email);
  return email;
}

const unregistered = () => `never-seen-${crypto.randomUUID()}@marginsheet.test`;

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the account-enumeration suite");
});

describe.skipIf(!configured)("the send endpoint answers the same either way", () => {
  it("returns the same status for a registered and an unregistered address", async () => {
    const known = await askForLink(await registered());
    const unknown = await askForLink(unregistered());

    expect(
      unknown.status,
      `an unregistered address answers ${unknown.status} and a registered one ${known.status}, which enumerates accounts`
    ).toBe(known.status);
  });

  it("returns the same body for both, byte for byte", async () => {
    const known = await askForLink(await registered());
    const unknown = await askForLink(unregistered());

    expect(
      unknown.body,
      `the bodies differ, which enumerates accounts:\n  registered:   ${known.body}\n  unregistered: ${unknown.body}`
    ).toBe(known.body);
  });

  it("sends an email in both cases, so delivery is not the tell either", async () => {
    // If one path sent and the other did not, an attacker with any view of
    // delivery (a catch-all domain, a bounce, a shared mailbox) learns the
    // same fact the response refused to give them.
    const known = await askForLink(await registered());
    const unknown = await askForLink(unregistered());

    expect(known.sent).toBe(1);
    expect(unknown.sent).toBe(1);
  });

  it("SMOKE: no order-of-magnitude timing difference between the two paths", { timeout: 30_000 }, async () => {
    // Loose on purpose. See the header: this catches "one path writes a user
    // and the other returns early", not a timing side channel.
    const rounds = 3;
    const knownTimes: number[] = [];
    const unknownTimes: number[] = [];

    for (let i = 0; i < rounds; i++) {
      knownTimes.push((await askForLink(await registered())).ms);
      unknownTimes.push((await askForLink(unregistered())).ms);
    }

    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const ratio = median(knownTimes) / median(unknownTimes);

    expect(
      ratio,
      `registered median ${Math.round(median(knownTimes))}ms vs unregistered ${Math.round(median(unknownTimes))}ms`
    ).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(5);
  });

  it("NEGATIVE CONTROL: these assertions can tell two responses apart", async () => {
    // Without this, "the responses match" is indistinguishable from the
    // comparison being broken. A deliberately malformed request must differ.
    const auth = createAuth(env, new RecordingSender());
    const bad = await auth.handler(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      })
    );
    const good = await askForLink(unregistered());

    expect(bad.status).not.toBe(good.status);
  });
});
