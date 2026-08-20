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
    // THIS TEST FIRED WHEN errorMessage WAS ADDED, WHICH IS THE CONTROL
    // WORKING. Publishing a new field is a DECISION, and this is what forces
    // somebody to make it deliberately rather than by widening a spread.
    //
    // errorMessage was added on 20 Aug 2026 after its absence cost a
    // diagnosis: Plaid's INVALID_FIELD names the offending field in
    // error_message and nowhere else. The seven-class capture had already
    // established that Plaid error bodies carry no credential, including in
    // the error whose subject is a bad secret, so the field it was withheld
    // to guard against does not exist.
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(REAL_ERROR_BODY), { status: 400 })
    );
    const error = (await callPlaid("/x", creds, { access_token: TOKEN }).catch((e) => e)) as PlaidError;
    expect(Object.keys(error.toJSON()).sort()).toEqual([
      "endpoint", "errorCode", "errorMessage", "errorType", "name", "requestId", "status",
    ]);
  });
});

describe("a Plaid error names the field it is complaining about", () => {
  it("publishes errorMessage, because INVALID_FIELD says which field there", () => {
    // WITHHELD UNTIL 20 AUG 2026, and the cost landed on the first real
    // diagnosis: a production link token failed with INVALID_FIELD and the
    // field name was the one thing not published.
    //
    // The guard was aimed at an error body echoing a credential. The
    // seven-class capture had already shown that does not occur, including in
    // the error whose entire subject is a bad secret. A guard aimed at a shape
    // that does not occur COSTS NOTHING UNTIL IT COSTS A DIAGNOSIS, and
    // produces no signal in between, which is why the study existing did not
    // cause anybody to revisit it.
    const error = new PlaidError("/link/token/create", 400, {
      error_type: "INVALID_REQUEST",
      error_code: "INVALID_FIELD",
      error_message: "redirect_uri must be registered in the dashboard",
      request_id: "req-1",
    });
    expect(error.toJSON().errorMessage).toBe("redirect_uri must be registered in the dashboard");
  });

  it("still publishes nothing beyond the enumerated fields", () => {
    // The enumeration is the control and it is unchanged: adding a field is a
    // decision, and a field nobody named is still excluded. This is what stops
    // the fix above from becoming a spread.
    const error = new PlaidError("/x", 400, {
      error_code: "C",
      error_message: "m",
      request_id: "r",
      // A field Plaid does not send today and might tomorrow.
      access_token: "access-production-LEAKED",
    });
    const published = JSON.stringify(error.toJSON());
    expect(published, "an unenumerated field reached the output").not.toContain("LEAKED");
    expect(Object.keys(error.toJSON()).sort()).toEqual([
      "endpoint", "errorCode", "errorMessage", "errorType", "name", "requestId", "status",
    ]);
  });
});
