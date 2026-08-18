// marginsheet-sync: the deployable that holds TOKEN_ENCRYPTION_KEY.
//
// NO PUBLIC ROUTES, BY RULING (M4 section 2a). Reachable only over a service
// binding from api, so a household request cannot arrive at the Worker that can
// decrypt Plaid tokens.
//
// /health RUNS A REAL QUERY, and that is the whole point of this file's second
// version. The first reported {databaseUrl: true, tokenEncryptionKey: true},
// which says the secrets are PRESENT and says nothing about whether they WORK.
// Those are different claims and the first is the kind that reports green while
// the second is false: on 15 Aug 2026 six Workers held connection strings that
// were the empty string and every environment reported healthy for hours.
// Presence is the empty-string incident with a better disguise.

import { readSyncSchemaHealth } from "@marginsheet/shared/db";
import { encryptToken, decryptToken } from "./token-crypto.js";

export interface Env {
  ENVIRONMENT: string;
  BUILD_SHA?: string;
  NEON_DATABASE_URL?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
}

// THE SECRETS THIS WORKER MUST HOLD, AND MUST HOLD NON-EMPTY.
//
// WHY THE WORKER REPORTS THIS AND NOT THE INVENTORY. `wrangler secret list`
// returns {name, type} and NEVER a value or a length, so secret-inventory can
// only prove a name exists. A secret set to the empty string passes it
// perfectly, which is exactly the 15 Aug 2026 incident: six connection-string
// secrets held the empty string, every environment reported healthy, and
// nothing was asking.
//
// The Worker is the only thing that can see the value, so the Worker answers.
// Booleans only; no length, no prefix, no part of any value.
const REQUIRED_SECRETS = [
  "NEON_DATABASE_URL",
  "TOKEN_ENCRYPTION_KEY",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
] as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const database = env.NEON_DATABASE_URL
        ? await readSyncSchemaHealth(env.NEON_DATABASE_URL)
        : {
            ok: false,
            error: "NEON_DATABASE_URL is not usable",
            present: env.NEON_DATABASE_URL !== undefined,
            length: env.NEON_DATABASE_URL?.length ?? 0,
          };

      // NON-EMPTY, not merely present. Three different claims, and this is the
      // second: (1) the name exists, which secret-inventory proves from
      // wrangler; (2) the value is not empty, which only the Worker can see and
      // which is reported here; (3) the value WORKS, which needs a real call.
      // TOKEN_ENCRYPTION_KEY reaches (3) at /debug/crypto-selftest and
      // NEON_DATABASE_URL reaches it through database.ok. The Plaid pair stops
      // at (2) until 4.3.2 makes a real exchange.
      const secrets = Object.fromEntries(
        REQUIRED_SECRETS.map((name) => [name, Boolean(env[name]?.length)])
      ) as Record<(typeof REQUIRED_SECRETS)[number], boolean>;
      const allPresent = Object.values(secrets).every(Boolean);

      return Response.json(
        {
          service: "marginsheet-sync",
          environment: env.ENVIRONMENT,
          build: env.BUILD_SHA ?? "unknown",
          database,
          // Kept for the existing deploy check rather than renamed under it.
          tokenKeyPresent: secrets.TOKEN_ENCRYPTION_KEY,
          secrets,
        },
        { status: database.ok && allPresent ? 200 : 503 }
      );
    }

    // GET /debug/crypto-selftest: THE DEPLOYED ROUND TRIP.
    //
    // The unit tests supply their own key, which proves the algorithm and says
    // nothing about the value in the secret store. Malformed, truncated and
    // wrong-length keys all pass a round trip against a key the test generated
    // itself. This exercises THE KEY THIS WORKER ACTUALLY HOLDS, which is the
    // independent-expectation rule reaching a secret.
    //
    // Returns three booleans and no key material, no ciphertext and no
    // plaintext beyond a fixed literal that is not a token.
    if (url.pathname === "/debug/crypto-selftest") {
      const keyMaterial = env.TOKEN_ENCRYPTION_KEY;
      if (!keyMaterial) {
        return Response.json(
          { error: "no TOKEN_ENCRYPTION_KEY on this Worker", roundTrip: false },
          { status: 503 }
        );
      }

      const PROBE = "marginsheet-crypto-selftest-not-a-token";
      const result = { roundTrip: false, wrongKeyRejected: false, tamperRejected: false, error: null as string | null };

      try {
        const encrypted = await encryptToken(PROBE, keyMaterial);
        result.roundTrip = (await decryptToken(encrypted, keyMaterial)) === PROBE;

        // A wrong key, derived by mutating the real one in memory. Never
        // stored, never returned, never logged.
        const raw = Uint8Array.from(atob(keyMaterial), (c) => c.charCodeAt(0));
        raw[0] ^= 0xff;
        const wrongKey = btoa(String.fromCharCode(...raw));
        result.wrongKeyRejected = await decryptToken(encrypted, wrongKey).then(() => false, () => true);

        // ONE FLIPPED BYTE OF CIPHERTEXT UNDER THE CORRECT KEY. Nothing but
        // tag verification rejects this, so it proves the tag is checked on
        // the deployed code path rather than assumed from the library.
        const [version, iv, ct] = encrypted.split(".");
        const bytes = Uint8Array.from(
          atob(ct.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (ct.length % 4)) % 4)),
          (c) => c.charCodeAt(0)
        );
        bytes[0] ^= 0x01;
        const tampered = btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        result.tamperRejected = await decryptToken(`${version}.${iv}.${tampered}`, keyMaterial)
          .then(() => false, () => true);
      } catch (error) {
        // The message from token-crypto names the length of a bad key and
        // never any part of its value.
        result.error = error instanceof Error ? error.message : String(error);
      }

      const ok = result.roundTrip && result.wrongKeyRejected && result.tamperRejected;
      return Response.json(result, { status: ok ? 200 : 503 });
    }

    return new Response("not found", { status: 404 });
  },
};
