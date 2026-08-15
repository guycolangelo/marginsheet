// The invariant's test suite: no credential material survives the scrubber.

import { describe, it, expect } from "vitest";
import { scrubEvent } from "../src/sentry-scrub.js";

describe("sentry scrubber", () => {
  it("scrubs Plaid access tokens wherever they appear", () => {
    const event = {
      message: "sync failed for access-production-abc123-def4-5678-9abc-def012345678",
      extra: { item: "access-sandbox-11112222-3333-4444-5555-666677778888" },
    };
    const out = scrubEvent(event);
    expect(JSON.stringify(out)).not.toMatch(/access-(sandbox|production)-[0-9a-f-]{6,}/);
    expect(out.message).toContain("[scrubbed]");
  });

  it("scrubs connection strings and Neon passwords", () => {
    const out = scrubEvent({
      breadcrumbs: [
        { message: "connecting postgresql://neondb_owner:npg_AbC123@ep-x.neon.tech/marginsheet" },
      ],
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain("postgresql://");
    expect(s).not.toContain("npg_");
  });

  it("scrubs provider keys by shape", () => {
    const out = scrubEvent({
      extra: {
        a: "sk-ant-api03-XXXX-YYYY",
        b: "sk_test_notreal99",
        c: "whsec_8f2a9b",
        d: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
      },
    });
    const s = JSON.stringify(out);
    for (const fragment of ["sk-ant-", "sk_test_", "whsec_", "eyJhbGciOiJIUzI1NiJ9"]) {
      expect(s).not.toContain(fragment);
    }
  });

  it("redacts sensitive keys entirely, case-insensitive", () => {
    const out = scrubEvent({
      request: {
        headers: {
          Authorization: "Basic dXNlcjpwYXNz",
          "X-Api-Key": "abc123",
          Cookie: "session=deadbeef",
          "content-type": "application/json",
        },
      },
    });
    const headers = out.request.headers as Record<string, string>;
    expect(headers.Authorization).toBe("[scrubbed]");
    expect(headers["X-Api-Key"]).toBe("[scrubbed]");
    expect(headers.Cookie).toBe("[scrubbed]");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("redacts network identity and geolocation headers", () => {
    const out = scrubEvent({
      request: {
        headers: {
          "CF-Connecting-IP": "203.0.113.47",
          "cf-connecting-ipv6": "2001:db8::1",
          "X-Forwarded-For": "203.0.113.47, 198.51.100.2",
          "True-Client-IP": "203.0.113.47",
          "Cf-Ipcountry": "US",
          "CF-IPCity": "Tampa",
          "Cf-Ray": "a2b9c188ba5ff456",
          Accept: "*/*",
        },
      },
    });
    const headers = out.request.headers as Record<string, string>;
    for (const key of [
      "CF-Connecting-IP",
      "cf-connecting-ipv6",
      "X-Forwarded-For",
      "True-Client-IP",
      "Cf-Ipcountry",
      "CF-IPCity",
    ]) {
      expect(headers[key], key).toBe("[scrubbed]");
    }
    // Diagnostics that carry no identity survive.
    expect(headers["Cf-Ray"]).toBe("a2b9c188ba5ff456");
    expect(headers.Accept).toBe("*/*");
    expect(JSON.stringify(out)).not.toContain("203.0.113.47");
  });

  it("drops the user context entirely, however it is populated", () => {
    const withIp = scrubEvent({
      message: "boom",
      user: { ip_address: "2a06:98c0:3600::103", id: "hh_123", email: "a@b.co" },
    });
    expect("user" in withIp).toBe(false);
    expect(JSON.stringify(withIp)).not.toContain("2a06:98c0");

    const autoIp = scrubEvent({ message: "boom", user: { ip_address: "{{auto}}" } });
    expect("user" in autoIp).toBe(false);

    // An event with no user context is untouched.
    expect(scrubEvent({ message: "boom" })).toEqual({ message: "boom" });
  });

  it("preserves event shape and non-sensitive content", () => {
    const event = {
      message: "boom",
      tags: { environment: "staging" },
      values: [1, 2, 3],
      nested: { ok: true, note: null },
    };
    expect(scrubEvent(event)).toEqual(event);
  });
});
