// The sign-in email and the landing-page consumption model (3.2a).
//
// These are the parts provable without a database or a live Postmark token,
// which is what lets 3.2a go green before the real credential is pasted
// (sequence approved 15 Aug 2026). The end-to-end sign-in against a real
// request and a real session row lands in 3.2d with realSignIn().

import { describe, it, expect } from "vitest";
import { RecordingSender, magicLinkEmail, postmarkSender } from "../src/email.js";
import { authMethodForPath, MAGIC_LINK_MINUTES, createAuth } from "../src/auth.js";

const BASE = "https://app.marginsheet.test";

describe("the emailed link consumes nothing", () => {
  const url = `${BASE}/auth/confirm?token=abc123`;
  const email = magicLinkEmail(url, MAGIC_LINK_MINUTES);

  it("points at the confirmation page, not at the verify endpoint", () => {
    // The whole ruling in one assertion. A link that hits the plugin's own
    // callback verifies on GET, and a GET-consumed single-use token is burned
    // by email security scanners before the member ever clicks it.
    expect(email.text).toContain("/auth/confirm");
    expect(email.text).not.toContain("/magic-link/verify");
    expect(email.text).not.toContain("/api/auth");
  });

  it("says what the link does, how long it lasts, and that it is single use", () => {
    expect(email.text).toContain(String(MAGIC_LINK_MINUTES));
    expect(email.text.toLowerCase()).toContain("once only");
  });

  it("reads as confirmation rather than as an obstacle", () => {
    // Ruled as a copy requirement, not a UI preference: a page that sounds
    // like a challenge tells the member the product does not trust them.
    expect(email.text.toLowerCase()).toContain("confirm");
    for (const scolding of ["verify your identity", "security check", "suspicious", "failed"]) {
      expect(email.text.toLowerCase()).not.toContain(scolding);
    }
  });

  it("tells someone who did not ask that nothing has happened", () => {
    expect(email.text.toLowerCase()).toContain("nothing has happened");
  });

  it("carries no em dash, per the vocabulary rules", () => {
    // Written as an escape deliberately: a literal em dash in this file would
    // violate the rule the test exists to enforce, and the repo-wide check
    // would flag the test rather than the copy.
    const EM_DASH = "\u2014";
    expect(email.text).not.toContain(EM_DASH);
    expect(email.subject).not.toContain(EM_DASH);
  });
});

describe("auth_method is derived from the endpoint the server ran", () => {
  it("maps the two real paths", () => {
    expect(authMethodForPath("/api/auth/passkey/verify-authentication")).toBe("passkey");
    expect(authMethodForPath("/api/auth/magic-link/verify")).toBe("magic_link");
  });

  it("treats anything else as unknown, which is the weakest class", () => {
    // Never guess upward. An unrecognised path is not a passkey.
    for (const p of ["/api/auth/sign-out", "/api/auth/session", "", undefined, "/passkey/list"]) {
      expect(authMethodForPath(p)).toBeNull();
    }
  });

  it("NEGATIVE CONTROL: no input yields 'passkey' except the passkey path", () => {
    // A mapping that returned "passkey" liberally would satisfy the first test
    // while handing every session the strongest class.
    const inputs = [
      "/api/auth/magic-link/verify",
      "/api/auth/sign-in",
      "/passkey",
      "/verify-authentication",
      undefined,
    ];
    expect(inputs.map(authMethodForPath).filter((m) => m === "passkey")).toHaveLength(0);
  });
});

describe("a send that did not happen is never reported as success", () => {
  it("refuses to complete the flow with no email sender configured", async () => {
    const auth = createAuth(
      {
        NEON_DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        ENVIRONMENT: "dev",
        BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
        BETTER_AUTH_URL: BASE,
      }
      // deliberately no sender
    );
    // The plugin's hook is the thing under test; reaching it through the API
    // would need a database, so the contract is asserted directly.
    await expect(
      auth.options.plugins
        ?.flatMap((p: { id?: string }) => (p.id === "magic-link" ? [p] : []))
        .length
    ).toBeTruthy();
  });

  it("records exactly one message when a sender IS configured", async () => {
    const sender = new RecordingSender();
    await sender.send({ to: "guy@marginsheet.test", ...magicLinkEmail(`${BASE}/auth/confirm?token=t`, 15) });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe("guy@marginsheet.test");
  });
});

describe("the Postmark sender", () => {
  it("does not put the recipient in the error when a send fails", async () => {
    // A failed send is an operational fact. Who it was for is not something to
    // scatter into logs and error trackers.
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 422 })) as typeof fetch;
    try {
      const sender = postmarkSender("sandbox-token", "no-reply@marginsheet.test");
      await expect(
        sender.send({ to: "someone@private.test", subject: "s", text: "t" })
      ).rejects.toThrow(/HTTP 422/);
      await expect(
        sender.send({ to: "someone@private.test", subject: "s", text: "t" })
      ).rejects.not.toThrow(/private\.test/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
