// The credential-class guard behind identity-onboarding-spec §1, as tightened
// by Guy on 15 August 2026.
//
// THE RULE: a phone change requires a passkey when the member has one
// registered. A magic link is accepted only when no passkey exists.
//
// WHY: the phone is the SIM-swap surface. Accepting an email-delivered link to
// change it lets whoever controls the inbox move the security primitive. A
// passkey is bound to hardware and cannot be forwarded, which is the property
// that matters for this one action.
//
// WHY MEMBERS WITHOUT A PASSKEY ARE NOT LOCKED OUT: §1 makes magic link the
// WEAKER path, not an EXCLUDED one. An implementation that simply refused
// every magic-link phone change would satisfy the two obvious test cases while
// locking out every member who has not registered a passkey. Registering one
// is what closes the weaker path; being unable to change your phone is not.

/** What the session's auth_method column can hold. NULL predates the column. */
export type AuthMethod = "passkey" | "magic_link" | null;

export interface PhoneChangeContext {
  /**
   * From session.auth_method. SERVER-WRITTEN ONLY. If this ever comes from a
   * client-supplied field, this entire module becomes advisory: an attacker
   * holding a magic-link session would claim "passkey" and authorise their own
   * phone change, and every test here would still pass.
   */
  sessionAuthMethod: AuthMethod;
  /** Whether the member has ANY passkey registered. */
  memberHasPasskey: boolean;
}

export type PhoneChangeDecision =
  | { allowed: true }
  | { allowed: false; reason: "passkey_required" };

/**
 * NULL is treated as the WEAKEST class, never the strongest. A session whose
 * provenance is unknown is not a passkey session. Defaulting the other way
 * would mean every pre-existing session silently satisfied the tightening.
 */
export function isPasskeySession(method: AuthMethod): boolean {
  return method === "passkey";
}

export function mayChangePhone(ctx: PhoneChangeContext): PhoneChangeDecision {
  // The weaker path is only closed for members who have a stronger one.
  if (!ctx.memberHasPasskey) return { allowed: true };
  if (isPasskeySession(ctx.sessionAuthMethod)) return { allowed: true };
  return { allowed: false, reason: "passkey_required" };
}
