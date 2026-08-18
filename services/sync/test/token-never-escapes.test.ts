// Invariant 7's behavioural half, AS AMENDED 18 Aug 2026.
//
// The probe was originally specified against Plaid's response: does Sentry
// scrubbing survive an error object carrying a token in a nested field. Seven
// error classes captured from Sandbox say Plaid produces no such shape. THE
// TOKEN IS IN THE REQUEST, so this points at OUR envelope instead.
//
// It forces a failure on a call that GENUINELY CARRIES A TOKEN and asserts the
// token appears in no thrown error, no serialised form of one, and nothing a
// logger or Sentry would receive.

import { describe, it, expect, vi, afterEach } from "vitest";
import { callPlaid, PlaidError } from "../src/plaid-client.js";

const TOKEN = "access-sandbox-de3ce8ef-33f8-452c-a685-8671031fc0f6";
const SECRET = "plaid-secret-value-that-must-not-escape";
const creds = { clientId: "client-id-value", secret: SECRET, baseUrl: "https://sandbox.plaid.com" };

/** Every way this error could reach a log, a report, or a human. */
const surfaces = (error: unknown) => [
  String(error),
  (error as Error).message,
  (error as Error).stack ?? "",
  JSON.stringify(error),
  // How Sentry and most loggers serialise a thrown object.
  JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
  JSON.stringify({ ...(error as object) }),
  Object.values(error as Record<string, unknown>).map(String).join(" "),
];

afterEach(() => vi.unstubAllGlobals());

/** The real Plaid envelope, captured from Sandbox rather than invented. */
const REAL_ERROR_BODY = {
  display_message: null,
  documentation_url: "https://plaid.com/docs/errors/item/#item_login_required",
  error_code: "ITEM_LOGIN_REQUIRED",
  error_message: "the login details of this item have changed",
  error_type: "ITEM_ERROR",
  request_id: "709d87607a2f4c0",
  suggested_action: null,
};

describe("a failed Plaid call leaks neither the token nor the secret", () => {
  it("throws without the token, on a real 400 envelope", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(REAL_ERROR_BODY), { status: 400 })
    );

    const error = await callPlaid("/transactions/sync", creds, { access_token: TOKEN }).catch((e) => e);
    expect(error).toBeInstanceOf(PlaidError);

    for (const surface of surfaces(error)) {
      expect(surface, "the access token escaped through a serialised error").not.toContain(TOKEN);
      expect(surface, "the Plaid secret escaped through a serialised error").not.toContain(SECRET);
    }
  });

  it("throws without the token when the TRANSPORT fails, which is the dangerous case", async () => {
    // fetch rejects with an error whose shape we do not control. Attaching it
    // as `cause` would hand the caller whatever the runtime put in it, and
    // some runtimes include the request. This is the postgres incident's shape:
    // a library formatting what you sent into an exception.
    vi.stubGlobal("fetch", async () => {
      const e = new Error(`connect ECONNREFUSED while POSTing {"access_token":"${TOKEN}"}`);
      throw e;
    });

    const error = await callPlaid("/transactions/sync", creds, { access_token: TOKEN }).catch((e) => e);
    for (const surface of surfaces(error)) {
      expect(surface, "a transport error carried the request body out").not.toContain(TOKEN);
    }
  });

  it("keeps Plaid's own diagnostic fields, so dropping the body costs nothing useful", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(REAL_ERROR_BODY), { status: 400 })
    );
    const error = (await callPlaid("/x", creds, { access_token: TOKEN }).catch((e) => e)) as PlaidError;
    expect(error.errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(error.errorType).toBe("ITEM_ERROR");
    expect(error.requestId).toBe("709d87607a2f4c0");
    expect(error.status).toBe(400);
  });

  it("toJSON enumerates, so a field added later is not published by default", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(REAL_ERROR_BODY), { status: 400 })
    );
    const error = (await callPlaid("/x", creds, { access_token: TOKEN }).catch((e) => e)) as PlaidError;
    expect(Object.keys(error.toJSON()).sort()).toEqual([
      "endpoint", "errorCode", "errorType", "name", "requestId", "status",
    ]);
  });
});
