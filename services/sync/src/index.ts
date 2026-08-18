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
import { exchangePublicToken } from "./exchange.js";

export interface Env {
  ENVIRONMENT: string;
  BUILD_SHA?: string;
  NEON_DATABASE_URL?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_BASE_URL?: string;
}

// THE SECRETS THIS WORKER MUST HOLD, AND MUST HOLD NON-EMPTY.
//
// WHY THE WORKER REPORTS THIS AND NOT THE INVENTORY. `wrangler secret list`
// returns {name, type} and NEVER a value or a length, so secret-inventory can
// only prove a name exists. A secret set to the empty string passes it
// perfectly, which is exactly the 15 Aug 2026 incident. The Worker is the only
// thing that can see the value, so the Worker answers. Booleans only; no
// length, no prefix, no part of any value.
//
// DERIVED FROM THE DECLARATION, PER ENVIRONMENT, NOT HAND-WRITTEN HERE. The
// first version listed all four unconditionally and production went red on the
// Plaid pair, which is deferred to task 4.5b and legitimately absent. That was
// two hand-maintained statements of one requirement disagreeing on their first
// contact with reality.
//
// This is not the independent-expectation rule being broken. That rule forbids
// a CHECK reading its expectation from its SUBJECT. Here the declaration is the
// single statement of what should be present, and two different checks verify
// two different properties of it: secret-inventory compares the declared NAMES
// against what Cloudflare holds, and this compares the declared names against
// what is NON-EMPTY at runtime. Neither reads its expectation from the thing it
// is checking.
//
// It also means 4.5b cannot be half-done. Adding the Plaid pair to
// sync/production in the declaration makes this Worker require them too, so a
// paste that is declared and never performed fails the next deploy.
import workerSecrets from "../../../config/worker-secrets.json";

function requiredSecrets(environment: string): string[] {
  const declared = (workerSecrets as { workers: Record<string, Record<string, string[]>> })
    .workers.sync?.[environment];
  if (!declared) {
    // An environment the declaration does not know about. Fails closed: better
    // a deploy that stops than one that verifies nothing.
    throw new Error(`config/worker-secrets.json declares no sync secrets for "${environment}"`);
  }
  return declared;
}

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
      const required = requiredSecrets(env.ENVIRONMENT);
      const secrets = Object.fromEntries(
        required.map((name) => [name, Boolean((env as unknown as Record<string, string | undefined>)[name]?.length)])
      );
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

    // POST /internal/exchange: the token exchange, reachable only over the
    // service binding from api. There is no public route to this Worker, so
    // "internal" describes what is true rather than what is intended.
    //
    // The response carries NO access token. That is the section 4a boundary and
    // it is asserted by test, because a token here would break nothing: the
    // exchange would still work, the household would still connect, and every
    // other test would still pass.
    if (url.pathname === "/internal/exchange" && request.method === "POST") {
      const { publicToken, householdId } = (await request.json()) as {
        publicToken?: string;
        householdId?: string;
      };
      if (!publicToken || !householdId) {
        return Response.json({ error: "publicToken and householdId are required" }, { status: 400 });
      }
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY || !env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        // Fails closed and names WHICH is missing, without any value.
        const missing = (["NEON_DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "PLAID_CLIENT_ID", "PLAID_SECRET"] as const)
          .filter((k) => !env[k]?.length);
        return Response.json({ error: `sync is not configured: ${missing.join(", ")}` }, { status: 503 });
      }

      try {
        const result = await exchangePublicToken(
          publicToken,
          householdId,
          {
            clientId: env.PLAID_CLIENT_ID,
            secret: env.PLAID_SECRET,
            baseUrl: env.PLAID_BASE_URL,
          },
          env.TOKEN_ENCRYPTION_KEY,
          env.NEON_DATABASE_URL
        );
        return Response.json(result);
      } catch (error) {
        // PlaidError.toJSON enumerates what may be published. A raw error is
        // never returned, because the request body is what carries the token.
        const shaped = error as { toJSON?: () => unknown; name?: string };
        return Response.json(
          { error: "exchange failed", detail: shaped.toJSON ? shaped.toJSON() : { name: shaped.name ?? "Error" } },
          { status: 502 }
        );
      }
    }

    return new Response("not found", { status: 404 });
  },
};
