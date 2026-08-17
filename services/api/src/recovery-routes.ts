// The recovery endpoints (M3 task 3.1b).
//
// WHY THESE ARE MOUNTED IN THE SAME TASK THAT BUILT THE SERVICE. On 17 Aug
// 2026 the §1 phone-change tightening was found to have been nominally live
// for 2 days with no endpoint: `mayChangePhone()` had no caller, so no
// request could reach it and the control could not have gone red however
// broken it was. Shipping recovery.ts without routes would repeat that exactly.
// A service with no caller is a control that cannot fail.
//
// THE LINK SPENDS NOTHING, same ruling as the sign-in link (15 Aug 2026).
// Corporate email security scanners follow links before the human does. A
// recovery link that marked its half on GET would have that half met by a
// scanner, which is half of a two-factor recovery completed by a robot.
// Opening it renders a page; an explicit action marks the half.

import type { Sql } from "postgres";
import type { Auth } from "./auth.js";
import type { EmailSender } from "./email.js";
import type { OtpSender } from "./otp.js";
import {
  RECOVERY_MINUTES,
  meetEmailHalf,
  meetPhoneHalf,
  registerPasskeyFromGrant,
  requestRecovery,
  type RecoveryDeps,
} from "./recovery.js";

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function page(title: string, body: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${title}</title></head><body><main>${body}</main></body></html>`,
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface RecoveryRouteEnv {
  sql: Sql;
  auth: Auth;
  mail: EmailSender;
  otp: OtpSender;
  baseUrl: string;
  rpId: string;
  origin: string;
}

/** Returns a Response when the path is a recovery route, or null otherwise. */
export async function recoveryRoutes(
  request: Request,
  url: URL,
  env: RecoveryRouteEnv
): Promise<Response | null> {
  const deps: RecoveryDeps = env;

  // GET /auth/recovery: the page the emailed link opens. Spends nothing.
  if (url.pathname === "/auth/recovery" && request.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    if (!token) {
      return new Response(
        page(
          "Finish recovering your account",
          "<h1>This recovery link came through incomplete</h1>" +
            "<p>Some email apps shorten long links. Ask for a fresh one and it will work.</p>"
        ),
        { status: 400, headers: PAGE_HEADERS }
      );
    }
    return new Response(
      page(
        "Recover your account",
        "<h1>Confirm this is you</h1>" +
          `<p>Confirm below, then enter the code we texted you. Both are needed, and both work for ${RECOVERY_MINUTES} minutes.</p>` +
          '<form method="post" action="/auth/recovery/email">' +
          `<input type="hidden" name="token" value="${escapeHtml(token)}">` +
          '<button type="submit">Confirm and continue</button></form>'
      ),
      { status: 200, headers: PAGE_HEADERS }
    );
  }

  // POST /auth/recovery: opens a challenge and sends both halves.
  if (url.pathname === "/auth/recovery" && request.method === "POST") {
    const { email } = await body(request);
    if (typeof email === "string" && email.trim()) {
      await requestRecovery(deps, email.trim().toLowerCase());
    }
    // ALWAYS the same answer. Recovery is the endpoint an attacker probes
    // first, and a different response for a known address enumerates accounts.
    return Response.json({ status: "sent_if_known" });
  }

  // POST /auth/recovery/email: the explicit action that marks the email half.
  if (url.pathname === "/auth/recovery/email" && request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    const token = contentType.includes("form-urlencoded")
      ? String((await request.formData()).get("token") ?? "")
      : String((await body(request)).token ?? "");

    const met = await meetEmailHalf(deps, token);
    // Signs nobody in, deliberately. This is one half of two.
    return Response.json({ status: met ? "half_met" : "refused" }, { status: met ? 200 : 400 });
  }

  // POST /auth/recovery/phone: marks the phone half, bound to THIS challenge.
  if (url.pathname === "/auth/recovery/phone" && request.method === "POST") {
    const { token, code } = await body(request);
    const met = await meetPhoneHalf(deps, token, String(code ?? ""));
    return Response.json({ status: met ? "half_met" : "refused" }, { status: met ? 200 : 400 });
  }

  // POST /auth/recovery/passkey: spends the grant on a credential, and only on
  // a credential. The session is issued after the row exists, never before.
  if (url.pathname === "/auth/recovery/passkey" && request.method === "POST") {
    const { token, response, name } = await body(request);
    const result = await registerPasskeyFromGrant(
      deps,
      token,
      response,
      typeof name === "string" ? name : undefined
    );
    if (!result.ok) {
      return Response.json({ status: "refused", reason: result.reason }, { status: 403 });
    }

    const res = Response.json({ status: "recovered" });
    res.headers.append(
      "set-cookie",
      `better-auth.session_token=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=Lax${
        env.origin.startsWith("https") ? "; Secure" : ""
      }`
    );
    return res;
  }

  return null;
}
