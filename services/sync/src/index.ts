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
import { secretPresence } from "@marginsheet/shared/required-secrets";
import { HouseholdSync } from "./household-sync-do.js";

// The DO class must be exported from the Worker entry point for the runtime to
// find it. The binding is declared in wrangler.jsonc against this name.
export { HouseholdSync };

export interface Env {
  ENVIRONMENT: string;
  DEBUG_PROBE_TOKEN?: string;
  BUILD_SHA?: string;
  NEON_DATABASE_URL?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_BASE_URL?: string;
  HOUSEHOLD_SYNC?: DurableObjectNamespace;
}

// The required-secret derivation moved to @marginsheet/shared at the point a
// third Worker needed it. Same reasoning that produced it: a second copy of a
// requirement drifts by default.


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
      const secrets = secretPresence("sync", env.ENVIRONMENT, env as unknown as Record<string, unknown>);
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
    // EVERY /debug ROUTE REQUIRES A PROBE TOKEN. Refused by default.
    //
    // WHAT THEY DISCLOSE, captured live on 19 Aug 2026: no values, and that is
    // not the same as nothing. Environment, build, migration and table counts,
    // the database role, and WHICH SECRETS EXIST BY NAME, which names our
    // vendors. Reconnaissance rather than credentials.
    //
    // GATED BY CREDENTIAL, NOT BY ENVIRONMENT, and that distinction was paid
    // for. An `ENVIRONMENT === "production"` refusal was written first and
    // would have 404'd the production routes that db-identity.test.ts and
    // verify-deploy.sh depend on, BLINDING FIVE LIVE CONTROLS in the one
    // environment that matters. A gate that silences the checks watching the
    // thing it guards is not a gate, it is an outage with a rationale.
    //
    // The token is REQUIRED, never optional-if-configured: a gate that
    // activates only when a secret happens to be present fails open exactly
    // when somebody forgets to paste it. An absent token refuses everything,
    // which fails closed and is loud.
    //
    // 404 rather than 403, because a 403 confirms the route exists.
    if (url.pathname.startsWith("/debug/")) {
      const presented = request.headers.get("x-probe-token");
      if (!env.DEBUG_PROBE_TOKEN || presented !== env.DEBUG_PROBE_TOKEN) {
        return new Response("Not found", { status: 404 });
      }
    }

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

    // /internal/sync-lock/:householdId/* routes to the household's Durable
    // Object. ONE OBJECT PER HOUSEHOLD, by name, so two syncs for one household
    // meet and two syncs for different households do not.
    //
    // idFromName is what makes the lock a lock. A newUniqueId per request would
    // give every caller its own object, every object its own chain, and no
    // mutual exclusion whatever, while looking correct in every way a reader
    // checks. Enforced by household-sync-lock.test.ts, which asserts a fresh
    // name has seen nothing while a used one has, so per-name and per-request
    // are distinguishable.
    if (url.pathname.startsWith("/internal/sync-lock/")) {
      if (!env.HOUSEHOLD_SYNC) {
        return Response.json({ error: "HOUSEHOLD_SYNC binding is absent" }, { status: 500 });
      }
      const [, , , householdId, ...rest] = url.pathname.split("/");
      if (!householdId) return Response.json({ error: "household id is required" }, { status: 400 });
      const stub = env.HOUSEHOLD_SYNC.get(env.HOUSEHOLD_SYNC.idFromName(householdId));
      const inner = new URL(request.url);
      inner.pathname = "/" + rest.join("/");
      return stub.fetch(new Request(inner.toString(), request));
    }

    return new Response("not found", { status: 404 });
  },
};
