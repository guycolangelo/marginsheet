// Token discipline: domain separation across token kinds (M3 task 3.2c).
//
// THE FAILURE THIS PREVENTS. Three token kinds carry three different powers:
// a sign-in link creates a session, an invitation joins a household as
// full_member, and a recovery half creates nothing on its own. An invitation
// token accepted by the sign-in endpoint would hand a household session to
// whoever holds an invite. Nothing about a random string says which kind it is,
// so the kind has to be carried in the value and checked before anything else
// happens.
//
// WHY THE PREFIX GOES ON NOW, ruled by Guy 16 Aug 2026. Retrofitting a format
// onto tokens already in flight needs a transition where consumers accept both
// prefixed and unprefixed values, and a security control with a documented
// acceptance hole is worse than one that arrives late. Today there is one token
// kind live and none long-lived, so this is the cheapest it will ever be.
//
// THE CONSTRAINT, from the 3.2 plan and reaffirmed 16 Aug: there is NO shared
// validate(token, purpose). "A function that takes a token and a purpose is one
// refactor away from taking a token." The FORMAT is shared, which is what makes
// the kinds comparable. The CONSUMERS are separate functions with their purpose
// baked in and no parameter to get wrong. Minting takes a purpose because
// minting is not the boundary; reading is.
//
// THE PREFIX IS CHECKED BEFORE ANY LOOKUP, deliberately. Storage separation
// alone would produce a passing test for the wrong reason: an invitation token
// would be refused by sign-in merely because it is absent from `verification`,
// which is indistinguishable from a refusal on purpose and stops being true the
// moment two kinds ever share a store. Same trap as the column-privilege
// no-op, where the control passed while never being applied.

/** The kinds. Recovery is reserved here so 3.1b cannot invent a colliding one. */
export const TOKEN_PURPOSES = {
  signIn: "signin",
  invitation: "invite",
  /** Reserved. No consumer exists yet; the recovery path is 3.1b. */
  recovery: "recover",
} as const;

export type TokenPurpose = (typeof TOKEN_PURPOSES)[keyof typeof TOKEN_PURPOSES];

const NAMESPACE = "ms";
const SEPARATOR = "_";

/**
 * 32 bytes of randomness as lowercase hex. 256 bits, URL and email safe.
 *
 * HEX RATHER THAN BASE64URL, and the reason is the separator. base64url's
 * alphabet includes `_`, so a base64url material could contain the character
 * that divides the token, and `ms_signin_a_b` would be ambiguous: either a
 * sign-in token whose material starts with `a_`, or a malformed value with an
 * extra segment. The first pass of this module used base64url and its own
 * matrix test caught it, refusing valid tokens roughly half the time.
 *
 * Ambiguity in a security control is not a cosmetic problem. It forces the
 * parser to be lenient about structure, and a lenient parser cannot tell a
 * lookalike from the real thing. Hex costs 21 extra characters in a URL and
 * buys an alphabet that cannot collide with the separator.
 */
const MATERIAL = /^[0-9a-f]{64}$/;

function randomMaterial(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Mints a token carrying its purpose. Shared, because minting is not the
 * security boundary: a caller minting the wrong kind produces a token nothing
 * will accept, which fails closed. Reading is where a mistake is dangerous, and
 * reading is not shared.
 */
export function mintToken(purpose: TokenPurpose): string {
  return `${NAMESPACE}${SEPARATOR}${purpose}${SEPARATOR}${randomMaterial()}`;
}

/**
 * Splits a token into its purpose and material without deciding anything about
 * whether that purpose is acceptable. Private on purpose: exporting it would
 * recreate the shared validator the plan forbids, one call site at a time.
 */
function parse(token: unknown): { purpose: string; material: string } | null {
  if (typeof token !== "string") return null;

  // Exactly three segments, and the material must match its alphabet exactly.
  // Structure, not a prefix match: `startsWith("ms_signin")` would accept
  // `ms_signinfoo`, and a length check alone would accept a trailing space,
  // which the matrix test caught on the first pass.
  const parts = token.split(SEPARATOR);
  if (parts.length !== 3) return null;
  const [namespace, purpose, material] = parts;
  if (namespace !== NAMESPACE) return null;
  if (!MATERIAL.test(material)) return null;
  if (!/^[a-z]+$/.test(purpose)) return null;
  return { purpose, material };
}

// ---------------------------------------------------------------------------
// The consumers. One per kind, purpose baked in, no parameter.
//
// Each returns the token unchanged when it is addressed to that consumer, and
// null otherwise. Unchanged rather than stripped, because the store holds the
// whole value: handing back the material alone would mean every caller
// reassembling a token, and a caller that reassembles can reassemble wrongly.
// ---------------------------------------------------------------------------

/** The sign-in consumer. Accepts sign-in tokens. Refuses every other kind. */
export function readSignInToken(token: unknown): string | null {
  const parsed = parse(token);
  if (!parsed || parsed.purpose !== TOKEN_PURPOSES.signIn) return null;
  return token as string;
}

/** The invitation consumer. Accepts invitations. Refuses every other kind. */
export function readInvitationToken(token: unknown): string | null {
  const parsed = parse(token);
  if (!parsed || parsed.purpose !== TOKEN_PURPOSES.invitation) return null;
  return token as string;
}

// NO RECOVERY CONSUMER EXISTS, and that is deliberate rather than an oversight.
//
// The recovery path is 3.1b. It has no table, no issuer and no endpoint, so a
// consumer here would be a function nothing can present a real token to. A
// refusal from a stand-in proves nothing, and a stand-in that later gets wired
// up carries whatever assumptions it was written under.
//
// The purpose string is reserved above so 3.1b inherits the namespace instead
// of inventing one, and the cross-presentation matrix carries recovery's row
// and column as explicitly empty. See test/token-matrix.test.ts.
