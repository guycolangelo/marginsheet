// The app API worker. M0 scope: health only. Everything else arrives with its module.

import * as Sentry from "@sentry/cloudflare";
import { scrubEvent } from "@marginsheet/shared/sentry-scrub";
import { readDbIdentity, readSchemaHealth } from "@marginsheet/shared/db";
import { createAuth } from "./auth.js";
import { postmarkSender } from "./email.js";
import { confirmSignIn, confirmLandingPage } from "./confirm.js";
import { limitsFor, recordSendIfPermitted } from "./send-limits.js";
// Bundled at build time: Workers have no filesystem. Still config in the
// repo, still reviewable, and the environment picks its row at runtime.
import rateLimitConfig from "../../../config/rate-limits.json";
import postgres from "postgres";

export interface Env {
  ENVIRONMENT: "dev" | "staging" | "production";
  BUILD_SHA?: string;
  SENTRY_DSN?: string;
  NEON_DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  POSTMARK_TOKEN?: string;
  AUTH_FROM_EMAIL?: string;
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
    if (url.pathname === "/health") {
      const database = env.NEON_DATABASE_URL
        ? await readSchemaHealth(env.NEON_DATABASE_URL)
        : unusableUrl(env);

      return Response.json(
        {
          service: SERVICE,
          environment: env.ENVIRONMENT,
          build: env.BUILD_SHA ?? "unknown",
          database,
        },
        { status: database.ok ? 200 : 503 }
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

    if (url.pathname === "/debug/sentry") {
      throw new Error(`sentry wiring proof: ${SERVICE} ${env.ENVIRONMENT}`);
    }

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
