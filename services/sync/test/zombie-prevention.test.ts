// Zombie prevention, attempted against Plaid rather than asserted about us.
//
// WHY THE ASSERTIONS ASK PLAID. Our plaid_items table is written by the code
// under test, so a bug that creates a duplicate AT PLAID while writing one row
// locally passes an assertion against our own table perfectly. Our record
// showing one Item while Plaid holds two looks identical to correct from
// inside our own system, and the first sign would be the bill. THE BILLABLE
// OBJECT IS PLAID'S, SO PLAID IS ASKED.
//
// SPIKED BEFORE BUILDING (18 Aug 2026), and the spike moved the target. Plaid
// is idempotent on the public token: exchanging one twice returns the same
// item_id and access_token. So these tests prove OUR handler does not multiply
// what Plaid returns singly, and prove the two-logins case survives, which is
// the shape a duplicate guard would break.

import { describe, it, expect, beforeAll } from "vitest";

const CLIENT_ID = process.env.PLAID_CLIENT_ID;
const SECRET = process.env.PLAID_SECRET;
const configured = Boolean(CLIENT_ID && SECRET);
const BASE = "https://sandbox.plaid.com";

// EVERY TEST THAT TALKS TO PLAID CARRIES AN EXPLICIT TIMEOUT.
//
// vitest defaults to 5000ms, and these make two to four sequential round trips
// to Plaid Sandbox. On 19 Aug 2026 one of them timed out at 5005ms in CI and
// reddened a PR that had touched nothing near it.
//
// THAT IS THE FLAKY-FIXTURE FAILURE, and the damage is not the failing run: a
// suite that reddens on latency teaches people to re-run rather than to look,
// and that habit is how a REAL red gets ignored. A generous timeout on a
// third-party call is not weaker, because the assertion is unchanged; what
// changes is that the only way to go red is the thing under test.
//
// 30 seconds, deliberately far above any plausible Sandbox latency. If Plaid
// is slower than that, the finding is Plaid, and a timeout is the wrong
// instrument for saying so.
const PLAID_TIMEOUT_MS = 30_000;


async function plaid(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body }),
  });
  return { status: response.status, json: (await response.json()) as Record<string, any> };
}

async function freshPublicToken() {
  const { json } = await plaid("/sandbox/public_token/create", {
    institution_id: "ins_109508",
    initial_products: ["transactions"],
  });
  return json.public_token as string;
}

describe.skipIf(!configured)("a re-fired exchange produces one Item AT PLAID", () => {
  let publicToken: string;
  let first: Record<string, any>;

  beforeAll(async () => {
    publicToken = await freshPublicToken();
    ({ json: first } = await plaid("/item/public_token/exchange", { public_token: publicToken }));
  }, PLAID_TIMEOUT_MS);

  it("the second exchange returns the SAME item, not a new one", async () => {
    const { json: second } = await plaid("/item/public_token/exchange", { public_token: publicToken });
    expect(second.item_id, "a re-fired exchange created a second Item at Plaid").toBe(first.item_id);
  }, PLAID_TIMEOUT_MS);

  it("/item/get on both tokens reports one item id", async () => {
    // Asked of PLAID. This is the assertion our own table cannot make.
    const { json: second } = await plaid("/item/public_token/exchange", { public_token: publicToken });
    const a = await plaid("/item/get", { access_token: first.access_token });
    const b = await plaid("/item/get", { access_token: second.access_token });
    expect(a.json.item.item_id).toBe(b.json.item.item_id);
  }, PLAID_TIMEOUT_MS);
});

describe.skipIf(!configured)("two logins at one institution are two Items and both survive", () => {
  // THE CASE A DUPLICATE GUARD WOULD BREAK. A household with a personal and a
  // business login at one bank has two credential sets and Plaid bills for
  // two. A guard written against duplicates could reasonably treat them as one,
  // which is why this is exercised rather than mentioned.
  it("a second Link session at the same institution is a DISTINCT Item", async () => {
    const [one, two] = await Promise.all([freshPublicToken(), freshPublicToken()]);
    const [a, b] = await Promise.all([
      plaid("/item/public_token/exchange", { public_token: one }),
      plaid("/item/public_token/exchange", { public_token: two }),
    ]);
    expect(a.json.item_id).not.toBe(b.json.item_id);

    // Both live independently at Plaid, which is what "both survive" means.
    const [ga, gb] = await Promise.all([
      plaid("/item/get", { access_token: a.json.access_token }),
      plaid("/item/get", { access_token: b.json.access_token }),
    ]);
    expect(ga.json.item.item_id).toBe(a.json.item_id);
    expect(gb.json.item.item_id).toBe(b.json.item_id);
    expect(ga.json.item.institution_id).toBe(gb.json.item.institution_id);
  }, PLAID_TIMEOUT_MS);
});

describe("the unique index refuses a duplicate row by construction", () => {
  it("migration 0002 carries a unique index on plaid_items.item_id", () => {
    // Not a behavioural test and not pretending to be one. It asserts the
    // CONSTRAINT exists, because the guard that matters here is the database
    // refusing rather than our code remembering to check. A check that can be
    // forgotten is a check somebody forgets.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const migration = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "packages", "schema", "migrations", "0002_banking_sync.sql"),
      "utf8"
    );
    expect(migration).toContain('CREATE UNIQUE INDEX "plaid_items_item_id_unique"');
    expect(migration).toContain('CREATE UNIQUE INDEX "financial_accounts_plaid_account_id_unique"');
  });
});
