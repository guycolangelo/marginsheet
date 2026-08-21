// The signature check is watched REFUSING, not only accepting.
//
// A SIGNATURE VERIFIER THAT ACCEPTS EVERYTHING IS INDISTINGUISHABLE FROM ONE
// THAT WORKS, ON A REAL EVENT, FOREVER (Guy, 21 Aug 2026). Every webhook
// arrives, every one is processed, nothing reports a fault. So the acceptance
// criterion is both halves observed: a correctly signed webhook verifying AND a
// tampered one refused. It is the same reasoning as every gate in this
// repository that was watched refusing before it was trusted to permit.
//
// IT SIGNS ITS OWN WEBHOOKS. A local server stands in for
// /webhook_verification_key/get and returns a JWK this test generated, so the
// accept path is exercised offline rather than waiting for production. The
// refuse paths then differ from it by exactly one thing each, which is the
// minimal-mutation rule applied to a fixture rather than to a control.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { verifyPlaidWebhook } from "../src/webhook-verify.js";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function sha256Hex(body: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let keyPair: CryptoKeyPair;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      // Stands in for Plaid. Only the key endpoint is needed.
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ key: jwk }));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => server.close());

const credentials = () => ({ clientId: "x", secret: "y", baseUrl });

/** Builds a JWT the verifier should accept, then lets a caller break exactly
 *  one thing about it. */
async function signed(body: string, tweak: { alg?: string; hash?: string; iat?: number; corrupt?: boolean } = {}) {
  const header = { alg: tweak.alg ?? "ES256", kid: "test-key" };
  const payload = {
    iat: tweak.iat ?? Math.floor(Date.now() / 1000),
    request_body_sha256: tweak.hash ?? (await sha256Hex(body)),
  };
  const signing = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(signing))
  );
  if (tweak.corrupt) signature[0] ^= 0xff;
  return `${signing}.${b64url(signature)}`;
}

const BODY = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "itm" });

describe("a correctly signed webhook", () => {
  it("verifies, so the refusals below mean something", async () => {
    // THE POSITIVE CASE FIRST, and it is not decoration: every refusal below
    // would pass against a verifier hard-wired to reject, which is the same
    // defect as a gate that can only refuse looking like a careful one.
    const outcome = await verifyPlaidWebhook(BODY, await signed(BODY), credentials());
    expect(outcome).toEqual({ verified: true });
  });
});

describe("a webhook that is not what it claims", () => {
  it("refuses a corrupted signature", async () => {
    const outcome = await verifyPlaidWebhook(BODY, await signed(BODY, { corrupt: true }), credentials());
    expect(outcome).toEqual({ verified: false, reason: "the signature does not verify" });
  });

  it("refuses a body that does not match the signed hash", async () => {
    // THE REPLAY CASE. A genuine, correctly signed token, presented against a
    // DIFFERENT body. Without this claim check the signature proves only that
    // Plaid signed something, not that it signed THIS.
    const token = await signed(BODY);
    const outcome = await verifyPlaidWebhook(BODY.replace("itm", "other"), token, credentials());
    expect(outcome).toEqual({ verified: false, reason: "the body does not match request_body_sha256" });
  });

  it("refuses an algorithm it did not ask for", async () => {
    // ALG CONFUSION. A verifier that takes alg from the token is taking
    // instructions from the thing it is checking.
    const outcome = await verifyPlaidWebhook(BODY, await signed(BODY, { alg: "none" }), credentials());
    expect(outcome.verified).toBe(false);
    expect((outcome as { reason: string }).reason).toMatch(/alg is none/);
  });

  it("refuses one that is older than five minutes", async () => {
    const old = Math.floor(Date.now() / 1000) - 6 * 60;
    const outcome = await verifyPlaidWebhook(BODY, await signed(BODY, { iat: old }), credentials());
    expect(outcome).toEqual({ verified: false, reason: "the webhook is more than 5 minutes old" });
  });

  it("refuses one with no header at all", async () => {
    expect(await verifyPlaidWebhook(BODY, null, credentials())).toEqual({
      verified: false,
      reason: "no Plaid-Verification header",
    });
  });
});
