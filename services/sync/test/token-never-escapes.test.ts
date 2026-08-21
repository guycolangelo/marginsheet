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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("the item-products route publishes products and no credential", () => {
  it("publishes the products and the difference, and nothing else", () => {
    // ENUMERATED, not spread. /item/get also returns the institution id, the
    // webhook, the error state and consent expiry, and none of that is what
    // this route is for. Same discipline as PlaidError.toJSON: name what may
    // be published so a field Plaid adds later is excluded by default.
    //
    // AND IT REPORTS THE DIFFERENCE, since 21 Aug 2026. Three raw arrays made
    // the finding visible only to a reader who already knew what we request:
    // both real Items reported consent to assets, identity, identity_match and
    // signal, and nothing in the output said those were unasked for. Declaring
    // the request and reporting the difference is the same shape as edge-rules
    // against the live Cloudflare zone, and it is what turns a dashboard
    // setting into something code review can see.
    const source = readFileSync(join(import.meta.dirname, "..", "src", "reconnect.ts"), "utf8");
    // BOUNDED BY THE NEXT DECLARATION, not by a brace. Two brace-based
    // boundaries were tried and both read the wrong region: the first "\n}"
    // landed inside a multi-line return TYPE once this function grew one, and
    // so did the first "}" at column zero, because a type annotation closes
    // with "}>" there. Both reported a missing field that was plainly present.
    //
    // FOURTH TIME A STRING-SLICED FIXTURE HAS READ THE WRONG REGION in two
    // days, after the purge test anchoring on a route name that also appears
    // in a condition list. THE LESSON IS THE BOUNDARY RATHER THAN THE BUG:
    // syntax that a regex can be fooled by is exactly what a source file is
    // made of, so the boundary has to be something structural that does not
    // recur inside what it bounds.
    const fn = source.slice(source.indexOf("export async function itemProducts"));
    const next = fn.indexOf("\nexport ", 1);
    const body = next > 0 ? fn.slice(0, next) : fn;
    expect(body.length, "the function could not be bounded, so this asserts nothing").toBeGreaterThan(200);
    expect(body).toMatch(/products: item\.item\.products/);
    expect(body).toMatch(/billedProducts: item\.item\.billed_products/);
    expect(body).toMatch(/consentedProducts: consented/);
    // BOTH DIRECTIONS. Consented-and-not-declared is reach nobody asked for;
    // declared-and-not-consented is a product we intend to use and were not
    // granted, which fails at the endpoint rather than here.
    expect(body, "the route no longer reports consent it never asked for").toMatch(/consentedButNotDeclared/);
    expect(body, "the route no longer reports a declared product that was refused").toMatch(/declaredButNotConsented/);
    // The whole item object must never be returned.
    expect(body, "the route spreads Plaid's item object").not.toMatch(/\.\.\.item\.item/);
  });

  it("scopes the lookup to the household", () => {
    // The row id is ours and cannot collide, so this is defence in depth
    // rather than a fix. It costs nothing to be correct without the policy.
    const source = readFileSync(join(import.meta.dirname, "..", "src", "reconnect.ts"), "utf8");
    const fn = source.slice(source.indexOf("export async function itemProducts"));
    expect(fn.slice(0, 1400)).toMatch(/where id = \$\{itemRowId\} and household_id = \$\{householdId\}/);
  });
});
