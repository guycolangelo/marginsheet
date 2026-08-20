// The app API worker. M0 scope: health only. Everything else arrives with its module.

import * as Sentry from "@sentry/cloudflare";
import { scrubEvent } from "@marginsheet/shared/sentry-scrub";
import { readDbIdentity, readSchemaHealth } from "@marginsheet/shared/db";
import { secretPresence } from "@marginsheet/shared/required-secrets";
import { createAuth } from "./auth.js";
import { postmarkSender } from "./email.js";
import { confirmSignIn, confirmLandingPage } from "./confirm.js";
import { limitsFor, recordSendIfPermitted } from "./send-limits.js";
import { changePhone } from "./phone-change.js";
import { recoveryRoutes } from "./recovery-routes.js";
import { invitationRoutes } from "./invitation-routes.js";
import { twilioVerifySender } from "./otp.js";
// Bundled at build time: Workers have no filesystem. Still config in the
// repo, still reviewable, and the environment picks its row at runtime.
import rateLimitConfig from "../../../config/rate-limits.json";
import postgres from "postgres";

export interface Env {
  // The sync Worker, reachable only from here. M4 section 4a: api proxies the
  // token exchange and never sees an access token. A binding is not a route.
  SYNC?: { fetch: (request: Request) => Promise<Response> };
  CONVERSATION?: { fetch: (request: Request) => Promise<Response> };
  ENVIRONMENT: "dev" | "staging" | "production";
  DEBUG_PROBE_TOKEN?: string;
  BUILD_SHA?: string;
  SENTRY_DSN?: string;
  NEON_DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  POSTMARK_TOKEN?: string;
  AUTH_FROM_EMAIL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
}

const SERVICE = "marginsheet-api";

// The 503 body distinguishes an absent binding from one bound to an empty
// string. On 15 Aug 2026 all six secrets held "" because a broken pipe stored
// nothing and wrangler accepted it silently; a check that reported both cases
// identically cost hours.
function unusableUrl(env: Env) {
  return {
    ok: false as const,
    error: "NEON_DATABASE_URL is not usable",
    present: env.NEON_DATABASE_URL !== undefined,
  };
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET /health
    //
    // Reports the commit at the edge AND whether this Worker can actually
    // query its database. Both halves are required: for ten merged PRs this
    // endpoint returned green against branches holding zero tables, because
    // it only ever proved the Worker had booted. A green health check on a
    // system that cannot query anything is worse than a red one, since it
    // converts an outage into a silence.
    //
    // It returns 503 when the database half fails, and deploy verification
    // fails on that, so code can no longer land against a schema it does not
    // match.
    // GET /debug/sync-health: the ONLY way to see marginsheet-sync from outside.
    //
    // The sync Worker has no public routes by ruling, so deploy verification
    // cannot curl it directly. It reaches it over the service binding instead,
    // which is the same path the token exchange will use at 4a, so this proves
    // the binding works as well as proving sync is healthy.
    //
    // Reports no secret material: sync's own /health returns a boolean for the
    // key's presence and never any part of its value.
    // POST /plaid/exchange: the household-facing end of the connect flow.
    //
    // api HOLDS A PUBLIC TOKEN BRIEFLY AND NEVER AN ACCESS TOKEN. A public
    // token is short-lived and single-use; an access token is neither. The
    // boundary is "api never holds an access token", not "api touches nothing
    // from Plaid" (plaid-pipeline-spec section 2).
    //
    // Everything past this line happens inside marginsheet-sync, which has no
    // public route and holds the only copy of the encryption key.
    if (url.pathname === "/plaid/exchange" && request.method === "POST") {
      // AN AUTHORIZATION INPUT NEVER COMES FROM THE REQUEST BODY.
      //
      // This handler used to read `householdId` out of the JSON and forward it,
      // and exchange.ts then did set_config('marginsheet.household_id', <that
      // value>). The authorization boundary was SET FROM A VALUE THE CALLER
      // CHOSE. RLS could not help: the household id was the input to the GUC
      // rather than a constraint on it, so every policy faithfully enforced
      // isolation for whichever household the caller named.
      //
      // Probed against production on 19 Aug 2026: an unauthenticated POST
      // answered 400, not 401, which is the handler rejecting the body SHAPE
      // after reaching it.
      //
      // householdId is no longer a field. It is not validated, because a field
      // that must be validated is a field somebody can forget to validate; the
      // parameter simply does not exist, and there is nothing to override.
      // Same shape as invitation-routes.ts and phone-change.ts, which both got
      // this right, which is the good news and also the uncomfortable part.
      if (!env.SYNC) {
        return Response.json({ error: "no SYNC service binding" }, { status: 503 });
      }
      if (!env.NEON_DATABASE_URL || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
        return Response.json({ error: "auth is not configured" }, { status: 503 });
      }
      const auth = createAuth({
        NEON_DATABASE_URL: env.NEON_DATABASE_URL,
        ENVIRONMENT: env.ENVIRONMENT,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      });
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.session) {
        return Response.json({ error: "not_signed_in" }, { status: 401 });
      }

      const sql = postgres(env.NEON_DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });
      let householdId: string;
      try {
        // The session names a USER. The member row names the household, and
        // auth_household_id is the SECURITY DEFINER bootstrap that reads it
        // (migration 0018). This is the only place the household comes from.
        const [row] = await sql<{ household_id: string | null }[]>`
          select public.auth_household_id(${session.user.id}) as household_id
        `;
        if (!row?.household_id) {
          return Response.json({ error: "no_household" }, { status: 403 });
        }
        householdId = row.household_id;
      } finally {
        await sql.end();
      }

      const body = (await request.json().catch(() => ({}))) as { publicToken?: unknown };
      if (typeof body.publicToken !== "string" || body.publicToken.length === 0) {
        return Response.json({ error: "publicToken is required" }, { status: 400 });
      }

      const response = await env.SYNC.fetch(
        new Request("https://sync.internal/internal/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // REBUILT, never spread from the request. Spreading would let a
          // caller-supplied householdId ride along and win by key order, which
          // is the same defect with an extra step.
          body: JSON.stringify({ publicToken: body.publicToken, householdId }),
        })
      );
      // Passed through unchanged. api does not read, reshape or log this body:
      // reshaping is where a token would be copied somewhere by accident.
      return new Response(await response.text(), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }

    // Both sync debug routes go through the one binding. Listed explicitly
    // rather than prefix-forwarded: a prefix would forward anything somebody
    // later adds to sync, including something that should not be public.
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

    if (url.pathname === "/debug/sync-health" || url.pathname === "/debug/sync-crypto") {
      if (!env.SYNC) {
        return Response.json(
          { error: "no SYNC service binding on this Worker" },
          { status: 503 }
        );
      }
      const target =
        url.pathname === "/debug/sync-crypto" ? "/debug/crypto-selftest" : "/health";
      // The token travels with the proxied request: the private Worker gates
      // its own /debug routes too, and defence does not rest on it being
      // unreachable. A second door has been found once already this week.
      const response = await env.SYNC.fetch(
        new Request(`https://sync.internal${target}`, {
          headers: { "x-probe-token": env.DEBUG_PROBE_TOKEN ?? "" },
        })
      );
      // Pass the status through. A 503 from sync must not become a 200 here,
      // which would be a proxy reporting health it did not receive.
      return new Response(await response.text(), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }

    // conversation's health and identity, over the binding rather than over the
    // internet.
    // db-identity used to fetch https://marginsheet-conversation*.workers.dev
    // directly, which worked only because that Worker was publicly reachable.
    // It is not any more, so the check reaches it the way everything else does.
    // Enumerated like the sync routes above, never prefix-forwarded.
    if (
      url.pathname === "/debug/conversation-identity" ||
      url.pathname === "/debug/conversation-health"
    ) {
      if (!env.CONVERSATION) {
        return Response.json({ error: "no CONVERSATION service binding on this Worker" }, { status: 503 });
      }
      // Enumerated, never prefix-forwarded, matching the sync routes above: a
      // prefix would publish anything anybody later adds to conversation.
      const target =
        url.pathname === "/debug/conversation-health" ? "/health" : "/debug/db-identity";
      const response = await env.CONVERSATION.fetch(
        new Request(`https://conversation.internal${target}`, {
          headers: { "x-probe-token": env.DEBUG_PROBE_TOKEN ?? "" },
        })
      );
      // Status passed through: a 503 from conversation must not become a 200
      // here, which would be a proxy reporting health it did not receive.
      return new Response(await response.text(), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/health") {
      const database = env.NEON_DATABASE_URL
        ? await readSchemaHealth(env.NEON_DATABASE_URL)
        : unusableUrl(env);

      // NON-EMPTY, not merely present. secret-inventory can only prove a NAME
      // exists, because wrangler never returns a value. An empty
      // BETTER_AUTH_SECRET means sessions signed with an empty key, and every
      // other check we have reports green while that is true.
      const secrets = secretPresence("api", env.ENVIRONMENT, env as unknown as Record<string, unknown>);
      const allPresent = Object.values(secrets).every(Boolean);

      return Response.json(
        {
          service: SERVICE,
          environment: env.ENVIRONMENT,
          build: env.BUILD_SHA ?? "unknown",
          database,
          secrets,
        },
        { status: database.ok && allPresent ? 200 : 503 }
      );
    }

    // GET /auth/confirm: the page the emailed link opens.
    //
    // This is the address in every sign-in email we send, so it is mounted
    // before anything that could need configuration: it spends no token,
    // touches no database, and therefore must never answer 503 because a
    // secret is missing. On 16 Aug 2026 this route did not exist at all and a
    // delivered link answered "Not found" to a real person.
    if (url.pathname === "/auth/confirm" && request.method === "GET") {
      return confirmLandingPage(request);
    }

    // The confirm action. The emailed link points at a page; that page calls
    // this. Nothing is spent by opening the link.
    if (url.pathname === "/auth/confirm" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
        return Response.json({ error: "auth is not configured" }, { status: 503 });
      }
      const auth = createAuth({
        NEON_DATABASE_URL: env.NEON_DATABASE_URL,
        ENVIRONMENT: env.ENVIRONMENT,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      });
      return confirmSignIn(auth, request, env.BETTER_AUTH_URL);
    }

    // The magic-link SEND is rate limited before Better Auth sees it (3.2e).
    //
    // Per email, so one address cannot be mailbox-bombed, and a global ceiling
    // as a cost backstop, because a runaway loop of our own making is at least
    // as likely as an attacker and spends the same Postmark budget. Per-SOURCE
    // limiting is not here and never will be: it lives at the Cloudflare edge
    // so the client IP never reaches this Worker. See config/edge-rate-limits
    // .json and the network identity doctrine.
    //
    // The refusal is a 429 and says nothing about whether the address is
    // registered, because it cannot: the limit counts attempts, and an
    // unrecognised address is limited identically to a known one.
    if (url.pathname === "/api/auth/sign-in/magic-link" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL) {
        return Response.json({ error: "auth is not configured" }, { status: 503 });
      }

      // clone(), because Better Auth still needs to read this body.
      const submitted = (await request
        .clone()
        .json()
        .catch(() => ({}))) as { email?: unknown };
      const subject =
        typeof submitted.email === "string" ? submitted.email.trim().toLowerCase() : "";

      const sql = postgres(env.NEON_DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });
      let decision;
      try {
        decision = await recordSendIfPermitted(
          sql,
          subject,
          limitsFor(env.ENVIRONMENT, rateLimitConfig)
        );
      } finally {
        await sql.end();
      }

      if (!decision.allowed) {
        // Fails closed, including when the ledger itself is unreachable. A
        // limiter that cannot count must not grant permission.
        return Response.json(
          { error: "too many sign-in requests", retry: "in a few minutes" },
          { status: 429 }
        );
      }
    }

    // The recovery path (3.1b). Mounted in the same task that built the
    // service, because a service with no caller is a control that cannot
    // fail, which is what the phone-change endpoint's absence proved.
    if (url.pathname.startsWith("/auth/recovery")) {
      if (!env.NEON_DATABASE_URL || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
        return Response.json({ error: "auth is not configured" }, { status: 503 });
      }
      const mail =
        env.POSTMARK_TOKEN && env.AUTH_FROM_EMAIL
          ? postmarkSender(env.POSTMARK_TOKEN, env.AUTH_FROM_EMAIL)
          : undefined;
      // Twilio credentials are deferred until M3's phone work ships them. With
      // none present the OTP half cannot be met, so recovery FAILS CLOSED
      // rather than completing on one factor.
      const otp =
        env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID
          ? twilioVerifySender(
              env.TWILIO_ACCOUNT_SID,
              env.TWILIO_AUTH_TOKEN,
              env.TWILIO_VERIFY_SERVICE_SID
            )
          : undefined;
      if (!mail || !otp) {
        return Response.json(
          { error: "recovery is not configured", detail: "both halves require a sender" },
          { status: 503 }
        );
      }

      const auth = createAuth({
        NEON_DATABASE_URL: env.NEON_DATABASE_URL,
        ENVIRONMENT: env.ENVIRONMENT,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      });
      const sql = postgres(env.NEON_DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });
      try {
        const handled = await recoveryRoutes(request, url, {
          sql,
          auth,
          mail,
          otp,
          baseUrl: env.BETTER_AUTH_URL,
          rpId: new URL(env.BETTER_AUTH_URL).hostname,
          origin: new URL(env.BETTER_AUTH_URL).origin,
        });
        if (handled) return handled;
      } finally {
        await sql.end();
      }
    }

    // Invitations (3.5). Creation is a SENSITIVE ACTION per amendment 11.
    if (url.pathname.startsWith("/household/invitations")) {
      if (!env.NEON_DATABASE_URL || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
        return Response.json({ error: "auth is not configured" }, { status: 503 });
      }
      const mail =
        env.POSTMARK_TOKEN && env.AUTH_FROM_EMAIL
          ? postmarkSender(env.POSTMARK_TOKEN, env.AUTH_FROM_EMAIL)
          : undefined;
      if (!mail) {
        // Delivery or nothing: an invitation that cannot be sent is not created.
        return Response.json({ error: "invitations are not configured" }, { status: 503 });
      }
      const auth = createAuth({
        NEON_DATABASE_URL: env.NEON_DATABASE_URL,
        ENVIRONMENT: env.ENVIRONMENT,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      });
      const sql = postgres(env.NEON_DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });
      try {
        const handled = await invitationRoutes(request, url, {
          sql,
          auth,
          mail,
          baseUrl: env.BETTER_AUTH_URL,
        });
        if (handled) return handled;
      } finally {
        await sql.end();
      }
    }

    // POST /auth/phone: the §1 tightening, enforced (3.1a).
    //
    // Owed since 15 Aug, when the 3.2 plan ruled for a minimal real endpoint
    // rather than a stand-in. Until this existed, mayChangePhone() was correct,
    // tested, and wired to nothing: no path could attempt a phone change, so
    // the tightening could not have gone red however broken it was.
    if (url.pathname === "/auth/phone" && request.method === "POST") {
      if (!env.NEON_DATABASE_URL || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
        return Response.json({ error: "auth is not configured" }, { status: 503 });
      }
      const auth = createAuth({
        NEON_DATABASE_URL: env.NEON_DATABASE_URL,
        ENVIRONMENT: env.ENVIRONMENT,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      });
      const sql = postgres(env.NEON_DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });
      try {
        return await changePhone(auth, sql, request);
      } finally {
        await sql.end();
      }
    }

    // Better Auth owns everything under /api/auth. This is the only place a
    // session is ever issued: tests reach it through realSignIn(), which takes
    // the cookie from a Set-Cookie header rather than constructing one.
    if (url.pathname.startsWith("/api/auth")) {
      if (!env.NEON_DATABASE_URL || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
        return Response.json({ error: "auth is not configured" }, { status: 503 });
      }
      const mail =
        env.POSTMARK_TOKEN && env.AUTH_FROM_EMAIL
          ? postmarkSender(env.POSTMARK_TOKEN, env.AUTH_FROM_EMAIL)
          : undefined;
      const auth = createAuth(
        {
          NEON_DATABASE_URL: env.NEON_DATABASE_URL,
          ENVIRONMENT: env.ENVIRONMENT,
          BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
          BETTER_AUTH_URL: env.BETTER_AUTH_URL,
        },
        mail
      );
      return auth.handler(request);
    }

    if (url.pathname === "/debug/db-identity") {
      if (!env.NEON_DATABASE_URL) {
        return Response.json(unusableUrl(env), { status: 503 });
      }
      // Only the role name and the BYPASSRLS flag leave this handler.
      return Response.json(await readDbIdentity(env.NEON_DATABASE_URL));
    }

    // /debug/sentry REMOVED 19 Aug 2026, not gated. Its only purpose was to
    // throw, and unauthenticated it is a way for a stranger to burn our Sentry
    // quota. Gating something whose whole job is to raise an error is more
    // machinery than deleting it.

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// The router, unwrapped. Exported so the journey test can enter through the
// same routing a browser hits: the 404 that started task 3.2a's rework was a
// ROUTING failure, and a test that calls the handler function directly cannot
// see one. Only Sentry's instrumentation wrapper is bypassed by using this.
export const router = handler;

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubEvent,
  }),
  handler
);
