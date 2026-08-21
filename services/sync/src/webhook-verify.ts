// Verifying that a webhook came from Plaid.
//
// THE CHECK IS THE POINT AND IT MUST BE WATCHED REFUSING (Guy, 21 Aug 2026).
// A signature verifier that accepts everything is indistinguishable from one
// that works, on a real event, forever: every webhook arrives, every one is
// processed, and nothing anywhere reports a fault. So the acceptance criterion
// is not that a real Plaid webhook verifies. It is that a real Plaid webhook
// verifies AND a tampered one is refused, both observed.
//
// THE FLOW, confirmed against Plaid's documentation on 21 Aug 2026 rather than
// recalled. The JWT arrives in the Plaid-Verification header. Its alg must be
// ES256 and anything else is refused rather than negotiated. Its kid names a
// key fetched from /webhook_verification_key/get with our client credentials.
// The payload carries request_body_sha256, which must equal the SHA-256 of the
// body AS RECEIVED, and iat must be within five minutes.
//
// THE BODY IS HASHED AS BYTES, WHICH DECIDES THE ARCHITECTURE. Plaid's own
// documentation notes the hash is sensitive to whitespace, so any component
// that parses and re-serialises the body destroys the proof. api therefore
// forwards the RAW text and this Worker verifies it: a JSON round trip between
// the two would silently break every signature.

import { callPlaid, type PlaidCredentials } from "./plaid-client.js";

export type VerificationOutcome =
  | { verified: true }
  | { verified: false; reason: string };

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/** CONSTANT TIME, because a comparison that returns early leaks how much of the
 *  hash matched, and a hash is exactly the thing an attacker would iterate. */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verifies one webhook. EVERY REFUSAL NAMES ITS REASON, because a verifier
 *  that answers only true or false turns four different failures into one
 *  support conversation. */
export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
  credentials: PlaidCredentials
): Promise<VerificationOutcome> {
  if (!verificationHeader) return { verified: false, reason: "no Plaid-Verification header" };

  const parts = verificationHeader.split(".");
  if (parts.length !== 3) return { verified: false, reason: "the header is not a three part JWT" };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    return { verified: false, reason: "the JWT segments are not decodable JSON" };
  }

  // ALG IS CHECKED BEFORE ANYTHING ELSE AND IS NOT NEGOTIABLE. A verifier that
  // takes alg from the token is taking instructions from the thing it is
  // checking, which is the oldest signature bug there is.
  if (header.alg !== "ES256") return { verified: false, reason: `alg is ${String(header.alg)}, not ES256` };
  if (typeof header.kid !== "string") return { verified: false, reason: "no kid in the JWT header" };

  let jwk: JsonWebKey;
  try {
    const response = await callPlaid<{ key: JsonWebKey }>("/webhook_verification_key/get", credentials, {
      key_id: header.kid,
    });
    jwk = response.key;
  } catch {
    // A key we cannot fetch is a webhook we cannot verify, which is a refusal
    // rather than an acceptance. Failing open here would make the whole check
    // conditional on Plaid's availability.
    return { verified: false, reason: "the verification key could not be fetched" };
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    return { verified: false, reason: "the verification key did not import" };
  }

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToBytes(parts[2]);
  const signatureValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signed);
  if (!signatureValid) return { verified: false, reason: "the signature does not verify" };

  // THE SIGNATURE COVERS THE CLAIMS, NOT THE BODY. Without this the token could
  // be replayed against a different payload entirely: a valid signature over a
  // hash of some other request.
  const expected = payload.request_body_sha256;
  if (typeof expected !== "string") return { verified: false, reason: "no request_body_sha256 claim" };
  if (!equalsConstantTime(expected, await sha256Hex(rawBody))) {
    return { verified: false, reason: "the body does not match request_body_sha256" };
  }

  const iat = payload.iat;
  if (typeof iat !== "number") return { verified: false, reason: "no iat claim" };
  if (Date.now() - iat * 1000 > FIVE_MINUTES_MS) return { verified: false, reason: "the webhook is more than 5 minutes old" };

  return { verified: true };
}
