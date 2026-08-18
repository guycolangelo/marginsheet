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
      const database = env.NEON_DATABASE_URL
        ? await readSyncSchemaHealth(env.NEON_DATABASE_URL)
        : {
            ok: false,
            error: "NEON_DATABASE_URL is not usable",
            present: env.NEON_DATABASE_URL !== undefined,
            length: env.NEON_DATABASE_URL?.length ?? 0,
          };

      // The key's PRESENCE is reported and no part of its value ever is. This
      // is deliberately not called proof that the key works: nothing is
      // encrypted yet, so there is nothing to decrypt. That half is owed at
      // 4.2.2 and is recorded as owed rather than assumed.
      const tokenKeyPresent = Boolean(env.TOKEN_ENCRYPTION_KEY?.length);

      return Response.json(
        {
          service: "marginsheet-sync",
          environment: env.ENVIRONMENT,
          build: env.BUILD_SHA ?? "unknown",
          database,
          tokenKeyPresent,
        },
        { status: database.ok && tokenKeyPresent ? 200 : 503 }
      );
    }

    return new Response("not found", { status: 404 });
  },
};
