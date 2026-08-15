// The fact package schema, LOCKED 14 AUGUST 2026.
//
// TRANSCRIPTION, NOT DESIGN. Where the spec names a field, this file ships
// that field with that name. Where the spec's shape is ambiguous, the
// ambiguity is preserved and flagged rather than resolved by invention.
//
// THE CENTRAL BOUNDARY: one schema, many classes, and COMPOSITION CAN ONLY
// SUBTRACT. Every number, date, name, and claim in composed output must trace
// to a field in the package. The composer may omit, round per the format
// rules, and phrase. It may never add. This is the checkable version of
// "narrates, never computes".

/** Every message class in the locked schema. */
export type MessageClass =
  | "IntroMyKeeper"
  | "IntroMyCFO"
  | "QuestionBatch"
  | "Digest"
  | "ClosePair"
  | "Briefing"
  | "Alert"
  | "ScenarioAnswer"
  | "Correction"
  | "LifeEventReply"
  | "FraudReply"
  | "LedgerAnswer"
  | "Handoff"
  | "Goodbye"
  | "PreferenceConfirm"
  | "Clarification";

export const MESSAGE_CLASSES: readonly MessageClass[] = [
  "IntroMyKeeper",
  "IntroMyCFO",
  "QuestionBatch",
  "Digest",
  "ClosePair",
  "Briefing",
  "Alert",
  "ScenarioAnswer",
  "Correction",
  "LifeEventReply",
  "FraudReply",
  "LedgerAnswer",
  "Handoff",
  "Goodbye",
  "PreferenceConfirm",
  "Clarification",
] as const;

export type Brain = "mykeeper" | "mycfo";

/** Greet or not. The 4-hour window is resolved by code, never by the composer. */
export type ThreadState = "new" | "live";

/** Heralds and closes compose as a pair: one call, one package. */
export type Channel = "sms" | "email" | "sms+email_pair";

export interface Recipient {
  member_id: string;
  first_name: string;
}

/**
 * A known_context entry as it reaches the composer.
 *
 * SELECTED BY CODE; THE COMPOSER NEVER QUERIES MEMORY. Note what is absent:
 * no confidence field, because known_context has none (invariant 3), and no
 * state or deleted_at, because the assembler reads
 * known_context_composable and a non-composable entry never arrives here at
 * all (invariant 4).
 */
export interface KnownContextEntry {
  entry_id: string;
  type: "goal" | "plan" | "fact" | "worry" | "preference" | "decision";
  text: string;
  said_by_first_name: string;
  said_when: string;
}

/** Versioned as data, not prompt text. */
export interface FormatRules {
  rounding: string;
  percent_style: string;
  currency_style: string;
}

/** The shared core, present in every package. */
export interface FactPackageCore {
  class: MessageClass;
  household_id: string;
  recipient: Recipient;
  thread_state: ThreadState;
  channel: Channel;
  /** Flips tone rules; set by a named life event. */
  hardship_flag: boolean;
  known_context: KnownContextEntry[];
  format_rules: FormatRules;
  composed_at: string;
  package_version: string;
}

/**
 * A pattern fact: produced by CODE from the data and handed over as a string.
 *
 * Rule 3. "Larger than anything on that card in the year I can see" is
 * computed, never derived by the composer, because a derived pattern is a
 * computation and the composer never computes.
 */
export type StringFact = string;
