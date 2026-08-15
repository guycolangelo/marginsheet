// RULE 1: INTERNAL FIELDS NEVER COMPOSE.
//
// "Confidence bands, rule IDs, calibration stats travel in the package for
// logging and routing but are marked internal; the lint layer fails any
// message containing them. The household hired a bookkeeper, not a systems
// postmortem."
//
// This is invariant 3's application half, which M1's manifest assigned to M2.
// The schema layer proved known_context cannot HOLD a confidence field; this
// layer proves a confidence band cannot REACH a composer.
//
// TWO INPUTS, ONE STRIPPER. The locked schema marks one field with a suffix
// (confidence_band_label_INTERNAL) but names others plainly (Alert.rule_id is
// internal by rule 1, yet the schema writes it without a suffix). Renaming a
// locked field is not an option, so internal-ness has two sources:
//
//   1. the _INTERNAL suffix convention, honored exactly as the spec writes it
//   2. INTERNAL_KEYS below, for fields the locked schema named plainly
//
// Both feed one type-level stripper and one runtime stripper, and both are
// tested, because a type disappears at runtime and the composer's input is
// serialized into a prompt.

/**
 * Field names that are internal despite carrying no _INTERNAL suffix.
 *
 * Keyed by bare property name rather than by path: these identifiers are
 * routing handles, and there is no context in which one of them should reach
 * composed prose. A name here is stripped wherever it appears.
 */
export const INTERNAL_KEYS = [
  "rule_id",
  "question_id",
  "open_question_id",
  "entry_id",
  "member_id",
  "household_id",
] as const;

export type InternalKey = (typeof INTERNAL_KEYS)[number];

/** True for any key the schema marks internal, by either mechanism. */
type IsInternal<K> = K extends `${string}_INTERNAL`
  ? true
  : K extends InternalKey
    ? true
    : false;

/**
 * The composer's input type: the package with every internal field removed,
 * recursively.
 *
 * A composer holding a ComposerView has NO PROPERTY to reach for. Accessing
 * pkg.block.questions[0].best_guess.confidence_band_label_INTERNAL is a
 * COMPILE ERROR rather than a lint finding, which is the difference between
 * a rule and a guarantee.
 */
export type ComposerView<T> = T extends readonly (infer E)[]
  ? readonly ComposerView<E>[]
  : T extends Date
    ? T
    : T extends object
      ? { [K in keyof T as IsInternal<K> extends true ? never : K]: ComposerView<T[K]> }
      : T;

function isInternalKeyName(key: string): boolean {
  return key.endsWith("_INTERNAL") || (INTERNAL_KEYS as readonly string[]).includes(key);
}

/**
 * The runtime stripper. Types vanish at compile time, and the composer's
 * input is serialized into a prompt, so the object itself must not carry the
 * fields either.
 *
 * Deliberately structural rather than allow-list based: it removes anything
 * internal at any depth, including in objects that reached here through an
 * untyped path. An allow-list would only protect the shapes someone
 * remembered to enumerate.
 */
export function toComposerView<T>(value: T): ComposerView<T> {
  return strip(value) as ComposerView<T>;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isInternalKeyName(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

/**
 * Finds any internal field surviving in an object. Returns the paths found,
 * empty when clean.
 *
 * Used by the tests, and available to the send path as a last assertion
 * before a package is serialized into a prompt.
 */
export function findInternalFields(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findInternalFields(v, `${path}[${i}]`)));
    return found;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isInternalKeyName(k)) found.push(`${path}.${k}`);
      found.push(...findInternalFields(v, `${path}.${k}`));
    }
  }
  return found;
}
