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
<button id="products">Check consented products</button>
<button id="readout">Ledger readout</button>
<button id="disconnect">Disconnect an institution (dry run)</button>
<button id="purge">Purge an Item (dry run)</button>
<button id="liabilities">Statement balances: survey and turn on</button>
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
  if (!res.ok) return;
  const { accounts } = await res.json();
  const body = document.querySelector("#accounts tbody");
  body.innerHTML = "";

  // ONE REPAIR BUTTON PER ITEM, NOT PER ACCOUNT. An Item is what Plaid
  // re-authenticates and what carries consent, so a button beside every card of
  // one institution would offer the same act six times and read as six acts.
  const seen = new Set();

  for (const a of accounts) {
    const row = document.createElement("tr");
    const cells = [a.institution ?? "", a.name ?? "", a.mask ? "****" + a.mask : "", a.type ?? ""];
    for (const text of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      row.appendChild(td);
    }
    const action = document.createElement("td");
    if (a.item_row_id && !seen.has(a.item_row_id)) {
      seen.add(a.item_row_id);
      const button = document.createElement("button");
      button.textContent = "Reconnect / re-consent";
      button.onclick = () => reconnect(a.item_row_id, a.institution);
      action.appendChild(button);
    }
    row.appendChild(action);
    body.appendChild(row);
  }
}

/** Link in UPDATE MODE, which is the only way to add consent to an Item that
 *  already exists.
 *
 *  WHY THIS IS NOT FOUNDER TOOLING. Consent is fixed when an Item is created,
 *  so every Item connected before a product was added to the link token needs
 *  this path, and that includes every beta household with a pre-existing
 *  connection. M8 replaces this surface and inherits these routes.
 *
 *  THE COMPLETION ASKS PLAID BEFORE IT MARKS ANYTHING. Update mode reuses the
 *  existing access token and returns nothing proving the repair worked, so a
 *  route that simply marked the Item healthy would be claiming a repair it had
 *  not verified. onSuccess here means Link closed cleanly, which is not the
 *  same thing, and the server decides.
 */
async function reconnect(itemRowId, institution) {
  show("requesting an update-mode link token for " + (institution ?? "this institution") + "...");
  const res = await fetch("/plaid/reconnect-link-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemRowId }),
  });
  const { ok, parsed } = await readBody(res);
  if (!ok) return show(parsed, true);

  const handler = Plaid.create({
    token: parsed.linkToken,
    receivedRedirectUri: window.location.href.includes("oauth_state_id")
      ? window.location.href
      : undefined,
    onSuccess: async () => {
      show("Link closed cleanly. Asking Plaid whether the Item is actually live...");
      const done = await fetch("/plaid/reconnect-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // itemId comes from the SERVER's answer rather than from Link's
        // metadata: the route that minted the token already said which Item it
        // is, and taking it from the browser would let the two disagree.
        body: JSON.stringify({ itemRowId, itemId: parsed.itemId }),
      });
      const { ok: doneOk, parsed: result } = await readBody(done);
      show(result, !doneOk);
      listAccounts();
    },
    onExit: (err, metadata) => {
      show({ exited: true, error: err, metadata }, Boolean(err));
    },
  });
  handler.open();
}

document.getElementById("products").onclick = async () => {
  // consented_products is the answer to whether additional_consented_products
  // was honored on an initial link token. products is what was added at link
  // time; billed_products is what has been charged for.
  show("asking Plaid what each Item carries...");
  const res = await fetch("/plaid/item-products");
  show(await res.json().catch(() => ({})), !res.ok);
};

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

document.getElementById("disconnect").onclick = async () => {
  // DRY RUN ONLY FROM THIS BUTTON, like the purge. It reports what a confirmed
  // call would do and what Plaid currently says; removing requires a separate
  // deliberate call carrying confirm, which this page does not make. The two
  // destructive actions on this surface behave identically on purpose: a
  // household should not have to learn which buttons are safe.
  const itemId = prompt("item_id to inspect for disconnect (dry run, nothing is removed)");
  if (!itemId) return;
  show("checking...");
  const res = await fetch("/plaid/disconnect-item", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
  const { ok, parsed } = await readBody(res);
  show(parsed, !ok);
};

document.getElementById("purge").onclick = async () => {
  // DRY RUN ONLY FROM THIS BUTTON. It reports what it would delete and what
  // Plaid says about the Item; deleting requires a deliberate second call
  // carrying confirm, which this page does not make. A destructive action one
  // click from a diagnostic is the wrong shape for a throwaway surface.
  const itemId = prompt("item_id to inspect for purge (dry run, nothing is deleted)");
  if (!itemId) return;
  show("checking...");
  const res = await fetch("/plaid/purge-item", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
  const { ok, parsed } = await readBody(res);
  show(parsed, !ok);
};

/** Statement balances and due dates, which is what Cash Flow reads as committed.
 *
 *  TWO STEPS, AND THE SURVEY COMES FIRST BECAUSE THE CHOICE NEEDS SOMETHING TO
 *  CHOOSE FROM. The dry run reports every Item, how many credit accounts each
 *  holds, and whether it is already on. Nothing is enabled by looking.
 *
 *  THE CONFIRM NAMES THE CHARGE, which is the route's whole reason for
 *  existing. Plaid bills PER ITEM PER MONTH, not per card, and stating it in
 *  the household's units would overstate the cost by an order of magnitude on
 *  an institution holding six cards.
 *
 *  AN ITEM WITH NO CREDIT ACCOUNTS IS NOT OFFERED. Enabling it buys nothing and
 *  starts a charge, which is guarding the target rather than the action.
 */
document.getElementById("liabilities").onclick = async () => {
  show("surveying which institutions hold credit accounts...");
  const survey = await fetch("/plaid/enable-liabilities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: false, itemIds: [] }),
  });
  const { ok, parsed } = await readBody(survey);
  if (!ok) return show(parsed, true);

  const eligible = (parsed.items ?? []).filter((i) => i.creditAccounts > 0 && !i.alreadyEnabled);
  if (eligible.length === 0) {
    return show({
      survey: parsed,
      note: "nothing to turn on: every institution holding a credit account already reads statement balances, or none holds one.",
    });
  }

  show(parsed);
  const names = eligible.map((i) => (i.institution ?? i.itemId) + " (" + i.creditAccounts + " cards)").join("\n  ");
  const answer = prompt(
    "Turn on statement balances for these institutions?\n\n  " + names +
      "\n\nThis reads each card's statement balance and due date, which is what MarginSheet needs to tell you what is committed before your next deposit.\n\n" +
      "IT STARTS A RECURRING MONTHLY COST, charged per institution rather than per card, for as long as the institution stays connected. " +
      eligible.length + " institution(s) would start.\n\n" +
      "Type the number of institutions to confirm, or cancel."
  );
  if (answer === null) return show("cancelled; nothing was turned on and no cost was started");
  if (answer.trim() !== String(eligible.length)) {
    // A TYPED COUNT RATHER THAN AN OK BUTTON. The thing being confirmed is how
    // many recurring costs begin, so the confirmation is the number itself: an
    // operator who has not read the list cannot produce it.
    return show("not confirmed: expected " + eligible.length + " and got " + JSON.stringify(answer.trim()), true);
  }

  show("turning on statement balances for " + eligible.length + " institution(s)...");
  const applied = await fetch("/plaid/enable-liabilities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // NAMED IDS, NEVER "ALL". A permission that names no target is the shape
    // that destroyed shared dev: the operator answers a question about
    // themselves while the cost is a property of the target.
    body: JSON.stringify({ confirm: true, itemIds: eligible.map((i) => i.itemId) }),
  });
  const { ok: appliedOk, parsed: result } = await readBody(applied);
  show(result, !appliedOk);
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
