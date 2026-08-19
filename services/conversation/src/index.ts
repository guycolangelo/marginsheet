// The conversation worker. M0 scope: health only. The brains arrive with M10.

import * as Sentry from "@sentry/cloudflare";
import { scrubEvent } from "@marginsheet/shared/sentry-scrub";
import { readDbIdentity, readSchemaHealth } from "@marginsheet/shared/db";
import { secretPresence } from "@marginsheet/shared/required-secrets";

interface Env {
  ENVIRONMENT: "dev" | "staging" | "production";
  DEBUG_PROBE_TOKEN?: string;
  BUILD_SHA?: string;
  SENTRY_DSN?: string;
  NEON_DATABASE_URL?: string;
}

const SERVICE = "marginsheet-conversation";

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

      // NON-EMPTY, not merely present. secret-inventory can only prove a NAME
      // exists, because wrangler never returns a value. An empty
      // BETTER_AUTH_SECRET means sessions signed with an empty key, and every
      // other check we have reports green while that is true.
      const secrets = secretPresence("conversation", env.ENVIRONMENT, env as unknown as Record<string, unknown>);
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
