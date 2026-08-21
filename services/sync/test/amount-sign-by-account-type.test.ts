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
// THE READING WAS FIXED BEFORE THE DATA ARRIVED AND ONE HALF OF IT WAS WRONG.
// Recorded rather than quietly replaced, because the error is this repository's
// own ninth finding committed by someone who had cited it two commits earlier.
//
// AS WRITTEN: "if no credit account ever carries a negative amount, the sign
// rule holds uniformly and the concern is theoretical."
//
// WHAT RAN: 9 credit rows, 0 negative, 2 negatives on depository. Under that
// reading the concern was theoretical.
//
// WHY THAT READING IS WRONG. Zero negatives is equally consistent with Plaid
// never signing a card credit negative AND with a dataset that contains no card
// payment or refund. NINE PURCHASES CANNOT DISTINGUISH THOSE. The fixture check
// asked whether credit rows EXIST; it never asked whether the FAILING CASE
// could exist among them, which is the exact question CLAUDE.md's ninth finding
// says to ask of a fixture.
//
// SO THE SPIKE DOES NOT ANSWER THE QUESTION, and it now says so rather than
// reporting a vacuous pass or a red that reads as "Plaid does not do this".
// A red meaning "the fixture cannot express the failing case" and a red meaning
// "the claim is false" send a reader to different places.
//
// AND THE DEFECT DOES NOT DEPEND ON THE ANSWER, which is why the finding stood
// while this file was being corrected. Take either branch:
//
//   Plaid signs a card payment NEGATIVE -> directionOf returns `income`
//   Plaid signs a card payment POSITIVE -> directionOf returns `expense`,
//                                          so the payment is counted as
//                                          spending on the card AND on checking
//
// Both are wrong, because the right answer is `transfer` and THE FUNCTION
// CANNOT RETURN IT. transaction_direction has had three values since 0003 and
// directionOf can produce two. That is an argument from what the writer can
// express rather than from what Plaid happens to send, and CLAUDE.md already
// records why the boundary argument is the one a case cannot defeat.
//
// SETTLED IN PRODUCTION ON 21 AUG 2026, AND THE RESOLUTION WAS BIGGER THAN THE
// QUESTION. Chase's rows showed 56 card credits, so Plaid does sign a card
// credit negative, and the convention is CONSISTENT across account types:
// positive is money out, on depository and credit alike. THERE IS NO CARD
// INVERSION. The real defect was that one column held a FACT and a FILING at
// once, so 0035 split them: `flow` is M4's fact, `direction` is M5's filing.
//
// THIS SPIKE NOW GUARDS THE FACT HALF. flowOf is a pure function of the sign
// and this is the only thing that checks the sign is what we think it is.
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

  it("establishes what Sandbox can establish: both signs on a bank account, purchases on a card", () => {
    const negativesOnCard = credit.filter((o) => o.amount < 0);
    const negativesOnBank = depository.filter((o) => o.amount < 0);

    // The report travels with the interpretation, so a reader can disagree
    // with it. CLAUDE.md, 17 Aug: an interpretation presented without its
    // evidence asks to be trusted.
    console.log(
      `credit: ${credit.length} rows, ${negativesOnCard.length} negative | ` +
        `depository: ${depository.length} rows, ${negativesOnBank.length} negative`
    );

    expect(depository.some((o) => o.amount > 0), "no depository outflow").toBe(true);
    expect(credit.some((o) => o.amount > 0), "no card purchase").toBe(true);
    expect(negativesOnBank.length, "no depository inflow, so income has no example").toBeGreaterThan(0);
  });

  it("PINS THE FIXTURE'S LIMIT: this dataset has no card credit, so it cannot answer the question", () => {
    // AN ASSERTION THAT INVERTS USEFULLY. It is not decoration and it is not a
    // vacuous pass: it states a property of the fixture as a fact, and IT GOES
    // RED THE DAY PLAID ADDS A CARD PAYMENT TO THE DATASET, which is the day
    // the question becomes answerable here instead of in production.
    //
    // A test that quietly tolerated either outcome would let the next reader
    // believe the spike had settled something. This one tells them exactly
    // what it did not settle.
    const negativesOnCard = credit.filter((o) => o.amount < 0);
    expect(
      negativesOnCard.length,
      "A CARD CREDIT APPEARED IN SANDBOX. The question is now answerable here: read the sign above, " +
        "then close the open item that sends it to production."
    ).toBe(0);
  });
});
