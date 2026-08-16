// The page the emailed sign-in link opens (M3 task 3.2a).
//
// THE LINK CONSUMES NOTHING (ruled 15 Aug 2026). This page is the whole reason
// that ruling is implementable: corporate email security scanners follow links
// before the human does, and a GET-consumed single-use token is burned by the
// scanner. The member then clicks a dead link and cannot sign in, and it looks
// like our bug because it is. Scanners issue GETs and do not press buttons, so
// rendering this page spends nothing and the token survives them.
//
// THE COPY IS A REQUIREMENT, NOT A PREFERENCE (ruled 15 Aug 2026). Guy's
// words: the action must read as CONFIRMATION, not as an obstacle. A page that
// sounds like a challenge tells the member the product does not trust them; a
// page that sounds like a confirmation tells them the product is finishing
// what they asked for. That is why there is no "verify", no "are you human",
// and no warning tone anywhere below. The member did ask for this.
//
// NO SCRIPT, NO EXTERNAL ASSETS. The form is a plain HTML form, so the sign-in
// completes with JavaScript disabled, on any client, offline of any CDN. A
// first sign-in is the worst possible moment to depend on anything else
// loading.

/**
 * The token arrives from a query string, which is attacker-controlled input
 * being written into a document. Escaped rather than trusted to be
 * base64url-shaped, because "it is always that shape" is an assumption and
 * this is the one place where being wrong about it is an injected script.
 */
function escapeHtml(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}

const STYLE = [
  "body{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;",
  "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
  "background:#faf9f7;color:#1a1a1a;padding:24px}",
  "main{max-width:26rem;text-align:center}",
  "h1{font-size:1.5rem;font-weight:600;margin:0 0 .75rem}",
  "p{margin:0 0 1.5rem;color:#4a4a4a}",
  "button{font:inherit;font-weight:600;padding:.85rem 2rem;border:0;border-radius:8px;",
  "background:#1a1a1a;color:#fff;cursor:pointer}",
  "small{display:block;margin-top:1.5rem;color:#6b6b6b;font-size:.85rem}",
].join("");

function page(title: string, body: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    // Belt and braces with the Referrer-Policy header: the URL of this page
    // carries a live credential and must not travel in a Referer anywhere.
    '<meta name="referrer" content="no-referrer">',
    `<title>${title}</title><style>${STYLE}</style></head>`,
    `<body><main>${body}</main></body></html>`,
  ].join("");
}

/** The page a valid link opens. Renders the action; spends nothing. */
export function confirmPage(token: string, minutes: number): string {
  return page(
    "Confirm your sign-in",
    [
      "<h1>You are one click from signing in</h1>",
      "<p>Confirm below and MarginSheet&trade; will open.</p>",
      '<form method="post" action="/auth/confirm">',
      `<input type="hidden" name="token" value="${escapeHtml(token)}">`,
      '<button type="submit">Confirm and sign in</button>',
      "</form>",
      `<small>This link works for ${minutes} minutes and once only.</small>`,
    ].join("")
  );
}

/** A link that arrived without its token. Common, and not the member's fault. */
export function incompleteLinkPage(): string {
  return page(
    "Finish signing in",
    [
      "<h1>This sign-in link came through incomplete</h1>",
      "<p>Some email apps shorten long links. Ask for a fresh one and it will work.</p>",
      "<small>Nothing has happened to your account.</small>",
    ].join("")
  );
}

/** After the action succeeds. The session cookie rides on this response. */
export function signedInPage(): string {
  return page(
    "You are signed in",
    [
      "<h1>You are signed in</h1>",
      "<p>You can close this tab and carry on in MarginSheet&trade;.</p>",
    ].join("")
  );
}

/** A token that was already spent, or has passed its 15 minutes. */
export function spentLinkPage(): string {
  return page(
    "Ask for a new link",
    [
      "<h1>This link has been used</h1>",
      "<p>Sign-in links work once. Ask for a new one and it will take you straight in.</p>",
      "<small>Nothing has happened to your account.</small>",
    ].join("")
  );
}
