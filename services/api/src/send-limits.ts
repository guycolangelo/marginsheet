// Send limiting for the auth flows (M3 task 3.2e).
//
// TWO LIMITS, TWO JOBS, AND A THIRD THAT IS NOT HERE.
//
//   per_email  one address cannot be mailbox-bombed
//   global     a cost backstop on Postmark spend
//   per source NOT HERE. Cloudflare edge. See below.
//
// WHY PER-SOURCE IS AT THE EDGE (ruled by Guy, 16 Aug 2026). Spray across many
// addresses from one source is a real attack that per-email limiting does not
// touch. Handling it here would mean keying a counter on the client IP, and
// that moves CUSTODY of network identity to MarginSheet. Cloudflare already
// handles the IP as a matter of routing on every request whether or not we act
// on it, so an edge rule leaves custody where it already sits. A hash with a
// short window was considered and refused: the bright line is the value, not
// its reversibility, because once "derived, transient, hashed" is acceptable
// it gets cited for the next feature.
//
// The edge rule is defined in config/edge-rate-limits.json and its presence is
// verified against Cloudflare by the edge-rules CI job, because a control
// living only in a dashboard is what broke production deploys on 16 Aug 2026.
//
// LIMITS ARE CONFIG, NOT CONSTANTS. config/rate-limits.json carries them per
// environment. Nothing in this file hardcodes a number.
//
// IT FAILS CLOSED. If the ledger cannot be read or written, the send is
// refused rather than allowed. An unlimited send endpoint is the failure this
// exists to prevent, so "the limiter is broken" must not resolve to "no
// limit". That is the opposite of the /health rule, and deliberately: a health
// check that cannot see should not claim health, and a limiter that cannot
// count should not grant permission.

import type { Sql } from "postgres";

export interface Limit {
  max: number;
  window_seconds: number;
}

export interface KindLimits {
  per_email: Limit;
  global: Limit;
}

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "per_email" | "global" | "unavailable" };

/** The only limited kind today. OTP sends join in 3.3. */
export const MAGIC_LINK = "magic_link";

/**
 * Reads the limits for one environment. Throws rather than defaulting: a
 * missing environment is a deployment mistake, and inventing a limit for it
 * would hide the mistake behind a number nobody chose.
 */
export function limitsFor(environment: string, config: unknown): KindLimits {
  const root = config as Record<string, Record<string, KindLimits> | undefined>;
  const forEnv = root?.[environment];
  const limits = forEnv?.[MAGIC_LINK];
  if (!limits?.per_email || !limits?.global) {
    throw new Error(
      `no ${MAGIC_LINK} limits configured for environment "${environment}" in config/rate-limits.json`
    );
  }
  return limits;
}

// THE CONFIG IS IMPORTED, NOT READ FROM DISK. Workers have no filesystem, so
// config/rate-limits.json is bundled at build time and the environment picks
// its row at runtime. Still config in the repo and still reviewable; a
// readFileSync here would typecheck and then fail in workerd, which is the
// class of mistake the 3.0 spike exists to have already found.

/**
 * Decides whether one more send is permitted, and records it when it is.
 *
 * The count and the insert are one statement each inside a single transaction,
 * so two concurrent requests cannot both read "one under the limit" and both
 * proceed. The read is FOR UPDATE-free because it counts rows rather than
 * locking one, so the transaction is serialised on the insert instead: at the
 * default isolation level two racers can still both pass a count. That is
 * accepted, and the reason is proportionality. The window is minutes long and
 * the cost of one extra email is one email; taking a table lock on every
 * sign-in to close a one-request race would be the more expensive mistake.
 * Recorded here so a reader knows it was considered rather than missed.
 */
export async function recordSendIfPermitted(
  sql: Sql,
  subject: string,
  limits: KindLimits
): Promise<LimitDecision> {
  try {
    return await sql.begin(async (tx) => {
      // Prune first, so the ledger cannot grow without bound and the counts
      // below never scan rows that no window can include.
      const widest = Math.max(limits.per_email.window_seconds, limits.global.window_seconds);
      await tx`
        delete from auth_send_attempts
         where kind = ${MAGIC_LINK}
           and created_at < now() - make_interval(secs => ${widest})
      `;

      const [{ count: perEmail }] = await tx<{ count: string }[]>`
        select count(*) as count
          from auth_send_attempts
         where kind = ${MAGIC_LINK}
           and subject = ${subject}
           and created_at > now() - make_interval(secs => ${limits.per_email.window_seconds})
      `;
      if (Number(perEmail) >= limits.per_email.max) {
        return { allowed: false, reason: "per_email" } satisfies LimitDecision;
      }

      const [{ count: overall }] = await tx<{ count: string }[]>`
        select count(*) as count
          from auth_send_attempts
         where kind = ${MAGIC_LINK}
           and created_at > now() - make_interval(secs => ${limits.global.window_seconds})
      `;
      if (Number(overall) >= limits.global.max) {
        return { allowed: false, reason: "global" } satisfies LimitDecision;
      }

      // Recorded BEFORE the send, not after. A send that throws mid-flight has
      // still consumed budget and may still have been delivered, and a limiter
      // that only counts successes can be driven indefinitely by failures.
      await tx`
        insert into auth_send_attempts (kind, subject) values (${MAGIC_LINK}, ${subject})
      `;
      return { allowed: true } satisfies LimitDecision;
    });
  } catch {
    // Fails closed. See the header: a limiter that cannot count must not grant
    // permission. The error is deliberately not surfaced to the caller, who
    // renders the same answer either way (see the enumeration suite).
    return { allowed: false, reason: "unavailable" };
  }
}
