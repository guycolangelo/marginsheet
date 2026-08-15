// The app API worker. M0 scope: health only. Everything else arrives with its module.

import * as Sentry from "@sentry/cloudflare";
import { scrubEvent } from "@marginsheet/shared/sentry-scrub";

interface Env {
  ENVIRONMENT: "dev" | "staging" | "production";
  BUILD_SHA?: string;
  SENTRY_DSN?: string;
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        service: "marginsheet-api",
        environment: env.ENVIRONMENT,
        build: env.BUILD_SHA ?? "unknown",
      });
    }
    if (url.pathname === "/debug/sentry") {
      throw new Error(`sentry wiring proof: marginsheet-api ${env.ENVIRONMENT}`);
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
