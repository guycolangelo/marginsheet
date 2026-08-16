// Better Auth configuration (M3 task 3.0).
//
// PASSWORDLESS, ENTIRELY (identity-onboarding-spec §1). There is no password
// field anywhere in this configuration and there is never to be one. Passkey
// is the primary identity; magic link is the fallback for a member who has no
// passkey registered. Phone is NOT here, deliberately: it is a security
// primitive verified through Twilio Verify, never a login method, and the
// live probe on 15 Aug 2026 confirmed an approved verification returns no
// session-shaped field.
//
// THE ROLE THIS RUNS AS. Better Auth connects through the same
// NEON_DATABASE_URL every other query uses, which authenticates as
// marginsheet_app: a non-superuser holding no BYPASSRLS and subject to every
// RLS policy. That is the configuration this module's spike exists to prove,
// because "Better Auth runs on Workers against Neon" had never been executed
// and an unexecuted assumption cost a day twice on 15 Aug 2026.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { passkey } from "@better-auth/passkey";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth-schema.js";

export interface AuthEnv {
  NEON_DATABASE_URL: string;
  ENVIRONMENT: "dev" | "staging" | "production";
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

// Sessions: secure, httpOnly, 30-day rolling (§1). The app is low-login by
// design, so long sessions are correct here. Sensitive actions do not rely on
// session age; they take a separate recent-auth re-challenge (task 3.4).
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const ONE_DAY_SECONDS = 60 * 60 * 24;

export function createAuth(env: AuthEnv) {
  // One connection per request. Workers are short-lived and Neon pools on its
  // side; holding a pool across invocations is what breaks first here.
  const sql = postgres(env.NEON_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  return betterAuth({
    // The schema is passed explicitly. Without it the adapter has no table
    // map and fails at the first query, which is the kind of thing that
    // only shows up against a real database.
    database: drizzleAdapter(drizzle(sql, { schema: authSchema }), {
      provider: "pg",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,

    // No password path exists. Stated explicitly rather than left to the
    // default, so enabling it later is a visible diff and not a shrug.
    emailAndPassword: { enabled: false },

    session: {
      expiresIn: THIRTY_DAYS_SECONDS,
      updateAge: ONE_DAY_SECONDS,
    },

    advanced: {
      // Cookies are cross-subdomain-free and secure everywhere except local
      // development, where there is no TLS to be secure over.
      useSecureCookies: env.ENVIRONMENT !== "dev",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },

    plugins: [
      passkey(),
      // The send hook is wired in task 3.2. It throws here rather than
      // silently doing nothing, because a magic-link flow that reports
      // success without sending is the exact shape of control this build
      // has spent a day removing.
      magicLink({
        sendMagicLink: async () => {
          throw new Error("magic link send hook is not wired yet (M3 task 3.2)");
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
