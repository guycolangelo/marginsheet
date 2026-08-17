// The sensitive actions that require recent-auth (M3 task 3.4).
//
// §1: "Sensitive actions (phone change, cancellation, member removal, export)
// require recent-auth re-challenge (10-minute window)."
//
// !!! THIS LIST IS THE ENFORCEMENT MECHANISM, NOT A REFERENCE. !!!
//
// The spec names four. One exists. A comment saying "remember recent-auth on
// sensitive actions" is a habit, and habits are what this build keeps finding
// holes in. So the list lives in code and a static test reads it, asserting
// BOTH directions of drift:
//
//   1. No route matching a sensitive path exists OUTSIDE this list. That is how
//      a fifth sensitive action arrives unguarded.
//
//   2. Every entry marked `built` is actually REACHABLE: mounted, and answering
//      something other than 404. That is the other direction, and it is not
//      hypothetical. On 17 Aug 2026 the §1 phone-change tightening was found to
//      have been nominally live for 2 days with no endpoint at all:
//      mayChangePhone() decided correctly and had no callers, so the control
//      could not have gone red however broken it was. A list that says "built"
//      about something unreachable repeats that exactly. (Guy, 17 Aug 2026.)
//
// The three unbuilt entries stay here, explicitly empty with reasons, rather
// than being omitted until their module arrives. An enumeration that omits what
// has not been built is how three unguarded endpoints arrive in six months. Same
// pattern as the token matrix carrying recovery's column as todos.

export interface SensitiveAction {
  /** What §1 calls it. */
  name: string;
  /** The route, once it exists. */
  method: "POST" | "GET" | "DELETE";
  path: string;
  /**
   * Whether the route is mounted TODAY. The static test proves this claim in
   * both directions: a `true` here must be reachable, and a `false` here must
   * have no route.
   */
  built: boolean;
  /** Who owns building it, for the entries that are not built. */
  owner: string;
  /** Why it is sensitive, so a reader does not have to infer it. */
  why: string;
}

export const SENSITIVE_ACTIONS: readonly SensitiveAction[] = [
  {
    name: "phone change",
    method: "POST",
    path: "/auth/phone",
    built: true,
    owner: "M3 (3.1a endpoint, 3.4 recent-auth)",
    why: "The phone is the SIM-swap surface. Moving it moves the security primitive, which is why it also requires a passkey when the member has one.",
  },
  {
    name: "cancellation",
    method: "POST",
    path: "/billing/cancel",
    built: false,
    owner: "M7",
    why: "Ends the subscription and the household's access to their own books. Irreversible from the household's point of view within a billing period.",
  },
  {
    name: "member removal",
    method: "DELETE",
    path: "/household/members/:id",
    built: false,
    owner: "3.5",
    why: "Removes another person's access to the household's money. The remover and the removed are different people, which is what makes it sensitive rather than merely destructive.",
  },
  {
    name: "export",
    method: "POST",
    path: "/household/export",
    built: false,
    owner: "M8",
    why: "Takes the household's entire financial history out of the product in one action. A stolen session that can export has taken everything, once.",
  },
] as const;

/**
 * Routes that LOOK sensitive to the scan and deliberately are not.
 *
 * An exclusion list is a place carelessness accumulates, so every entry carries
 * a reason and the test asserts the reason exists. The bar for adding one: the
 * action must be unable to require recent-auth, not merely inconvenienced by it.
 */
export const NOT_SENSITIVE: readonly { path: string; why: string }[] = [
  {
    path: "/auth/recovery/phone",
    why:
      "This is the OTP half of the RECOVERY path, where the household has no credential at all by definition: that is the premise of recovery. Requiring recent-auth would require an authentication the member cannot perform, making recovery impossible for exactly the people it exists for. The same shape as the channel gate's literal reading, which would have blocked the sign-in link that lets someone verify a phone in the first place. Recovery is protected instead by needing BOTH halves, bound to one challenge, which is a stronger requirement than a fresh session.",
  },
] as const;

/** The paths a static test should find nowhere else in the router. */
export const SENSITIVE_PATHS = SENSITIVE_ACTIONS.map((a) => a.path);

export const BUILT_SENSITIVE_ACTIONS = SENSITIVE_ACTIONS.filter((a) => a.built);
export const UNBUILT_SENSITIVE_ACTIONS = SENSITIVE_ACTIONS.filter((a) => !a.built);
