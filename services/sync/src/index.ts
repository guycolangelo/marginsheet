// marginsheet-sync: the deployable that holds TOKEN_ENCRYPTION_KEY.
//
// 4.2.1 gives it existence, a database identity and /health. It does no
// syncing: /transactions/sync is 4.4 and the Durable Object lock is 4.5.
//
// NO PUBLIC ROUTES, BY RULING (M4 section 2a). Everything here is reachable
// only over a service binding from api, so a household request cannot arrive
// at the Worker that can decrypt Plaid tokens. /health is the single fetch
// handler and reports no secret material.

export interface Env {
  ENVIRONMENT: string;
  BUILD_SHA?: string;
  NEON_DATABASE_URL?: string;
  TOKEN_ENCRYPTION_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      // Deliberately reports PRESENCE of the key and never any part of it, so
      // the deploy check can tell a Worker that received its secrets from one
      // that silently did not. The empty-string incident of 15 Aug was six
      // secrets that existed and held nothing while every environment
      // reported healthy.
      return Response.json({
        service: "marginsheet-sync",
        environment: env.ENVIRONMENT,
        build: env.BUILD_SHA ?? "unknown",
        secrets: {
          databaseUrl: Boolean(env.NEON_DATABASE_URL?.length),
          tokenEncryptionKey: Boolean(env.TOKEN_ENCRYPTION_KEY?.length),
        },
      });
    }

    // Anything else is a request that should not have reached this Worker.
    return new Response("not found", { status: 404 });
  },
};
