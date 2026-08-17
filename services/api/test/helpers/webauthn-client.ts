// What a browser does on a WebAuthn call, in one place (M3 task 3.1a).
//
// A session cookie is not enough to exercise the passkey path. Two other
// things happen in a browser that have to happen here too, and BOTH ARE
// BROWSER BEHAVIOURS RATHER THAN WORKAROUNDS (ruled by Guy, 17 Aug 2026).
//
//   1. THE ORIGIN HEADER. @better-auth/passkey computes the origin it expects
//      the attestation to carry straight off the request:
//
//          const origin = options?.origin || ctx.headers?.get("origin") || "";
//
//      With no Origin header it compares against the empty string. Every
//      browser sends this header on a WebAuthn call; a Request built by hand
//      does not.
//
//   2. THE SIGNED CHALLENGE COOKIE. The options call mints a verification
//      token, sets it as a SIGNED cookie on its response, and stores the
//      challenge in `verification` keyed by that token. The verify call reads
//      the cookie back to find the challenge. A browser stores and returns it
//      without being asked.
//
// !!! READ THIS BEFORE "FIXING" A FAILURE HERE. !!!
//
// Dropping either one makes a test FAIL, not pass, and the failure reads like
// a broken authenticator: "Failed to verify registration" for a missing
// Origin, "Challenge not found" for a missing cookie. Neither message points
// at the harness, which is what makes the next step dangerous.
//
// The tempting fix is to set `origin` in the passkey plugin options, because
// the plugin checks THAT FIRST and the header stops mattering. The suite goes
// green and nothing ever checks that the browser's origin matched the
// attestation. THAT is the version which passes while testing something no
// browser does. If a WebAuthn test fails, the question is what this client is
// failing to send, never what the server can be configured to stop asking for.
//
// This helper adds nothing that mints a session. realSignIn() remains the only
// source of one, and this consumes what it produces.

import type { SoftwareAuthenticator } from "./authenticator.js";
import type { Auth } from "../../src/auth.js";

/** Better Auth's inferred api surface, narrowed to what a ceremony needs. */
type PasskeyApi = Auth["api"];

/** Better Auth's api.* methods return this shape when returnHeaders is set. */
interface WithHeaders {
  headers?: Headers;
  response?: unknown;
}

/** The first cookie pair from a Set-Cookie value, as a browser would store. */
function cookiePair(setCookie: string | null | undefined): string {
  return (setCookie ?? "").split(";")[0] ?? "";
}

function unwrap<T>(call: WithHeaders | T): T {
  return ((call as WithHeaders)?.response ?? call) as T;
}

export interface BrowserOptions {
  /** The origin a browser would be on. Must match the authenticator's. */
  origin: string;
  /** A real product-issued session cookie, or none for an anonymous login. */
  sessionCookie?: string;
}

/**
 * Drives one WebAuthn ceremony the way a browser drives it: request options,
 * keep the cookie they set, answer the challenge, return the cookie with the
 * answer.
 */
export class BrowserWebAuthnClient {
  constructor(private readonly opts: BrowserOptions) {}

  /** Headers for a call that carries only the session, plus Origin. */
  headers(extraCookie?: string): Headers {
    const cookies = [this.opts.sessionCookie, extraCookie].filter(Boolean).join("; ");
    const h = new Headers({ origin: this.opts.origin });
    if (cookies) h.set("cookie", cookies);
    return h;
  }

  /**
   * Registration, end to end. Returns whatever the server returned so a caller
   * can assert on it, and throws exactly as the server does on refusal.
   */
  async register(
    api: PasskeyApi,
    device: SoftwareAuthenticator,
    name = "Test Device"
  ): Promise<unknown> {
    const call = (await (api.generatePasskeyRegistrationOptions as (a: unknown) => Promise<unknown>)({
      headers: this.headers(),
      returnHeaders: true,
    })) as WithHeaders;

    const options = unwrap<{ challenge: string }>(call);
    const challengeCookie = cookiePair(call.headers?.get("set-cookie"));

    return (api.verifyPasskeyRegistration as (a: unknown) => Promise<unknown>)({
      headers: this.headers(challengeCookie),
      body: { response: device.register(String(options.challenge)), name },
    });
  }

  /**
   * Login, end to end. No session cookie is required or used: this ceremony is
   * how a session gets issued in the first place.
   *
   * `tamper` exists for the negative control, so a forged assertion travels
   * the identical path as a good one and the only difference is the signature.
   */
  async login(
    api: PasskeyApi,
    device: SoftwareAuthenticator,
    tamper = false
  ): Promise<{ result: unknown; sessionCookie: string }> {
    const call = (await (api.generatePasskeyAuthenticationOptions as (a: unknown) => Promise<unknown>)({
      headers: new Headers({ origin: this.opts.origin }),
      returnHeaders: true,
    })) as WithHeaders;

    const options = unwrap<{ challenge: string }>(call);
    const challenge = String(options.challenge);
    const challengeCookie = cookiePair(call.headers?.get("set-cookie"));

    const assertion = tamper ? device.forgeBadSignature(challenge) : device.authenticate(challenge);

    const verified = (await (api.verifyPasskeyAuthentication as (a: unknown) => Promise<unknown>)({
      headers: new Headers({ origin: this.opts.origin, cookie: challengeCookie }),
      body: { response: assertion },
      returnHeaders: true,
    })) as WithHeaders;

    return {
      result: unwrap(verified),
      // Taken from Set-Cookie, never constructed. Same contract as realSignIn.
      sessionCookie: cookiePair(verified.headers?.get("set-cookie")),
    };
  }
}
