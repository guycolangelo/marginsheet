// Does the sign of `amount` mean the same thing on a card as on a checking
// account?
//
// WHY IT IS A SPIKE AND NOT AN ARGUMENT. apply-streams.ts derives `direction`
// from the sign alone, and says so in a comment that reads as settled:
// "Plaid signs outflows positive, so a positive amount is an expense." That
// sentence is TRUE FOR A DEPOSITORY ACCOUNT. Whether it survives a credit
// account is a claim about Plaid's behaviour that nobody here has observed,
// and three things rest on it: whether the stored ledger needs repair, whether
// the writer may derive direction at all, and what 4.7 inherits.
//
// THE READING, FIXED BEFORE THE DATA ARRIVES.
//
// IF A CREDIT ACCOUNT CARRIES ANY NEGATIVE AMOUNT: directionOf labels it
// `income`. A card credit is a PAYMENT or a REFUND and is never income, so the
// writer is wrong for every such row it has already written. The rule inverts
// across account type and the sign alone cannot carry it.
//
// IF NO CREDIT ACCOUNT EVER CARRIES A NEGATIVE AMOUNT: the sign rule holds
// uniformly, the comment is right, and the concern is theoretical. Payments to
// a card would have to appear somewhere other than the card, which would itself
// be worth knowing.
//
// THE HAZARD THIS EXISTS TO PRICE (Guy, 21 Aug 2026). A card payment appears
// TWICE: a debit on checking and a credit on the card. Applied by sign alone
// the same event registers as spending AND income simultaneously, inflating
// both sides of the P&L and leaving Kept unchanged. That is the version that
// looks plausible, because the number the household reads does not move.
//
// SANDBOX IS EVIDENCE ABOUT PLAID, NOT ABOUT AN INSTITUTION. The sign
// convention is a property of Plaid's model rather than of Chase, so this
// generalises; where it would not, that is itself worth learning.

import { describe, it, expect, beforeAll } from "vitest";

const CLIENT_ID = process.env.PLAID_CLIENT_ID ?? "";
const SECRET = process.env.PLAID_SECRET ?? "";
const BASE = "https://sandbox.plaid.com";
const configured = CLIENT_ID !== "" && SECRET !== "";

async function plaid(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body }),
  });
  return { status: response.status, json: (await response.json()) as Record<string, any> };
}

interface Observed {
  type: string;
  subtype: string | null;
  name: string;
  amount: number;
}

let observed: Observed[] = [];
let credit: Observed[] = [];
let depository: Observed[] = [];

describe.skipIf(!configured)("the sign of amount, per account type", () => {
  beforeAll(async () => {
    const { json: created } = await plaid("/sandbox/public_token/create", {
      institution_id: "ins_109508",
      initial_products: ["transactions"],
    });
    const { json: exchanged } = await plaid("/item/public_token/exchange", {
      public_token: created.public_token,
    });
    const token = exchanged.access_token as string;

    // WAIT FOR TRANSACTIONS TO EXIST, not for the endpoint to stop erroring.
    // A fresh Item answers 200 with an empty page before it has generated
    // anything, and every assertion below would pass over an empty set. That
    // is spike 1c's failure and it is recorded in CLAUDE.md.
    const byAccount = new Map<string, { type: string; subtype: string | null }>();
    let rows: any[] = [];
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt += 1) {
      const { json } = await plaid("/transactions/get", {
        access_token: token,
        start_date: "2000-01-01",
        end_date: new Date().toISOString().slice(0, 10),
        options: { count: 500, offset: 0 },
      });
      if (Array.isArray(json.transactions) && json.transactions.length > 0) {
        rows = json.transactions;
        for (const a of json.accounts ?? []) {
          byAccount.set(a.account_id, { type: a.type, subtype: a.subtype ?? null });
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    observed = rows.map((t) => {
      const a = byAccount.get(t.account_id) ?? { type: "unknown", subtype: null };
      return { type: a.type, subtype: a.subtype, name: String(t.name ?? ""), amount: Number(t.amount) };
    });
    credit = observed.filter((o) => o.type === "credit");
    depository = observed.filter((o) => o.type === "depository");
  }, 120_000);

  it("has a fixture large enough to tell a pass from a failure", () => {
    // ASSERTED BEFORE ANYTHING IS MEASURED. An assertion over an empty set is
    // not weak evidence, it is zero evidence wearing a green tick.
    expect(observed.length, "no transactions arrived, so nothing below means anything").toBeGreaterThan(0);
    expect(
      credit.length,
      "no CREDIT account transactions arrived; the whole question is about credit accounts"
    ).toBeGreaterThan(0);
    expect(
      depository.length,
      "no DEPOSITORY transactions arrived, so there is nothing to compare credit against"
    ).toBeGreaterThan(0);
  });

  it("PLAID SIGNS A CARD CREDIT NEGATIVE, so the sign alone cannot carry direction", () => {
    const negativesOnCard = credit.filter((o) => o.amount < 0);

    // The report travels with the interpretation, so a reader can disagree
    // with it. CLAUDE.md, 17 Aug: an interpretation presented without its
    // evidence asks to be trusted.
    console.log(
      `credit rows: ${credit.length}, of which negative: ${negativesOnCard.length}\n` +
        negativesOnCard.slice(0, 8).map((o) => `  ${o.amount}  ${o.name}`).join("\n")
    );

    expect(
      negativesOnCard.length,
      "no negative amount on any credit account: the sign rule would hold uniformly and the reading above says so"
    ).toBeGreaterThan(0);
  });

  it("so a positive amount does NOT mean the same thing on both types", () => {
    // Positives agree: an outflow on checking and a purchase on a card are
    // both spending. The disagreement is entirely on the negative side, which
    // is why a sign-only rule looks correct until a card payment lands.
    expect(depository.some((o) => o.amount > 0), "no depository outflow to compare").toBe(true);
    expect(credit.some((o) => o.amount > 0), "no card purchase to compare").toBe(true);

    const cardCredits = credit.filter((o) => o.amount < 0).length;
    const bankCredits = depository.filter((o) => o.amount < 0).length;
    console.log(`negative amounts -> card: ${cardCredits} (payment or refund), bank: ${bankCredits} (income)`);
    expect(cardCredits, "the two types must both produce negatives for the inversion to bite").toBeGreaterThan(0);
    expect(bankCredits).toBeGreaterThan(0);
  });
});
