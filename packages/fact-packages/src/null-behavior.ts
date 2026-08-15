// RULE 2: NULLABILITY IS DOCTRINE.
//
// "A null field composes its canonical fallback (null transaction count
// composes 'several thousand') or omits the topic entirely; it never composes
// a guessed value. Fabricating around a null is the fabrication the boundary
// exists to prevent."
//
// The fallback is recorded WITH THE TYPE, as data, so "null transaction_count
// composes several thousand" is a property of the schema rather than
// something a prompt remembers. A prompt that remembers is a prompt that can
// forget.
//
// TWO KINDS ONLY, deliberately. There is no third kind, because the third
// kind is guessing.

export type NullBehavior =
  /** Compose this exact text in place of the value. */
  | { kind: "compose_fallback"; text: string; note?: string }
  /** Say nothing about this topic at all. */
  | { kind: "omit_topic"; note?: string };

/**
 * Every nullable field in the schema, with what null composes.
 *
 * COMPLETENESS IS THE ENFORCEMENT: a test walks every nullable field in every
 * class and fails if one is missing here. A nullable field cannot be added
 * without declaring what null composes, which is what keeps the fallback from
 * drifting into a prompt.
 *
 * Keys are "Class.path" using dot notation.
 */
export const NULL_BEHAVIOR: Record<string, NullBehavior> = {
  "IntroMyKeeper.transaction_count": {
    kind: "compose_fallback",
    text: "several thousand",
    note:
      "The spec states this one verbatim: the real count is required at send time, and if the seam cannot supply it the message says 'several thousand transactions', NEVER a fabricated figure. The fact package boundary applies to intros.",
  },

  "Digest.backlog_note": {
    kind: "omit_topic",
    note: "No backlog to note means the digest says nothing about backlog.",
  },

  "Alert.cost_of_inaction": {
    kind: "omit_topic",
    note:
      "No fee estimate means the alert states the state and the dates without inventing a cost. An invented fee is exactly the fabrication rule 2 exists to stop.",
  },

  "ScenarioAnswer.cash_ledger": {
    kind: "omit_topic",
    note:
      "Null cash ledger means the question lives only in the Margin ledger. The two-ledger answer shape is forced by ledgers_diverge, not by guessing at clearing dates.",
  },

  "LedgerAnswer.result.txns": {
    kind: "omit_topic",
    note:
      "The aggregate stands on its own; a null transaction list means the answer gives the total without itemizing, never a plausible-looking sample.",
  },

  "Goodbye.tenure_facts": {
    kind: "omit_topic",
    note:
      "A household leaving inside the trial has no tenure to state. Composing a tenure fact here would be flattery built on nothing.",
  },

  "PreferenceConfirm.not_honored_part": {
    kind: "omit_topic",
    note:
      "Null means the instruction was honored fully, so there is no exception to name.",
  },

  "Clarification.conflicting_answers": {
    kind: "omit_topic",
    note:
      "Null means one answer, no conflict. Conflict composition is a different shape entirely: both answers, both names, asked which to file.",
  },
};

/** Every nullable field path the schema declares, for the completeness test. */
export const NULLABLE_FIELDS: readonly string[] = [
  "IntroMyKeeper.transaction_count",
  "Digest.backlog_note",
  "Alert.cost_of_inaction",
  "ScenarioAnswer.cash_ledger",
  "LedgerAnswer.result.txns",
  "Goodbye.tenure_facts",
  "PreferenceConfirm.not_honored_part",
  "Clarification.conflicting_answers",
] as const;

export function nullBehaviorFor(path: string): NullBehavior | undefined {
  return NULL_BEHAVIOR[path];
}
