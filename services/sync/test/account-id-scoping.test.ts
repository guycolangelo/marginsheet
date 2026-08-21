// Does Plaid issue the SAME account_id to two Items for the same institution?
//
// THE QUESTION DECIDES THREE THINGS AND WE HAD BEEN ANSWERING IT FROM
// DOCUMENTATION. On 20 Aug 2026 an Item was purged and relinked on the belief
// that a relink issues new account ids, and the belief was never tested: the old
// rows were deleted before the new ones arrived, so no comparison was possible.
// Later the same night the opposite premise was used to argue that
// financial_accounts_plaid_account_id_unique refuses a second household linking
// a shared joint account. BOTH CANNOT BE TRUE, and each was independently
// plausible, which is how they survived hours apart in the same conversation.
//
// WHAT EACH ANSWER MEANS, decided before the data arrives.
//
// IF THE ID SETS ARE DISJOINT: ids are Item-scoped. The purge was necessary,
// because a relink would otherwise have imported the overlap a second time
// under new ids. The Option A ruling stands, since two households get different
// ids and the global unique index refuses nothing legitimate. The index's only
// live defect is the cross-household one already recorded.
//
// IF THE ID SETS OVERLAP: ids are stable per real account. The purge was
// unnecessary, because the upserts would have converged. The index REFUSES the
// second household to link a shared joint account, which makes Option A a
// description of a state the schema does not permit, and the index becomes
// urgent rather than owed.
//
// SANDBOX, WHICH IS EVIDENCE ABOUT PLAID AND NOT ABOUT SOFI. The scoping is a
// property of Plaid's identifier model rather than of an institution, so this
// generalises; where it would not, that is itself worth learning.

import { describe, it, expect, beforeAll } from "vitest";

const CLIENT_ID = process.env.PLAID_CLIENT_ID ?? "";
const SECRET = process.env.PLAID_SECRET ?? "";
const BASE = "https://sandbox.plaid.com";
const configured = CLIENT_ID !== "" && SECRET !== "";
const PLAID_TIMEOUT_MS = 30_000;

async function plaid(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body }),
  });
  return { status: response.status, json: (await response.json()) as Record<string, any> };
}

/** One whole Item: public token, exchange, accounts. */
async function freshItem() {
  const { json: created } = await plaid("/sandbox/public_token/create", {
    institution_id: "ins_109508",
    initial_products: ["transactions"],
  });
  const { json: exchanged } = await plaid("/item/public_token/exchange", {
    public_token: created.public_token,
  });
  const { json: accounts } = await plaid("/accounts/get", {
    access_token: exchanged.access_token,
  });
  return {
    itemId: exchanged.item_id as string,
    ids: (accounts.accounts as Array<{ account_id: string }>).map((a) => a.account_id).sort(),
  };
}

describe.skipIf(!configured)("account ids across two Items for one institution", () => {
  let first: Awaited<ReturnType<typeof freshItem>>;
  let second: Awaited<ReturnType<typeof freshItem>>;

  beforeAll(async () => {
    first = await freshItem();
    second = await freshItem();
  }, PLAID_TIMEOUT_MS * 2);

  it("built two distinct Items with accounts, so the comparison is not vacuous", () => {
    // Direction 2, and it is load-bearing here: two EMPTY id sets are disjoint,
    // and two Items that are secretly the same Item share every id. Either
    // would produce a confident answer to the wrong question. An assertion over
    // sets too small to distinguish is zero evidence wearing a green tick.
    expect(first.itemId, "the two Items are the same Item").not.toBe(second.itemId);
    expect(first.ids.length, "the first Item returned no accounts").toBeGreaterThan(1);
    expect(second.ids.length, "the second Item returned no accounts").toBeGreaterThan(1);
    expect(second.ids.length, "the two Items returned different account counts").toBe(first.ids.length);
  });

  it("reports whether the id sets overlap", () => {
    const shared = first.ids.filter((id) => second.ids.includes(id));
    // The assertion states the answer this repo has been ASSUMING, so a
    // failure here is the finding rather than a broken test. If it reddens,
    // ids are stable across Items and two rulings need revisiting.
    expect(
      shared,
      `Plaid issued the SAME account ids to two different Items. Ids are stable per real account rather than Item-scoped, which means the global unique index refuses a second household linking a shared joint account, and the Option A ruling described a state the schema does not permit. Shared ids:\n  ${shared.join("\n  ")}`,
    ).toEqual([]);
  });
});
