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
import { disconnectItem } from "./disconnect.js";
import { handlePlaidWebhook } from "./webhook-handler.js";
import { setItemWebhook } from "./set-webhook.js";
import { clearFirstSyncMilestone } from "./clear-milestone.js";
import { enableLiabilities } from "./enable-liabilities.js";
import { verifyPlaidWebhook } from "./webhook-verify.js";
import { itemStatus } from "./item-status.js";
import { readoutForHousehold } from "./ledger-readout.js";
import { readLedger, type Sql as ReadoutSql } from "./ledger-readout-sql.js";
import { encryptToken, decryptToken } from "./token-crypto.js";
import { exchangePublicToken } from "./exchange.js";
import { createLinkToken, itemProducts } from "./reconnect.js";
import { runSyncForItem } from "./run-sync.js";
import postgres from "postgres";
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
  PLAID_REDIRECT_URI?: string;
  PLAID_WEBHOOK_URL?: string;
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
    // POST /internal/item-products: what products each Item actually carries.
    //
    // BEHIND THE /debug GATE IN SPIRIT AND BEHIND THE SESSION IN FACT: it is
    // reachable only over the service binding from api, which requires a
    // session and derives the household. It returns three string arrays and no
    // credential, which is the same shape as /debug/crypto-selftest.
    if (url.pathname === "/internal/item-products" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const { householdId } = (await request.json().catch(() => ({}))) as { householdId?: string };
      if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });

      const sql = postgres(env.NEON_DATABASE_URL, { max: 1 });
      let items: { id: string; item_id: string }[];
      try {
        items = await sql<{ id: string; item_id: string }[]>`
          select id, item_id from plaid_items where household_id = ${householdId} order by created_at
        `;
      } finally {
        await sql.end({ timeout: 5 });
      }

      const results: unknown[] = [];
      for (const item of items) {
        try {
          const products = await itemProducts(
            householdId,
            item.id,
            { clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, baseUrl: env.PLAID_BASE_URL },
            env.TOKEN_ENCRYPTION_KEY,
            env.NEON_DATABASE_URL
          );
          results.push({ itemId: item.item_id, ...products });
        } catch (error) {
          // One Item failing does not hide the others, same as the sync run.
          const shaped = error as { toJSON?: () => unknown; message?: string };
          results.push({
            itemId: item.item_id,
            failed: true,
            detail: shaped.toJSON ? shaped.toJSON() : { message: shaped.message ?? "unknown" },
          });
        }
      }
      return Response.json({ items: items.length, results });
    }

    // POST /internal/sync-run: run a sync for every Item a household holds.
    //
    // THE HAND-RUN TRIGGER (4.5b prime, piece 6). Throwaway: scheduling is
    // Cron and Queues, and the webhook path is 4.5's other half. This exists so
    // a ledger can be produced before either.
    //
    // IT TAKES THE CHAIN LOCK, since 4.5's second half. The earlier comment
    // said this route would be REPLACED when the receiver landed, and that was
    // written on the assumption that only one caller would ever exist. The
    // assumption ends with the receiver, so the route survives and takes the
    // lock instead: a hand-run sync and a webhook-driven one are now two
    // callers for one household, which is exactly what the lock is for.
    //
    // THE BUTTON IS KEPT DELIBERATELY, AND THE REASON IS WORTH THE LINES
    // (Guy, 21 Aug 2026). It is now the ONLY place in this system where a real
    // sync runs while a person reads the result. Everything else about to
    // happen here happens unobserved. THE FIRST TIME A MACHINE DOES THIS
    // UNOBSERVED SHOULD NOT ALSO BE THE FIRST TIME IT DOES IT, which is the
    // argument for shadow mode arriving three modules early, and it is why
    // this survives to M5 rather than because anyone is fond of it.
    //
    // A decision we remember is a decision that survives until the person who
    // remembers it is busy, so it is written here rather than agreed.
    if (url.pathname === "/internal/sync-run" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const { householdId } = (await request.json().catch(() => ({}))) as { householdId?: string };
      if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });

      const sql = postgres(env.NEON_DATABASE_URL, { max: 1 });
      let items: { id: string; item_id: string }[];
      try {
        // SCOPED, and keyed on our own id only after the household narrows it.
        items = await sql<{ id: string; item_id: string }[]>`
          select id, item_id from plaid_items
           where household_id = ${householdId}
             and status <> 'error'
           order by created_at
        `;
      } finally {
        await sql.end({ timeout: 5 });
      }

      const results: unknown[] = [];
      for (const item of items) {
        try {
          // THROUGH THE LOCK, exactly as the receiver does. Two paths, one
          // critical section: a button pressed while a webhook is mid-sync
          // waits rather than running beside it.
          if (!env.HOUSEHOLD_SYNC) throw new Error("HOUSEHOLD_SYNC binding is absent");
          const stub = env.HOUSEHOLD_SYNC.get(env.HOUSEHOLD_SYNC.idFromName(householdId));
          const locked = await stub.fetch(
            new Request("https://sync.internal/sync", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ householdId, itemRowId: item.id }),
            })
          );
          const outcome = (await locked.json()) as { ran?: boolean; result?: unknown; error?: string };
          if (outcome.error) throw new Error(outcome.error);
          results.push(outcome.result);
        } catch (error) {
          // ONE ITEM FAILING DOES NOT HIDE THE OTHERS. A household with four
          // banks should learn which one broke, not that "the sync failed".
          const shaped = error as { toJSON?: () => unknown; message?: string };
          results.push({
            itemId: item.item_id,
            failed: true,
            detail: shaped.toJSON ? shaped.toJSON() : { message: shaped.message ?? "unknown" },
          });
        }
      }
      return Response.json({ items: items.length, results });
    }

    // POST /internal/plaid-totals: ask Plaid how many transactions exist.
    //
    // THE CROSS-CHECK, and it lives here for the same reason link-token does:
    // the access token and the client secret are both here and neither is in
    // api. It is throwaway with the rest of the 4.5b prime surface.
    //
    // It reads nothing of ours and writes nothing. Our own counts come from
    // api, which can read the tables; this route exists ONLY to obtain a number
    // that did not come from us, because a readout assembled from our tables
    // agrees with itself whatever went wrong.
    // POST /internal/set-webhook: point an existing Item at the receiver.
    //
    // NO RELINK REQUIRED. /item/webhook/update sets the URL on an Item that was
    // created without one, with no Link update mode, confirmed against Plaid's
    // documentation on 21 Aug 2026 rather than recalled. It also fires
    // WEBHOOK_UPDATE_ACKNOWLEDGED at the new URL, which is why it is the
    // acceptance criterion for this task: a real Item, a real signature, a real
    // provider_events write, and no consequence if mishandled.
    //
    // IT REQUIRES confirm, LIKE THE OTHER TWO DELIBERATE ACTIONS ON THIS
    // SURFACE. This is the switch that turns on unattended operation: after it,
    // syncs fire without anybody watching. That is worth a second call rather
    // than a button.
    if (url.pathname === "/internal/set-webhook" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const b = (await request.json().catch(() => ({}))) as {
        householdId?: string; itemId?: string; webhookUrl?: string; confirm?: boolean;
      };
      if (!b.householdId || !b.itemId || !b.webhookUrl) {
        return Response.json({ error: "householdId, itemId and webhookUrl are required" }, { status: 400 });
      }
      try {
        return Response.json(
          await setItemWebhook(
            b.householdId,
            b.itemId,
            b.webhookUrl,
            { clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, baseUrl: env.PLAID_BASE_URL },
            env.TOKEN_ENCRYPTION_KEY,
            env.NEON_DATABASE_URL,
            b.confirm === true
          )
        );
      } catch (error) {
        const e = error as { toJSON?: () => unknown; message?: string };
        return Response.json(
          { error: "set-webhook failed", detail: e.toJSON ? e.toJSON() : { message: e.message ?? "unknown" } },
          { status: 500 }
        );
      }
    }

    // POST /internal/plaid-webhook: the receiver, and 4.5's remaining half.
    //
    // api forwards the RAW body because the signature covers its bytes. A JSON
    // round trip anywhere between Plaid and this line destroys the proof, so
    // nothing between them parses it.
    //
    // THE ORDER IS DELIBERATE: verify, then record, then dispatch. Recording an
    // unverified event would let anyone who can reach the public URL write rows
    // into provider_events, and dispatching before recording would let a retry
    // storm run several syncs for one event.
    if (url.pathname === "/internal/plaid-webhook" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const rawBody = await request.text();
      const credentials = {
        clientId: env.PLAID_CLIENT_ID,
        secret: env.PLAID_SECRET,
        baseUrl: env.PLAID_BASE_URL,
      };

      const outcome = await verifyPlaidWebhook(rawBody, request.headers.get("plaid-verification"), credentials);
      if (!outcome.verified) {
        // 401 AND THE REASON. A verifier that answers only true or false turns
        // four different failures into one support conversation, and this is
        // the half that must be watched refusing before the other half is
        // trusted to permit.
        return Response.json({ error: "webhook not verified", reason: outcome.reason }, { status: 401 });
      }

      return Response.json(
        await handlePlaidWebhook(rawBody, credentials, env.TOKEN_ENCRYPTION_KEY, env.NEON_DATABASE_URL, env.HOUSEHOLD_SYNC)
      );
    }

    // POST /internal/disconnect-item: remove one Item at Plaid.
    //
    // THE FIRST PIECE OF M8's DISCONNECT FLOW. A household disconnecting a bank
    // and an operator removing an Item are the same call with a different
    // caller, so this is built as the real path rather than as scaffolding.
    // POST /internal/enable-liabilities: start a per-Item recurring charge,
    // deliberately. Dry run by default, and the dry run names the cost.
    if (url.pathname === "/internal/enable-liabilities" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      const b = (await request.json().catch(() => ({}))) as { householdId?: string; confirm?: boolean; itemIds?: string[] };
      if (!b.householdId) {
        return Response.json({ error: "householdId is required" }, { status: 400 });
      }
      try {
        const result = await enableLiabilities(
          env.NEON_DATABASE_URL, b.householdId, b.confirm === true,
          Array.isArray(b.itemIds) ? b.itemIds : []
        );
        return Response.json(result, { status: result.refused ? 409 : 200 });
      } catch (error) {
        const e = error as { message?: string };
        return Response.json(
          { error: "enable-liabilities failed", detail: { message: e.message ?? "unknown" } },
          { status: 500 }
        );
      }
    }

    // POST /internal/clear-first-sync-milestone: correct a set-once field that
    // was written under a definition 0036 replaced. Dry run by default.
    if (url.pathname === "/internal/clear-first-sync-milestone" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      const b = (await request.json().catch(() => ({}))) as {
        householdId?: string; confirm?: boolean;
      };
      if (!b.householdId) {
        return Response.json({ error: "householdId is required" }, { status: 400 });
      }
      try {
        const result = await clearFirstSyncMilestone(
          env.NEON_DATABASE_URL, b.householdId, b.confirm === true
        );
        return Response.json(result, { status: result.refused ? 409 : 200 });
      } catch (error) {
        const e = error as { message?: string };
        return Response.json(
          { error: "clear-milestone failed", detail: { message: e.message ?? "unknown" } },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/internal/disconnect-item" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const b = (await request.json().catch(() => ({}))) as {
        householdId?: string; itemId?: string; confirm?: boolean;
      };
      if (!b.householdId || !b.itemId) {
        return Response.json({ error: "householdId and itemId are required" }, { status: 400 });
      }
      try {
        const result = await disconnectItem(
          b.householdId,
          b.itemId,
          { clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, baseUrl: env.PLAID_BASE_URL },
          env.TOKEN_ENCRYPTION_KEY,
          env.NEON_DATABASE_URL,
          b.confirm === true
        );
        return Response.json(result, { status: result.refused ? 409 : 200 });
      } catch (error) {
        // Every failure comes back as JSON carrying its detail, for the reason
        // the readout learned: an escaped exception becomes an error page the
        // caller cannot parse, and an unparseable body reads as nothing to say.
        const e = error as { toJSON?: () => unknown; message?: string };
        return Response.json(
          { error: "disconnect failed", detail: e.toJSON ? e.toJSON() : { message: e.message ?? "unknown" } },
          { status: 500 }
        );
      }
    }

    // POST /internal/item-status: is this Item still live at Plaid?
    //
    // Asked before api deletes anything of ours. It lives here because the
    // access token does; api never holds one.
    if (url.pathname === "/internal/item-status" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const body = (await request.json().catch(() => ({}))) as { householdId?: string; itemId?: string };
      if (!body.householdId || !body.itemId) {
        return Response.json({ error: "householdId and itemId are required" }, { status: 400 });
      }
      return Response.json(
        await itemStatus(
          body.householdId,
          body.itemId,
          { clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, baseUrl: env.PLAID_BASE_URL },
          env.TOKEN_ENCRYPTION_KEY,
          env.NEON_DATABASE_URL
        )
      );
    }

    // POST /internal/ledger-readout: our tables beside Plaid's own count.
    //
    // IT RUNS HERE BECAUSE THE TABLES DO. api threw "permission denied for
    // table plaid_items" reading last_cursor_at, a column 0027 added and
    // granted to nobody: marginsheet_app holds plaid_items as an enumerated
    // column list, deliberately, so a column added later is excluded. Moving
    // the statements to the role that holds these tables widens no grant, and
    // granting api a table to fix a diagnostic would be the worst available
    // reason to touch that boundary (Guy, 20 Aug 2026).
    if (url.pathname === "/internal/ledger-readout" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const { householdId } = (await request.json().catch(() => ({}))) as { householdId?: string };
      if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });

      // EVERY FAILURE COMES BACK AS JSON CARRYING ITS DETAIL. The first version
      // let the exception escape, Cloudflare answered with its own error page,
      // and the button printed an empty object: indistinguishable from a
      // successful call with nothing to report, in a diagnostic built to
      // resolve exactly that kind of ambiguity. Postgres puts the useful part
      // in code, detail, hint and position, and a message alone loses all four.
      const sql = postgres(env.NEON_DATABASE_URL, { max: 1 });
      try {
        const ours = await sql.begin(async (tx) => readLedger(tx as unknown as ReadoutSql, householdId));
        const plaid = await readoutForHousehold(
          householdId,
          { clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, baseUrl: env.PLAID_BASE_URL },
          env.TOKEN_ENCRYPTION_KEY,
          env.NEON_DATABASE_URL
        );
        return Response.json({ ours, plaid: { items: plaid.length, results: plaid } });
      } catch (error) {
        const e = error as { message?: string; code?: string; detail?: string; hint?: string; position?: string };
        return Response.json(
          {
            error: "readout failed",
            detail: {
              message: e.message ?? String(error),
              code: e.code,
              detail: e.detail,
              hint: e.hint,
              position: e.position,
            },
          },
          { status: 500 }
        );
      } finally {
        await sql.end();
      }
    }

    if (url.pathname === "/internal/plaid-totals" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.TOKEN_ENCRYPTION_KEY) {
        return Response.json({ error: "sync is not configured" }, { status: 503 });
      }
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      const { householdId } = (await request.json().catch(() => ({}))) as { householdId?: string };
      if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });

      // THE LOOKUP AND THE DECRYPT LIVE IN THE MODULE, not here. This file
      // calls fetch, so naming a token in it would make it a second place a
      // Plaid request could be built, and the leak probe guards exactly one.
      const results = await readoutForHousehold(
        householdId,
        { clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, baseUrl: env.PLAID_BASE_URL },
        env.TOKEN_ENCRYPTION_KEY,
        env.NEON_DATABASE_URL
      );
      return Response.json({ items: results.length, results });
    }

    // POST /internal/link-token: mint a link token for a NEW connection.
    //
    // It lives here rather than in api because the Plaid credentials do. api
    // holds a public token briefly and never an access token, and it never
    // holds the client secret either.
    if (url.pathname === "/internal/link-token" && request.method === "POST") {
      if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
        return Response.json({ error: "Plaid credentials are not configured" }, { status: 503 });
      }
      if (!env.PLAID_REDIRECT_URI) {
        // REQUIRED RATHER THAN OPTIONAL. Absent, OAuth institutions still work
        // on desktop and break in mobile webview, which is a failure that
        // passes every test run on a laptop. Failing closed here makes the
        // missing configuration loud instead of latent.
        return Response.json({ error: "PLAID_REDIRECT_URI is not configured" }, { status: 503 });
      }
      if (!env.PLAID_WEBHOOK_URL) {
        // REQUIRED FOR THE SAME REASON AND WITH A WORSE FAILURE. An Item created
        // without a webhook receives NOTHING from Plaid: no
        // SYNC_UPDATES_AVAILABLE, no completion signal, no reauth notice. It
        // syncs only when a person clicks, forever, and every check agrees with
        // the stale ledger. Two of three production Items were in that state on
        // 21 Aug 2026 because this key was absent from the link token.
        return Response.json({ error: "PLAID_WEBHOOK_URL is not configured" }, { status: 503 });
      }
      const { householdId } = (await request.json().catch(() => ({}))) as { householdId?: string };
      if (!householdId) {
        return Response.json({ error: "householdId is required" }, { status: 400 });
      }
      try {
        const token = await createLinkToken(
          householdId,
          { clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, baseUrl: env.PLAID_BASE_URL },
          env.PLAID_REDIRECT_URI,
          env.PLAID_WEBHOOK_URL
        );
        return Response.json(token);
      } catch (error) {
        const shaped = error as { toJSON?: () => unknown; name?: string };
        return Response.json(
          { error: "link token failed", detail: shaped.toJSON ? shaped.toJSON() : { name: shaped.name ?? "Error" } },
          { status: 502 }
        );
      }
    }

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
