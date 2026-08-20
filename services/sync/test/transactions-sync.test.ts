// The sync loop and its mutation branch (4.4.2).
//
// The branch is tested against a SYNTHESISED 400, and that limit is stated
// rather than blurred. TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION reproduced
// 3 times in 5 against Sandbox, which is flaky and therefore not a fixture: a
// test that reddens 60% of the time when the code is correct teaches people to
// re-run. So these prove OUR HANDLER takes the right branch, and do not claim
// to have proven Plaid's behaviour. The live observation is the evidence that
// the branch exists at all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTransactionsSync, MUTATION_DURING_PAGINATION } from "../src/transactions-sync.js";

const creds = { clientId: "c", secret: "s" };
const page = (added: number, next: string, more: boolean) =>
  new Response(
    JSON.stringify({ added: Array(added).fill({}), modified: [], removed: [], next_cursor: next, has_more: more }),
    { status: 200 }
  );
const mutationError = () =>
  new Response(
    JSON.stringify({
      error_type: "INVALID_INPUT",
      error_code: MUTATION_DURING_PAGINATION,
      error_message: "Underlying transaction data changed since last page was fetched.",
      request_id: "req-1",
    }),
    { status: 400 }
  );

let persisted: string[];
const persist = async (c: string) => { persisted.push(c); };
beforeEach(() => { persisted = []; });

/** A stream applier that records nothing, for tests about PAGINATION rather
 *  than about writing. Named so it is obvious at each call site that the write
 *  path is deliberately not under test here. */
const applyNothing = async () => ({ written: 0, flagged: 0 });

describe("the cursor is persisted after every page", () => {
  it("writes one cursor per page, not one at the end", async () => {
    let call = 0;
    vi.stubGlobal("fetch", async () => [page(2, "c1", true), page(2, "c2", true), page(1, "c3", false)][call++]);
    const out = await runTransactionsSync("tok", { inFlight: null, lastCompleted: null }, creds, persist, applyNothing);
    expect(persisted).toEqual(["c1", "c2", "c3"]);
    expect(out.pages).toBe(3);
    expect(out.added).toBe(5);
  });

  it("resumes from the in-flight cursor, which is what a crash left behind", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return page(1, "c9", false);
    });
    await runTransactionsSync("tok", { inFlight: "mid-page-cursor", lastCompleted: "old" }, creds, persist, applyNothing);
    expect(sent.cursor).toBe("mid-page-cursor");
  });
});

describe("the mutation branch is control flow, not an error", () => {
  it("restarts from LAST COMPLETED, never from the refused in-flight cursor", async () => {
    const cursorsSent: (string | undefined)[] = [];
    let call = 0;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      cursorsSent.push(JSON.parse(String(init.body)).cursor);
      call += 1;
      if (call === 1) return page(2, "c1", true);
      if (call === 2) return mutationError();
      return page(3, "done", false);
    });

    const out = await runTransactionsSync(
      "tok", { inFlight: "in-flight", lastCompleted: "last-completed" }, creds, persist, applyNothing
    );

    expect(cursorsSent[0]).toBe("in-flight");
    // THE ASSERTION THAT MATTERS. Retrying the in-flight cursor here is what
    // replays transactions into a household's ledger.
    expect(cursorsSent[2], "the restart reused a cursor Plaid had already refused").toBe("last-completed");
    expect(out.restarts).toBe(1);
  });

  it("completes rather than throwing, so the Item is never parked", async () => {
    let call = 0;
    vi.stubGlobal("fetch", async () => (++call === 1 ? mutationError() : page(4, "done", false)));
    const out = await runTransactionsSync("tok", { inFlight: "a", lastCompleted: "b" }, creds, persist, applyNothing);
    expect(out.added).toBe(4);
    expect(out.cursor).toBe("done");
  });

  it("discards the counts from the pagination Plaid disowned", async () => {
    // The first pass counted 2 before being refused. Those describe a
    // pagination that no longer exists, and counting them would double.
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call += 1;
      if (call === 1) return page(2, "c1", true);
      if (call === 2) return mutationError();
      return page(3, "done", false);
    });
    const out = await runTransactionsSync("tok", { inFlight: "a", lastCompleted: "b" }, creds, persist, applyNothing);
    expect(out.added, "counts from the abandoned pass were carried forward").toBe(3);
  });

  it("gives up after repeated restarts, which is different from taking the branch", async () => {
    vi.stubGlobal("fetch", async () => mutationError());
    await expect(
      runTransactionsSync("tok", { inFlight: "a", lastCompleted: "b" }, creds, persist, applyNothing)
    ).rejects.toThrow(/restarted 3 times/);
  });

  it("a NON-mutation error still throws, so this branch is narrow", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED", error_message: "x" }), { status: 400 })
    );
    await expect(
      runTransactionsSync("tok", { inFlight: "a", lastCompleted: "b" }, creds, persist, applyNothing)
    ).rejects.toThrow(/ITEM_LOGIN_REQUIRED/);
  });
});

describe("a sync that changed nothing does not report a change", () => {
  it("reports changed:false on an empty page", async () => {
    vi.stubGlobal("fetch", async () => page(0, "same", false));
    const out = await runTransactionsSync("tok", { inFlight: "same", lastCompleted: "same" }, creds, persist, applyNothing);
    expect(out.changed, "an empty sync would wake the watcher for nothing").toBe(false);
  });
});

describe("rows are written before the cursor moves", () => {
  it("applies the page, THEN persists the cursor", async () => {
    // THE ORDERING IS THE CONTROL. If the cursor were persisted first and the
    // write then failed, the next run would resume PAST transactions nobody
    // stored. The gap would be invisible: no error, no retry, and a ledger
    // missing a page with a cursor that says it was read.
    //
    // Plaid's cursor is a promise about what we have consumed. Moving it before
    // consuming makes that promise false, and nothing downstream can tell.
    const order: string[] = [];
    let call = 0;
    vi.stubGlobal("fetch", async () => [page(2, "c1", true), page(1, "c2", false)][call++]);

    await runTransactionsSync(
      "tok",
      { inFlight: null, lastCompleted: null },
      creds,
      async () => { order.push("cursor"); },
      async () => { order.push("apply"); return { written: 1, flagged: 0 }; }
    );

    // Every apply precedes its own cursor write, on every page.
    expect(order).toEqual(["apply", "cursor", "apply", "cursor"]);
  });

  it("reports rows WRITTEN as well as rows offered", async () => {
    // They differ when a transaction names an account this household does not
    // hold. A caller that only sees Plaid's counts cannot notice that case, and
    // "added: 3, written: 1" is a finding while "added: 3" alone is not.
    vi.stubGlobal("fetch", async () => page(3, "done", false));
    const out = await runTransactionsSync(
      "tok",
      { inFlight: null, lastCompleted: null },
      creds,
      persist,
      async () => ({ written: 1, flagged: 2 })
    );
    expect(out.added).toBe(3);
    expect(out.written).toBe(1);
    expect(out.flagged).toBe(2);
  });
});
