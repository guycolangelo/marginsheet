// THE JOURNEY TEST for the emailed sign-in link (M3 task 3.2a).
//
// WHY THIS FILE EXISTS, stated plainly because the reason is the point.
//
// On 16 Aug 2026 eleven tests covering magic-link sign-in were passing while
// the link in a real email returned "Not found" to a real person. Every one of
// them reached past the link: they called confirmSignIn() directly, or POSTed
// to /auth/confirm, or drove auth.handler(). Not one of them fetched the URL
// out of the message that was sent. The action was proven and the journey
// never was, so the one thing a household actually does was the one thing
// nothing exercised.
//
// The rule that came out of it, now in CLAUDE.md: a journey test starts where
// the household starts. So this file starts at an email address and a request,
// takes the link out of the resulting message, and opens it the way a person
// opens it. It never imports confirmSignIn and never calls auth.handler().
//
// TWO SEAMS ARE DELIBERATE, and both are as close to real as this harness gets:
//
//   1. It enters through the WORKER'S ROUTER, not the auth handler. The 404
//      that started this was a routing failure, so a test that skips routing
//      cannot see it. Only Sentry's instrumentation wrapper is bypassed.
//   2. It reads the link out of the ACTUAL POSTMARK PAYLOAD, captured at the
//      network boundary. The real postmarkSender composes it. The link this
//      test clicks is the link Postmark would have delivered, byte for byte,
//      rather than one read back from an internal callback.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { router, type Env as WorkerEnv } from "../src/index.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = Boolean(OWNER_URL) && process.env.AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE === "1";

const BASE = "http://localhost:8787";

let env: WorkerEnv;
let owner: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const password = `journey_${crypto.randomUUID().replace(/-/g, "")}`;
  await owner.unsafe(`ALTER ROLE marginsheet_app LOGIN PASSWORD '${password}'`);
  const u = new URL(OWNER_URL!);
  u.username = "marginsheet_app";
  u.password = password;

  env = {
    NEON_DATABASE_URL: u.toString(),
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: BASE,
    // Present so the Worker builds the real postmarkSender. Nothing reaches
    // Postmark: the capture below intercepts at the network boundary.
    POSTMARK_TOKEN: "journey-test-token",
    AUTH_FROM_EMAIL: "accounts@marginsheet.com",
  };
});

afterAll(async () => {
  if (owner) await owner.end();
});

interface SentMessage {
  To: string;
  Subject: string;
  TextBody: string;
}

/**
 * Runs `body` with the Postmark endpoint intercepted, and returns every message
 * that would have been sent. Only api.postmarkapp.com is diverted; anything
 * else still goes to the real fetch. The database does not use fetch.
 */
async function capturingEmail(body: () => Promise<void>): Promise<SentMessage[]> {
  const real = globalThis.fetch;
  const sent: SentMessage[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.postmarkapp.com/")) {
      sent.push(JSON.parse(String(init?.body ?? "{}")) as SentMessage);
      return Response.json({ ErrorCode: 0, Message: "OK" });
    }
    return real(input as RequestInfo, init);
  }) as typeof fetch;

  try {
    await body();
  } finally {
    globalThis.fetch = real;
  }
  return sent;
}

/** Where a household starts: an address, and asking to sign in. */
async function askToSignIn(): Promise<SentMessage> {
  const email = `journey-${crypto.randomUUID()}@marginsheet.test`;
  const sent = await capturingEmail(async () => {
    const res = await router.fetch(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name: "Journey Probe" }),
      }),
      env
    );
    expect(res.status, `asking for a link failed: ${await res.text()}`).toBe(200);
  });

  expect(sent, "no email was sent, so there is no link to follow").toHaveLength(1);
  return sent[0];
}

/** The link exactly as it appears in the message, the way a person finds it. */
function linkFrom(message: SentMessage): string {
  const link = message.TextBody.split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("http"));
  expect(link, `the email carried no link:\n${message.TextBody}`).toBeTruthy();
  return link!;
}

/** Opens a URL through the Worker's router, as a browser would. */
function open(url: string, init?: RequestInit): Promise<Response> {
  return router.fetch(new Request(url, init), env);
}

// A skipped suite reports green, which is how a journey test quietly stops
// running and nobody finds out until a household does. Locally the skip is
// legitimate, since there may be no database to rotate a role on. In CI both
// variables are set by the workflow, so a skip there means the harness broke
// and the journey is unguarded. This is the assertion that says so.
it("is actually running, and did not skip itself in CI", () => {
  if (!process.env.CI) return;
  expect(
    configured,
    "the journey suite skipped in CI, so nothing checked the emailed link"
  ).toBe(true);
});

describe.skipIf(!configured)("the emailed sign-in link, followed", () => {
  it("opens a page instead of a dead end", async () => {
    const message = await askToSignIn();
    const link = linkFrom(message);

    const res = await open(link);

    // This is the assertion that was missing on 16 Aug. It failed as a 404
    // against a real inbox while eleven other tests were green.
    expect(
      res.status,
      `opening the emailed link returned HTTP ${res.status}. This is what the household sees first.`
    ).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
  });

  it("opening the link consumes nothing, so a scanner cannot burn it", async () => {
    const message = await askToSignIn();
    const link = linkFrom(message);
    const token = new URL(link).searchParams.get("token")!;

    // A corporate email security scanner follows links before the human does.
    // Two GETs stand in for the scanner and then the member.
    await open(link);
    await open(link);

    // The token must still be spendable afterwards. If opening the link
    // consumed it, the member's first experience of the product is a dead
    // link that looks like our bug, because it is.
    const confirmed = await open(`${BASE}/auth/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    expect(
      confirmed.status,
      "the token was already spent by opening the link, which is what the landing page exists to prevent"
    ).toBe(200);
    expect(confirmed.headers.get("set-cookie") ?? "").toContain("=");
  });

  it("carries the action that finishes the sign-in, pointed at the right place", async () => {
    const message = await askToSignIn();
    const link = linkFrom(message);
    const token = new URL(link).searchParams.get("token")!;

    const page = await open(link);
    const html = await page.text();

    // The page has to carry the token onward, or the action cannot spend it.
    expect(html, "the page does not carry the token, so its action cannot work").toContain(token);
    expect(html.toLowerCase()).toContain("/auth/confirm");
  });

  it("pressing the button on the page finishes the sign-in", async () => {
    const message = await askToSignIn();
    const page = await open(linkFrom(message));
    const html = await page.text();

    // Submit what the PAGE declares, not what the API is known to accept. If
    // the form's method, action or field name ever drifts from what the
    // endpoint reads, that is a broken button, and reading the values out of
    // the markup is the only way this test notices.
    const method = /<form[^>]*method="([^"]+)"/i.exec(html)?.[1] ?? "";
    const action = /<form[^>]*action="([^"]+)"/i.exec(html)?.[1] ?? "";
    const field = /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/i.exec(html);
    expect(field, "the page's form carries no field to submit").toBeTruthy();

    const submitted = await open(new URL(action, BASE).href, {
      method,
      // Exactly what a browser sends when a form is submitted by a person.
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html,application/xhtml+xml",
      },
      body: new URLSearchParams({ [field![1]]: field![2] }).toString(),
    });

    expect(submitted.status, "the button did not sign the household in").toBe(200);
    expect(
      submitted.headers.get("set-cookie") ?? "",
      "no session cookie came back, so the household is not actually signed in"
    ).toContain("=");
    // A person pressed a button in a browser, so a person gets a page back.
    expect(submitted.headers.get("content-type") ?? "").toContain("text/html");
    expect((await submitted.text()).toLowerCase()).toContain("signed in");
  });

  it("reads as confirmation rather than as an obstacle", async () => {
    // A copy requirement, ruled 15 Aug 2026, not a UI preference: a page that
    // looks like a challenge tells the member the product does not trust them.
    const message = await askToSignIn();
    const page = await open(linkFrom(message));
    const text = (await page.text()).toLowerCase();

    expect(text, "the page never names the action it wants").toMatch(/confirm|sign in|continue/);

    for (const obstacle of ["verify you are", "are you human", "suspicious", "denied", "invalid"]) {
      expect(text, `the page greets a first sign-in with "${obstacle}"`).not.toContain(obstacle);
    }
  });

  it("a link with no token explains itself and still consumes nothing", async () => {
    const res = await open(`${BASE}/auth/confirm`);

    // Not a 404 and not a 500. A truncated link is a normal thing for an email
    // client to produce, and the household reads whatever this says.
    expect(res.status, "a tokenless link falls through to the 404 handler").toBe(400);
    expect((await res.text()).toLowerCase()).toMatch(/link|sign in/);
  });

  it("does not leak the token to anywhere the page might reference", async () => {
    // The URL carries a live credential. Referrer-Policy is what stops it
    // travelling in a Referer header, and no-store is what keeps it out of
    // shared caches. Both are cheap and neither is recoverable after the fact.
    const message = await askToSignIn();
    const res = await open(linkFrom(message));

    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
  });
});
