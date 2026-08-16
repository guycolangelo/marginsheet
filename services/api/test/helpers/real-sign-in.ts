// realSignIn(): the ONLY place a test obtains a session (M3 task 3.2d).
//
// WHY IT EXISTS. Passkey registration and the layer 1 network-identity proof
// both need a session. The obvious shortcut is internalAdapter.createSession,
// and Guy ruled it out: a test that mints a session through internalAdapter is
// testing a session the product never issues. Driving those flows against a
// session that came from a real sign-in over a real endpoint is more faithful,
// not merely more convenient.
//
// THE CONTRACT, asserted in real-sign-in.test.ts rather than trusted:
//   1. it drives a real HTTP request through the auth handler
//   2. it returns the cookie taken from a Set-Cookie RESPONSE HEADER
//   3. it never fabricates one
//
// Three separate concerns depend on this one seam. If sign-in changes and this
// helper quietly degrades, the contract test fails and names it, rather than
// three unrelated tests passing against sessions nobody could obtain.

import { createAuth, type AuthEnv } from "../../src/auth.js";
import { RecordingSender } from "../../src/email.js";

export interface SignedIn {
  cookie: string;
  setCookieHeader: string;
  sessionToken: string;
  email: string;
  response: Response;
}

export interface SignInOptions {
  userAgent?: string;
  clientIp?: string;
}

export async function realSignIn(env: AuthEnv, opts: SignInOptions = {}): Promise<SignedIn> {
  const mail = new RecordingSender();
  const auth = createAuth(env, mail);
  const email = `signin-${crypto.randomUUID()}@marginsheet.test`;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.userAgent) headers["user-agent"] = opts.userAgent;
  if (opts.clientIp) {
    // Both, deliberately. Better Auth's default is x-forwarded-for and
    // Cloudflare supplies cf-connecting-ip; sending only one could make an IP
    // look absent for the wrong reason.
    headers["x-forwarded-for"] = opts.clientIp;
    headers["cf-connecting-ip"] = opts.clientIp;
  }

  const requested = await auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, name: "Sign In Probe" }),
    })
  );
  if (!requested.ok) {
    throw new Error(`magic link request failed: HTTP ${requested.status} ${await requested.text()}`);
  }

  const sent = mail.sent.at(0);
  if (!sent) throw new Error("no email was sent, so there is no token to confirm");
  const link = sent.text.split("\n").find((l) => l.startsWith("http"));
  if (!link) throw new Error("the email carried no link");
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error("the emailed link carried no token");

  // A separate request, because the emailed link consumes nothing.
  const response = await auth.handler(
    new Request(
      `${env.BETTER_AUTH_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
      { method: "GET", headers, redirect: "manual" }
    )
  );

  const setCookieHeader = response.headers.get("set-cookie") ?? "";
  if (!setCookieHeader) {
    throw new Error(
      `sign-in returned no Set-Cookie (HTTP ${response.status}). realSignIn will not fabricate one.`
    );
  }
  const cookie = setCookieHeader.split(";")[0];
  const sessionToken = decodeURIComponent(cookie.split("=").slice(1).join("=")).split(".")[0];

  return { cookie, setCookieHeader, sessionToken, email, response };
}
