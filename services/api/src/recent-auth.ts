// The recent-auth window (M3 task 3.3, wired by 3.4).
//
// !!! THIS IS WIRED TO NOTHING TODAY, DELIBERATELY AND VISIBLY. !!!
//
// Rule 1 of migration 0001 says a phone change happens "in-app only, behind a
// fresh auth challenge (10-minute recent-auth window)". 3.2b built the
// credential-class half; this is the window half, and 3.1a's phone-change
// endpoint does not call it. A session created 29 days ago satisfies that
// endpoint exactly as one created a minute ago.
//
// WHY IT IS NOT WIRED HERE. 3.4 wires recent-auth to EVERY sensitive action.
// Wiring it to one endpoint now and re-wiring it there would be two
// implementations of one control, which is the drift shape recorded in
// recovery.ts. Guy ruled it: build it here, wire it in 3.4.
//
// WHY THAT IS SAFE TO SAY OUT LOUD. It is on docs/open-items.json with 3.4 as
// owner, because a control that exists and is not called must not be mistaken
// for a control that is enforced. That was found this morning, when the §1
// phone-change tightening turned out to have been nominally live for 2 days
// with no endpoint, and it should not need finding twice.
//
// The test suite asserts the decision table. It cannot assert enforcement,
// because there is no caller, and it says so rather than implying otherwise.

/** Sensitive actions need auth this fresh (identity-onboarding-spec §1). */
export const RECENT_AUTH_MINUTES = 10;

export interface RecentAuthContext {
  /** When the session was established. From session.created_at, server-written. */
  sessionCreatedAt: Date | null | undefined;
  /** Now, injected so expiry is provable by moving the clock rather than waiting. */
  now?: Date;
}

export type RecentAuthDecision =
  | { fresh: true }
  | { fresh: false; reason: "no_session" | "stale" };

/**
 * Whether the session is fresh enough for a sensitive action.
 *
 * An ABSENT timestamp is treated as stale, never as fresh. Defaulting the other
 * way would mean any session whose provenance could not be read satisfied the
 * window, which is the same rule as `isPasskeySession` treating null as the
 * weakest class: unknown resolves downward.
 */
export function withinRecentAuthWindow(ctx: RecentAuthContext): RecentAuthDecision {
  if (!ctx.sessionCreatedAt) return { fresh: false, reason: "no_session" };

  const now = ctx.now ?? new Date();
  const ageMs = now.getTime() - ctx.sessionCreatedAt.getTime();

  // A negative age means a clock skew or a forged timestamp. Treated as stale,
  // because "created in the future" must not read as "created just now".
  if (ageMs < 0) return { fresh: false, reason: "stale" };
  if (ageMs > RECENT_AUTH_MINUTES * 60_000) return { fresh: false, reason: "stale" };
  return { fresh: true };
}
