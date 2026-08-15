// Staging isolation, asserted rather than assumed (M0 plan Task 0.2).
// Runs in CI against dev and staging with that environment's secret set injected.
// Every check TRIES the forbidden thing and requires failure, or inspects the
// live credential, never just the config string.
//
// Required env (injected by CI from the target environment's secrets):
//   ISOLATION_TARGET          "dev" | "staging"
//   PLAID_CLIENT_ID, PLAID_SECRET
//   STRIPE_SECRET
//   NEON_DATABASE_URL
//   EXPECTED_NEON_HOST        the target branch endpoint host (from neonctl)
//   PRODUCTION_NEON_HOST      production endpoint host (string only, no credential)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//
// This suite must never receive production credentials. It proves it was not
// given them.

import { describe, it, expect } from "vitest";
import postgres from "postgres";

const TARGET = process.env.ISOLATION_TARGET ?? "staging";

const REQUIRED = [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "STRIPE_SECRET",
  "NEON_DATABASE_URL",
  "EXPECTED_NEON_HOST",
  "PRODUCTION_NEON_HOST",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
] as const;

describe(`isolation: ${TARGET}`, () => {
  it("has the full secret set for this environment", () => {
    const missing = REQUIRED.filter((k) => !process.env[k]);
    expect(missing, `missing secrets: ${missing.join(", ")}`).toEqual([]);
  });

  it("Plaid: credentials are sandbox, and production rejects them", async () => {
    const body = JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      country_codes: ["US"],
      count: 1,
      offset: 0,
    });
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    };
    const sandbox = await fetch("https://sandbox.plaid.com/institutions/get", opts);
    expect(sandbox.status, "sandbox must accept this environment's Plaid creds").toBe(200);

    const production = await fetch("https://production.plaid.com/institutions/get", opts);
    expect(
      production.status,
      "production.plaid.com must reject this environment's Plaid creds"
    ).not.toBe(200);
  });

  it("Stripe: key is test mode by shape and by behavior", async () => {
    const key = process.env.STRIPE_SECRET!;
    expect(key.startsWith("sk_test_") || key.startsWith("rk_test_")).toBe(true);

    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const balance = (await res.json()) as { livemode: boolean };
    expect(balance.livemode, "Stripe reports this key as live mode").toBe(false);
  });

  it("Neon: connected branch is this environment's, not production", async () => {
    const url = new URL(process.env.NEON_DATABASE_URL!);
    expect(url.hostname).toBe(process.env.EXPECTED_NEON_HOST);
    expect(url.hostname).not.toBe(process.env.PRODUCTION_NEON_HOST);

    const sql = postgres(process.env.NEON_DATABASE_URL!, { max: 1 });
    try {
      const [row] = await sql`select 1 as ok`;
      expect(row.ok).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("Twilio: credentials cannot send a real SMS", async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

    // Twilio test credentials only accept magic numbers as From. A send from a
    // real-looking number must be rejected (21212: invalid From).
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: "+15551234567",
          To: "+15005550006",
          Body: "isolation probe, must not send",
        }),
      }
    );
    expect(res.status, "Twilio accepted a send it must reject").toBe(400);
    const err = (await res.json()) as { code: number };
    expect(err.code).toBe(21212);
  });
});
