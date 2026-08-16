// The app API worker. M0 scope: health only. Everything else arrives with its module.

import * as Sentry from "@sentry/cloudflare";
import { scrubEvent } from "@marginsheet/shared/sentry-scrub";
import { readDbIdentity, readSchemaHealth } from "@marginsheet/shared/db";
import { createAuth } from "./auth.js";
import { postmarkSender } from "./email.js";

interface Env {
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
