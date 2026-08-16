// POST /auth/confirm: the action that actually spends a sign-in token.
//
// The emailed link consumes nothing (ruled 15 Aug 2026). It opens a page, and
// that page's explicit action calls this. Email security scanners issue GETs
// and do not press buttons, so the token survives them, and a member's first
// experience is not a dead link.
//
// WHY THIS WRAPS BETTER AUTH RATHER THAN BEING IT. Better Auth refuses a spent
// token, full stop. That is correct for a stranger and wrong for the member
// who just clicked their own link twice, which is ordinary behaviour: being
// told "this link has been used" while you are already signed in reads as
// broken.
//
// THE RULE, and why it is safe:
//
//   token valid            -> spend it, issue the session          (row 1)
//   token spent, caller
//     already has a
//     valid session        -> land them in it, no error            (row 2)
//   token spent, no
//     valid session        -> refuse                               (row 3)
//   token expired          -> refuse, never silently reissue       (row 4)
//
// Row 2 does NOT verify that this session belongs to whoever spent this
// particular token, and it does not need to. The caller already holds a valid
// session, so they gain nothing they did not already have: no new cookie is
// issued and no state changes. Someone presenting a stranger's spent token
// while holding their own session is told they are signed in, as themselves.
//
// The boundary that matters is row 3, and it is untouched: a spent token with
// no session gets nothing. Convenience for a double click stops exactly where
// it would become a replay.

import type { Auth } from "./auth.js";
import { MAGIC_LINK_MINUTES } from "./auth.js";
import { confirmPage, incompleteLinkPage, signedInPage, spentLinkPage } from "./confirm-page.js";
import { readSignInToken } from "./tokens.js";

export type ConfirmOutcome =
  | { status: "signed_in" }
  | { status: "already_signed_in" }
  | { status: "refused"; reason: "used_or_expired" };

// The page's URL carries a live credential, so it is kept out of Referer
// headers and out of any shared cache. Neither is recoverable after the fact.
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/**
 * GET /auth/confirm: renders the page and spends NOTHING.
 *
 * This handler is the whole point of task 3.2a's rework. It did not exist on
 * 16 Aug 2026: /auth/confirm was mounted for POST only, so a real magic-link
 * email delivered a link that answered "Not found" while eleven tests covering
 * the POST action were green. The action had been built and the page it was
 * supposed to complete never had been.
 *
 * It deliberately does not look the token up. Validating here would mean
 * reporting on a token this request is not spending, and the page has nothing
 * useful to say about it: whether it still works is decided at the moment the
 * action fires, not at the moment the page loads.
 */
export function confirmLandingPage(request: Request): Response {
  const token = new URL(request.url).searchParams.get("token") ?? "";

  if (!token) {
    // 400, not 404. The route exists and the request reached it; what arrived
    // was incomplete. A 404 here would send someone hunting for a broken link
    // when the link was fine and their mail client truncated it.
    return new Response(incompleteLinkPage(), { status: 400, headers: PAGE_HEADERS });
  }

  return new Response(confirmPage(token, MAGIC_LINK_MINUTES), { status: 200, headers: PAGE_HEADERS });
}

/**
 * The token arrives as JSON from a programmatic caller or as a form encoding
 * from the page's button. Both are read, because the page uses a plain HTML
 * form: a first sign-in is the worst moment to require JavaScript.
 */
async function readToken(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const form = await request.formData();
      const value = form.get("token");
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }

  try {
    const body = (await request.json()) as { token?: unknown };
    return typeof body.token === "string" ? body.token : "";
  } catch {
    return "";
  }
}

/**
 * A browser submitting the form wants a page; a fetch() caller wants JSON. The
 * four-row outcome table below is identical either way, and only the rendering
 * differs. Existing callers send JSON and no Accept header, so they keep the
 * JSON they were written against.
 */
function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

export async function confirmSignIn(
  auth: Auth,
  request: Request,
  baseUrl: string
): Promise<Response> {
  const html = wantsHtml(request);

  // The sign-in consumer, purpose baked in (3.2c). This runs BEFORE any
  // lookup, so an invitation or a recovery half presented here is refused
  // because it is not a sign-in token, never because it happens to be absent
  // from `verification`. Storage separation alone would pass this test for the
  // wrong reason and stop being true the moment two kinds share a store.
  const token = readSignInToken(await readToken(request)) ?? "";

  if (token) {
    const verified = await auth.handler(
      new Request(`${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`, {
        method: "GET",
        headers: request.headers,
        redirect: "manual",
      })
    );

    const setCookie = verified.headers.get("set-cookie");
    if (setCookie) {
      // Spent successfully. The session cookie is passed straight through.
      const res = html
        ? new Response(signedInPage(), { status: 200, headers: PAGE_HEADERS })
        : Response.json({ status: "signed_in" } satisfies ConfirmOutcome);
      res.headers.append("set-cookie", setCookie);
      return res;
    }
  }

  // The token was missing, spent, or expired. If the caller is already signed
  // in, this is the double click, not an attack.
  const existing = await auth.api.getSession({ headers: request.headers });
  if (existing?.session) {
    return html
      ? new Response(signedInPage(), { status: 200, headers: PAGE_HEADERS })
      : Response.json({ status: "already_signed_in" } satisfies ConfirmOutcome);
  }

  // Row 3 and row 4. No session is minted and nothing is reissued.
  return html
    ? new Response(spentLinkPage(), { status: 401, headers: PAGE_HEADERS })
    : Response.json(
        { status: "refused", reason: "used_or_expired" } satisfies ConfirmOutcome,
        { status: 401 }
      );
}
