// The 4.5b prime connect surface: what it requires and what it never accepts.
//
// The surface is throwaway; these assertions are not. They cover the two things
// that would be wrong in the same way M8's real surface could be wrong: taking
// a household from the caller, and letting an unauthenticated request through.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INDEX = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
const PAGE = readFileSync(join(import.meta.dirname, "..", "src", "connect-page.ts"), "utf8");

describe("the connect surface derives the household from the session", () => {
  it("sends no householdId from the browser", () => {
    // THE PAGE MUST NOT OFFER ONE. /plaid/exchange ignores a body-supplied
    // household since #112, so sending one would be harmless today and would
    // teach the next reader that it is an input. The defect that took a day to
    // find was exactly that: a household id the caller chose.
    const exchangeCall = PAGE.slice(PAGE.indexOf("/plaid/exchange"));
    const body = exchangeCall.slice(0, exchangeCall.indexOf("})"));
    expect(body, "the page sends a householdId").not.toMatch(/householdId\s*[:,]/);
  });

  it("rebuilds the link-token body rather than forwarding the request's", () => {
    // Forwarding would let a caller-supplied field ride along, which is the
    // same defect with an extra step.
    const route = INDEX.slice(INDEX.indexOf('"/plaid/link-token" && request.method'));
    expect(route.slice(0, 900)).toMatch(/JSON\.stringify\(\{ householdId \}\)/);
  });
});

describe("every connect route requires a session, except the one that cannot", () => {
  it("gates link-token, accounts and the page behind getSession", () => {
    const block = INDEX.slice(INDEX.indexOf('url.pathname === "/plaid/link-token" ||'));
    const guarded = block.slice(0, block.indexOf('if (url.pathname === "/plaid/exchange"'));
    expect(guarded).toMatch(/getSession/);
    expect(guarded, "an unauthenticated caller is not refused").toMatch(/not_signed_in.*401/s);
    expect(guarded, "a session without a household is not refused").toMatch(/no_household.*403/s);
  });

  it("names every /plaid route in the gate's condition, or exempts it out loud", () => {
    // THE BLOCK-LEVEL ASSERTION ABOVE CANNOT SEE A ROUTE THAT SKIPPED THE GATE.
    // It proves the guarded region calls getSession, which stays true however
    // many routes are handled somewhere else, so its coverage is a property of
    // the region rather than of the routes. Adding /plaid/ledger-readout on
    // 20 Aug made that concrete: the route was gated in fact and nothing
    // asserted it, and a route added to the file without being added to the
    // condition list would have passed exactly as loudly.
    //
    // Two exemptions, both deliberate and both with their reason in the source:
    // the OAuth return arrives from the bank rather than from our own fetch,
    // and the exchange carries its own session handling with its own control.
    // THREE EXEMPTIONS, EACH FOR A DIFFERENT REASON, AND NONE OF THEM "IT WAS
    // AWKWARD". The OAuth return arrives from the bank rather than from our own
    // fetch. The exchange carries its own session handling under its own
    // control. The webhook arrives from PLAID, so there is no session and never
    // will be: what stands in for one is the signature, verified in the sync
    // Worker where the credentials live, and watched REFUSING as well as
    // accepting before it is trusted.
    const EXEMPT = new Set(["/plaid/oauth-return", "/plaid/exchange", "/plaid/webhook"]);
    const condition = INDEX.slice(
      INDEX.indexOf('url.pathname === "/plaid/link-token" ||'),
      INDEX.indexOf('url.pathname === "/connect"')
    );
    const handled = [...INDEX.matchAll(/url\.pathname === "(\/plaid\/[a-z-]+)"/g)].map((m) => m[1]);
    expect(new Set(handled).size, "no /plaid routes found: this scan matched nothing").toBeGreaterThan(3);

    const ungated = [...new Set(handled)].filter(
      (route) => !EXEMPT.has(route) && !condition.includes(`"${route}"`)
    );
    expect(
      ungated,
      `these /plaid routes are handled but are not in the session gate's condition, so they fall through to the unauthenticated part of the Worker:\n  ${ungated.join("\n  ")}`,
    ).toEqual([]);
  });

  it("returns 403 rather than 500 when the session has no household", () => {
    // A missing members row reads as a broken gate unless it is named. This is
    // the first thing that will go wrong for a real household, and "no_household"
    // says which of the two it is.
    const block = INDEX.slice(INDEX.indexOf("no_household"));
    expect(block.slice(0, 80)).toMatch(/403/);
  });

  it("leaves the OAuth return unauthenticated, and says why", () => {
    // It arrives from the BANK rather than from our own fetch, so a session
    // check would break the flow it exists to complete. It reads nothing and
    // writes nothing, which is what makes that acceptable.
    const block = INDEX.slice(INDEX.indexOf('"/plaid/oauth-return"'));
    expect(block.slice(0, 1200)).toMatch(/arrives from the bank/i);
  });
});

describe("the surface is honest about failing", () => {
  it("shows every failure rather than only successes", () => {
    // A connect flow that fails silently is one nobody can report, and the
    // whole point of this page is to find out what real banks do.
    expect(PAGE).toMatch(/onExit/);
    expect(PAGE, "an exit and an error are indistinguishable").toMatch(/exited: true, error: err/);
  });

  it("carries receivedRedirectUri, without which OAuth cannot resume", () => {
    expect(PAGE).toMatch(/receivedRedirectUri/);
  });
});
