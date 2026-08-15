// The conversation service worker (the brains). M0 scope: health only.
// Phase B (M10 onward) builds the machine; nothing composes or sends from here yet.

import * as Sentry from "@sentry/cloudflare";
import { scrubEvent } from "@marginsheet/shared/sentry-scrub";
import { readDbIdentity } from "./db-identity.js";

interface Env {
  ENVIRONMENT: "dev" | "staging" | "production";
  BUILD_SHA?: string;
  SENTRY_DSN?: string;
  NEON_DATABASE_URL?: string;
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        service: "marginsheet-conversation",
        environment: env.ENVIRONMENT,
        build: env.BUILD_SHA ?? "unknown",
      });
    }
    if (url.pathname === "/debug/db-identity") {
      if (!env.NEON_DATABASE_URL) {
        return Response.json({ error: "NEON_DATABASE_URL is not configured" }, { status: 503 });
      }
      // Only the role name and the BYPASSRLS flag leave this handler.
      return Response.json(await readDbIdentity(env.NEON_DATABASE_URL));
    }
    if (url.pathname === "/debug/sentry") {
      throw new Error(`sentry wiring proof: marginsheet-conversation ${env.ENVIRONMENT}`);
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
