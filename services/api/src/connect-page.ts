// The 4.5b prime connect surface. THROWAWAY BY DESIGN.
//
// M8 builds the real one: the non-blocking accordion, progressive rendering,
// the account picker, reauth. This exists so real institutions can be connected
// before M5, M6 and M8, because those three want real transactions, real
// history, and a pending transaction that actually settles.
//
// IT IS NOT A DESIGN. No brand, no layout system, no states beyond the three
// that matter. Making it look finished would invite keeping it.

/** The page. Session-gated by its route; it holds no secret of its own. */
export const CONNECT_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Connect accounts</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  button { font: inherit; padding: .6rem 1rem; cursor: pointer; }
  #out { white-space: pre-wrap; background: #f4f4f5; padding: 1rem; margin-top: 1rem; }
  .err { background: #fee; }
  table { border-collapse: collapse; margin-top: 1rem; width: 100%; }
  td, th { border-bottom: 1px solid #ddd; padding: .4rem .5rem; text-align: left; font-size: .9rem; }
</style>
<h1>Connect accounts</h1>
<p>Temporary surface for connecting real institutions. M8 replaces it.</p>
<button id="go">Connect an institution</button>
<button id="sync">Run a sync</button>
<button id="readout">Ledger readout</button>
<div id="out" hidden></div>
<h2>Already connected</h2>
<table id="accounts"><tbody></tbody></table>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<script>
const out = document.getElementById("out");
// EVERY FAILURE IS SHOWN. A connect flow that fails silently is one nobody can
// report, and the whole reason this page exists is to find out what real banks
// do. The raw body is printed rather than a friendly message, because the
// interesting failures are the ones nobody anticipated.
function show(what, isError) {
  out.hidden = false;
  out.className = isError ? "err" : "";
  out.textContent = typeof what === "string" ? what : JSON.stringify(what, null, 2);
}

async function readBody(res) {
  // NEVER substitute an empty object for an unparseable body. That is what
  // shipped on 20 Aug: it reads as a successful call with nothing to report.
  // The readout returns {ours, plaid} or an {error}
  // object and has no path that returns an empty one, so an empty object on
  // screen meant "the body
  // was not JSON" while looking like "there was nothing to say".
  //
  // A DIAGNOSTIC THAT CANNOT REPORT ITS OWN FAILURE IS WORSE THAN NONE,
  // because it reports something. The status, the content type and the raw
  // first 2000 characters are shown instead, which is what a person needs to
  // tell a 404 from a 500 from an HTML error page.
  const text = await res.text();
  try {
    return { ok: res.ok, parsed: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      parsed: {
        unparseable: true,
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: text.slice(0, 2000),
      },
    };
  }
}

async function listAccounts() {
  const res = await fetch("/plaid/accounts");
  if (!res.ok) return show("accounts: " + res.status + " " + (await res.text()), true);
  const { accounts } = await res.json();
  const body = document.querySelector("#accounts tbody");
  body.innerHTML = accounts.length
    ? accounts.map(a =>
        "<tr><td>" + (a.institution ?? "?") + "</td><td>" + (a.name ?? "?") +
        "</td><td>" + (a.mask ? "****" + a.mask : "") + "</td><td>" + (a.type ?? "") + "</td></tr>"
      ).join("")
    : "<tr><td colspan=4>none yet</td></tr>";
}

document.getElementById("sync").onclick = async () => {
  // THE NUMBERS ARE THE POINT. added versus written is the pair that matters:
  // equal is correct, and "added: 340, written: 0" is the failure that looks
  // like success, because Plaid sent rows and every one named an account this
  // household does not hold.
  show("syncing... a first backfill can take a while");
  const res = await fetch("/plaid/sync", { method: "POST" });
  const { ok, parsed } = await readBody(res);
  show(parsed, !ok);
  listAccounts();
};

document.getElementById("readout").onclick = async () => {
  // OURS BESIDE PLAID'S, never one summarised into the other. The whole point
  // is that our tables cannot say whether a count is what exists or what we
  // kept, so the two numbers are printed side by side and the reader compares.
  show("reading...");
  const res = await fetch("/plaid/ledger-readout");
  const { ok, parsed } = await readBody(res);
  show(parsed, !ok);
};

document.getElementById("go").onclick = async () => {
  show("requesting a link token...");
  const res = await fetch("/plaid/link-token", { method: "POST" });
  const { ok, parsed } = await readBody(res);
  if (!ok) return show(parsed, true);
  const body = parsed;

  const handler = Plaid.create({
    token: body.linkToken,
    // receivedRedirectUri is what resumes an OAuth flow after the bank sends
    // the browser back. Without it, OAuth institutions cannot complete.
    receivedRedirectUri: window.location.href.includes("oauth_state_id")
      ? window.location.href
      : undefined,
    onSuccess: async (publicToken, metadata) => {
      show("exchanging...");
      const ex = await fetch("/plaid/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // householdId is NOT sent. It is derived from the session, and the
        // endpoint would ignore it anyway.
        body: JSON.stringify({ publicToken }),
      });
      const { ok: exOk, parsed: result } = await readBody(ex);
      show({ status: ex.status, institution: metadata.institution, result }, !exOk);
      listAccounts();
    },
    onExit: (err, metadata) => {
      // An exit is not necessarily an error, and the two must be
      // distinguishable: a household closing Link and a bank refusing look the
      // same from here unless both are printed.
      show({ exited: true, error: err, metadata }, Boolean(err));
    },
  });
  handler.open();
};

listAccounts();
</script>`;

/** The OAuth return. Registered with Plaid as the exact redirect URI.
 *
 *  IT DOES NOTHING BUT HAND CONTROL BACK. Plaid's flow is: the bank redirects
 *  here, the page re-opens Link with the SAME link token and the current URL,
 *  and Link resumes. Anything else here would be state this surface does not
 *  need to hold. */
export const OAUTH_RETURN_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Returning</title>
<p>Returning to MarginSheet...</p>
<script>
  // The connect page stored the token before opening Link. Reading it back is
  // what lets Link resume rather than start over.
  const token = sessionStorage.getItem("plaid_link_token");
  if (token) {
    location.replace("/connect?oauth_state_id=" + encodeURIComponent(location.search));
  } else {
    location.replace("/connect");
  }
</script>`;
