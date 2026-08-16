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

export type ConfirmOutcome =
  | { status: "signed_in" }
  | { status: "already_signed_in" }
  | { status: "refused"; reason: "used_or_expired" };

export async function confirmSignIn(
  auth: Auth,
  request: Request,
  baseUrl: string
): Promise<Response> {
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : "";
  } catch {
    token = "";
  }

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
      const res = Response.json({ status: "signed_in" } satisfies ConfirmOutcome);
      res.headers.append("set-cookie", setCookie);
      return res;
    }
  }

  // The token was missing, spent, or expired. If the caller is already signed
  // in, this is the double click, not an attack.
  const existing = await auth.api.getSession({ headers: request.headers });
  if (existing?.session) {
    return Response.json({ status: "already_signed_in" } satisfies ConfirmOutcome);
  }

  // Row 3 and row 4. No session is minted and nothing is reissued.
  return Response.json(
    { status: "refused", reason: "used_or_expired" } satisfies ConfirmOutcome,
    { status: 401 }
  );
}
