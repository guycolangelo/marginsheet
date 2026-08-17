// The invitation endpoints (M3 task 3.5).
//
// Mounted in the same task that built the service, for the reason recorded in
// recovery-routes.ts: a service with no caller is a control that cannot fail.
// The sensitive-action enumeration now also enforces it, since creation is
// listed as built and a test fetches the route to prove it answers.
//
// THE LINK SPENDS NOTHING, the third time this ruling applies. A scanner
// following an invitation link must not consume it, or the invitee opens a dead
// invitation and the household is told they already joined.

import type { Sql } from "postgres";
import type { Auth } from "./auth.js";
import type { EmailSender } from "./email.js";
import { createInvitation, redeemInvitation, INVITATION_DAYS } from "./invitations.js";
import { withinRecentAuthWindow } from "./recent-auth.js";

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function escapeHtml(v: string): string {
  return v.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;")
    .split('"').join("&quot;").split("'").join("&#39;");
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface InvitationRouteEnv {
  sql: Sql;
  auth: Auth;
  mail: EmailSender;
  baseUrl: string;
}

export async function invitationRoutes(
  request: Request,
  url: URL,
  env: InvitationRouteEnv
): Promise<Response | null> {
  // GET the accept page. Spends nothing.
  if (url.pathname === "/household/invitations/accept" && request.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    const inner = token
      ? "<h1>You have been invited to a MarginSheet&trade; household</h1>" +
        `<p>Sign in to accept. This invitation works for ${INVITATION_DAYS} days.</p>` +
        '<form method="post" action="/household/invitations/accept">' +
        `<input type="hidden" name="token" value="${escapeHtml(token)}">` +
        "<button type=\"submit\">Accept and join</button></form>"
      : "<h1>This invitation link came through incomplete</h1>" +
        "<p>Some email apps shorten long links. Ask for a fresh one and it will work.</p>";
    return new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="referrer" content="no-referrer"><title>Join a household</title></head>` +
        `<body><main>${inner}</main></body></html>`,
      { status: token ? 200 : 400, headers: PAGE_HEADERS }
    );
  }

  // POST an invitation. SENSITIVE ACTION: recent-auth plus primary-only.
  if (url.pathname === "/household/invitations" && request.method === "POST") {
    const session = await env.auth.api.getSession({ headers: request.headers });
    if (!session?.session) {
      return Response.json({ status: "refused", reason: "not_signed_in" }, { status: 401 });
    }

    // Amendment 11. Checked here rather than inside createInvitation, because
    // recent-auth belongs to the sensitive-action layer and every action on
    // that list checks it the same way.
    const createdAt = (session.session as { createdAt?: unknown }).createdAt;
    const fresh = withinRecentAuthWindow({
      sessionCreatedAt:
        createdAt instanceof Date ? createdAt : createdAt ? new Date(String(createdAt)) : null,
    });
    if (!fresh.fresh) {
      return Response.json({ status: "refused", reason: "stale_auth" }, { status: 403 });
    }

    const [resolved] = await env.sql<{ household_id: string | null }[]>`
      select public.auth_household_id(${session.user.id}) as household_id
    `;
    if (!resolved?.household_id) {
      return Response.json({ status: "refused", reason: "no_member" }, { status: 403 });
    }
    await env.sql`select set_config('marginsheet.household_id', ${resolved.household_id}, true)`;

    const [actor] = await env.sql<{ id: string }[]>`
      select id from members where auth_user_id = ${session.user.id} limit 1
    `;
    if (!actor) {
      return Response.json({ status: "refused", reason: "no_member" }, { status: 403 });
    }

    const payload = await body(request);
    const result = await createInvitation(
      { sql: env.sql, mail: env.mail, baseUrl: env.baseUrl },
      actor.id,
      {
        name: String(payload.name ?? "").trim(),
        phone: String(payload.phone ?? ""),
        email: typeof payload.email === "string" ? payload.email : undefined,
      }
    );

    if (result.status === "refused") {
      return Response.json(result, { status: result.reason === "not_primary" ? 403 : 400 });
    }
    // The token is NOT returned to the caller. It is a bearer credential that
    // belongs in the invitee's inbox and nowhere else, and an API that echoes
    // it lets a compromised primary harvest invitations without delivery.
    return Response.json({ status: "invited" });
  }

  // POST the acceptance. The invitee holds a session and no member row.
  if (url.pathname === "/household/invitations/accept" && request.method === "POST") {
    const session = await env.auth.api.getSession({ headers: request.headers });
    if (!session?.session) {
      return Response.json({ status: "refused", reason: "not_signed_in" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    const token = contentType.includes("form-urlencoded")
      ? String((await request.formData()).get("token") ?? "")
      : String((await body(request)).token ?? "");

    const result = await redeemInvitation(env.sql, token, session.user.id);
    return Response.json(result, { status: result.status === "joined" ? 200 : 403 });
  }

  return null;
}
