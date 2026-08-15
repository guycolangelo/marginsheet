// Fact package assembly: the one place known_context is read.
//
// INVARIANT 4's application half, assigned to M2 by M1's manifest.
//
// "THE ONLY SURFACE A FACT PACKAGE MAY READ" is known_context_composable
// (migration 0006). A query against the base table can forget the deleted_at
// clause, and a fact package built from the base table would silently
// re-raise something the household asked to be forgotten.
//
// The helper below is the only place the source is named, and a test asserts
// no assembly path names the base table. Per the ruling recorded on the
// view's own comment: a view nobody is required to use is a suggestion.

import type { KnownContextEntry } from "./core.js";

/** The view. Named once, here, deliberately. */
export const KNOWN_CONTEXT_SOURCE = "known_context_composable" as const;

export interface KnownContextQuery {
  householdId: string;
  types?: KnownContextEntry["type"][];
  limit?: number;
}

/**
 * Builds the read for known_context entries destined for a fact package.
 *
 * Returns SQL text rather than executing, so the assembly layer stays
 * testable without a database and so the source table is inspectable by the
 * invariant-4 test.
 */
export function knownContextQuery(q: KnownContextQuery): { text: string; values: unknown[] } {
  const values: unknown[] = [q.householdId];
  let text =
    `select entry_id, type, text, said_by_first_name, said_when ` +
    `from ${KNOWN_CONTEXT_SOURCE} where household_id = $1`;

  if (q.types && q.types.length > 0) {
    values.push(q.types);
    text += ` and type = any($${values.length})`;
  }
  if (q.limit !== undefined) {
    values.push(q.limit);
    text += ` limit $${values.length}`;
  }
  return { text, values };
}
