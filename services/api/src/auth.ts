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
import { magicLinkEmail, type EmailSender } from "./email.js";

/** Sign-in links live 15 minutes (ruled 15 Aug 2026). */
export const MAGIC_LINK_MINUTES = 15;

/**
 * Which endpoint established a session maps to which credential class. Derived
 * from the path the server itself just executed, never from anything the
 * client said. See migration 0014: a client-supplied value would make the §1
 * phone-change tightening advisory.
 */
export function authMethodForPath(path: string | undefined): "passkey" | "magic_link" | null {
  if (!path) return null;
  if (path.includes("/passkey/verify-authentication")) return "passkey";
  if (path.includes("/magic-link/verify")) return "magic_link";
  // Unknown provenance is the weakest class, never the strongest.
  return null;
}

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

export function createAuth(env: AuthEnv, mail?: EmailSender) {
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
      additionalFields: {
        // input: false is the enforcement, not a hint. It stops the field
        // being accepted from a request body. Migration 0014's comment
        // explains why that is the whole control rather than a detail.
        auth_method: { type: "string", required: false, input: false },
      },
    },

    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => ({
            data: { ...session, auth_method: authMethodForPath(ctx?.path) },
          }),
        },
      },
    },

    advanced: {
      // NO NETWORK IDENTITY (ruled by Guy, 15 Aug 2026).
      //
      // MarginSheet holds no network identity for households. Sentry was
      // stripped of it in three layers including an org-level setting, and a
      // session table storing IP and user agent would make that principle
      // false in a different store. Guy's words: "we only keep it for
      // security" is the sentence every company says before a breach
      // discloses it.
      //
      // What this costs, accepted knowingly: no sign-in-from-a-new-device
      // detection, no IP-based anomaly signals, weaker forensics if an
      // account is ever compromised. Those are real security tools, traded
      // for not holding the data. Any future control needing one of them is a
      // ruling with a named purpose, never a default that accumulated.
      //
      // This flag is only the FIRST of two layers. It is configuration, and
      // configuration is a setting somebody can flip. The structural half is
      // the trigger in migration 0012, which nulls both columns on write no
      // matter what this says. Better Auth has no equivalent flag for user
      // agent at all: it reads the header unconditionally.
      ipAddress: { disableIpTracking: true },
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
        expiresIn: MAGIC_LINK_MINUTES * 60,
        sendMagicLink: async ({ email, token }) => {
          if (!mail) {
            // Never silently succeed. A sign-in flow that reports "check your
            // email" while sending nothing is the exact failure shape this
            // build has spent a day removing.
            throw new Error("no email sender configured; refusing to report a send that did not happen");
          }
          // NOT the plugin's own callback URL. That one verifies on GET, and a
          // GET-consumed token is burned by email security scanners before the
          // member ever clicks. This points at a page that consumes nothing;
          // an explicit action there completes the sign-in.
          const confirmUrl = `${env.BETTER_AUTH_URL}/auth/confirm?token=${encodeURIComponent(token)}`;
          await mail.send({ to: email, ...magicLinkEmail(confirmUrl, MAGIC_LINK_MINUTES) });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
