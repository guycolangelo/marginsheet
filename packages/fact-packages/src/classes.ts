// Per-class blocks, transcribed from the locked schema.
//
// "Each block is exactly the list of facts its canon entry says the message
// contains; IF A FACT IS NOT IN THE BLOCK, THE MESSAGE CANNOT SAY IT."

import type { FactPackageCore, MessageClass, StringFact } from "./core.js";

// --- Intros ---------------------------------------------------------------

export interface IntroMyKeeper {
  /** null composes "several thousand", NEVER a number. See NULL_BEHAVIOR. */
  transaction_count: number | null;
}

export interface Range {
  low: number;
  high: number;
}

export interface IntroMyCFO {
  briefing_eta_weeks: Range;
}

// --- Questions ------------------------------------------------------------

export interface QuestionTxn {
  merchant_string: string;
  amount: string;
  date: string;
  account_last4: string;
}

export interface BestGuess {
  category: string;
  /** NEVER COMPOSABLE. Stripped from the composer's view by construction. */
  confidence_band_label_INTERNAL: string;
}

export interface Question {
  /** Internal: routing identifier, not composable. See INTERNAL_PATHS. */
  question_id: string;
  txn: QuestionTxn;
  best_guess: BestGuess;
  answer_space: string[];
}

export interface QuestionBatch {
  /** Capped at 3 for a first batch BY CODE, not by this type. */
  questions: Question[];
}

// --- Digest ---------------------------------------------------------------

export interface Period {
  start: string;
  end: string;
}

export interface FiledItem {
  txn: string;
  filed_as: string;
}

export interface DigestReceivable {
  expected_amount: string;
  source: string;
  age_days: number;
}

export interface Closure {
  question_summary: string;
  answered_by_first_name: string;
  resolution: string;
}

export interface Digest {
  period: Period;
  txns_processed: number;
  disclosures: FiledItem[];
  spot_checks: FiledItem[];
  receivables: DigestReceivable[];
  closures: Closure[];
  clean_week: boolean;
  first_digest: boolean;
  briefing_pending: boolean;
  backlog_note: number | null;
}

// --- Close and herald -----------------------------------------------------

export interface CloseEmailFacts {
  income: string;
  spending: string;
  kept: string;
  margin_pct: string;
  verdict: string;
  category_moves: StringFact[];
  notable: StringFact[];
  receivables: DigestReceivable[];
}

/**
 * The herald headline: a strict subset of the close's facts, so the herald
 * cannot say something the close does not.
 *
 * CARRIED BY THE TYPE SYSTEM, not by this comment. `_HeraldKeysAreCloseKeys`
 * below fails to compile if a key is added here that the close does not have.
 *
 * It said "BY CONSTRUCTION" from M2 until 18 Aug 2026 and there was no
 * construction: the two interfaces were unrelated, and adding a herald field
 * with no close counterpart produced no error and no failing test. Proven by
 * probe, then made true.
 */
export interface HeraldHeadlineFacts {
  kept?: string;
  margin_pct?: string;
  /** Drawn FROM `CloseEmailFacts.notable`, and deliberately not named the
   *  same: the close carries the list, the herald carries at most one of them.
   *  Exempted from the subset proof below for that reason, and it is the only
   *  exemption. */
  one_notable?: string;
}

/**
 * COMPILE-TIME PROOF of the subset claim above.
 *
 * Every herald key other than `one_notable` must be a key of `CloseEmailFacts`.
 * Add one that is not and this resolves to `never`, and the assignment below
 * stops compiling. No test to remember, no runtime cost, and nothing to
 * forget: the preferred form wherever the type system can carry an obligation.
 */
type _HeraldKeysAreCloseKeys =
  Exclude<keyof HeraldHeadlineFacts, "one_notable"> extends keyof CloseEmailFacts
    ? true
    : never;
const _heraldSubsetProof: _HeraldKeysAreCloseKeys = true;
void _heraldSubsetProof;

export interface ClosePair {
  close_email_facts: CloseEmailFacts;
  herald_headline_facts: HeraldHeadlineFacts;
}

// --- Briefing -------------------------------------------------------------

export interface CensusFindings {
  cadences: StringFact[];
  income_streams: StringFact[];
  subscriptions_full: StringFact[];
  forgotten_subscriptions: StringFact[];
  cost_creep: StringFact[];
  seasonal_shape: StringFact[];
}

export interface Briefing {
  census_findings: CensusFindings;
  standing_invitation: boolean;
}

// --- Alert ----------------------------------------------------------------

export interface AlertNumbers {
  shortfall?: string;
  anomaly_amount?: string;
  price_delta_old_new?: [string, string];
}

export interface AlertDates {
  commitment_date: string;
  window_closes: string;
}

export interface Alert {
  /** Internal: routing identifier, not composable. See INTERNAL_PATHS. */
  rule_id: string;
  /** True on the first firing of a rule, false on every repeat.
   *
   *  A repeat is composed in the follow-up register, which bans "again",
   *  "still haven't" and "reminder". THAT HALF IS ENFORCED: `no-nagging` in
   *  packages/lint binds to the `follow_up` context. What is not enforced is
   *  that the composer SELECTS that context when this is false, which is
   *  compose-time and owed to M10. Described rather than asserted, because
   *  the second half does not exist yet. */
  first_flag: boolean;
  numbers: AlertNumbers;
  dates: AlertDates;
  cost_of_inaction: { fee_estimate: string } | null;
  /** Computed, not composed. */
  pattern_context: StringFact[];
}

// --- Scenario -------------------------------------------------------------

export interface MarginLedger {
  kept_before: string;
  kept_after: string;
  margin_before: string;
  margin_after: string;
}

export interface CashLedger {
  clearing_dates: string[];
  tight_weeks: StringFact[];
  checking_history_facts: StringFact[];
}

export interface ScenarioAnswer {
  question_as_parsed: string;
  margin_ledger: MarginLedger;
  cash_ledger: CashLedger | null;
  /** true FORCES the two-ledger answer shape. */
  ledgers_diverge: boolean;
}

// --- Correction -----------------------------------------------------------

export interface CauseAttribution {
  txn: string;
  moved_from: string;
  moved_to: string;
  corrected_by_first_name: string;
}

export interface Correction {
  artifact_corrected: MessageClass;
  old_value: string;
  new_value: string;
  plain_dollar_difference: string;
  /** True when the correction changes the artifact's verdict, not just a
   *  figure.
   *
   *  The mistake doctrine asks such a correction to say the verdict moved,
   *  because a household told only the new number reads the meaning as
   *  unchanged. NOT ENFORCED ANYWHERE: there is no second field this
   *  obligates, so the obligation is on composed output and is owed to M13's
   *  acceptance criteria. Described, not asserted. */
  verdict_changed: boolean;
  cause_attribution: CauseAttribution;
  /** True when the household's confidence band was demoted by a double
   *  fault.
   *
   *  The doctrine asks the correction to say so, in the canonical words
   *  "I've started asking again", so a household is told the system's
   *  confidence in itself dropped rather than discovering it from behaviour.
   *  NOT ENFORCED: a compose-time obligation with no field to check, owed to
   *  M13's acceptance criteria. Described, not asserted. */
  band_demoted: boolean;
}

// --- Life event -----------------------------------------------------------

export interface LifeEventReply {
  event_class: string;
  /** The one class where labels carry full weight. */
  label_eligible: true;
  /** Past-tense adjustments, computed. */
  work_already_done: StringFact[];
  /** Stage two; offered once. */
  session_offer: boolean;
}

// --- Fraud ----------------------------------------------------------------

export interface FraudReply {
  account_last4: string;
  recent_txns: string[];
  /** Match or no-match against household norms. */
  pattern_facts: StringFact[];
  /** Forces the bank-authority sentence. */
  boundary_line: true;
}

// --- Ledger answer --------------------------------------------------------

export interface LedgerQuery {
  merchant?: string;
  category?: string;
  tag?: string;
  date_range: Period;
  aggregate: string;
}

export interface LedgerResult {
  amount: string;
  txn_count: number;
  txns: string[] | null;
}

export interface LedgerAnswer {
  query_as_parsed: LedgerQuery;
  result: LedgerResult;
}

// --- Handoff --------------------------------------------------------------

export interface Handoff {
  from_brain: "mykeeper" | "mycfo";
  to_brain: "mykeeper" | "mycfo";
  question_summary: string;
  expertise_frame: true;
}

// --- Goodbye --------------------------------------------------------------

export interface BooksState {
  current_through: string;
  open_items: 0;
}

export interface TenureFacts {
  months: number;
  total_kept: string;
}

export interface Goodbye {
  brain: "mykeeper" | "mycfo";
  books_state: BooksState;
  export_location: string;
  tenure_facts: TenureFacts | null;
  retention_chosen: "keep" | "delete";
  trial_lapse: boolean;
}

// --- Preference confirmation ----------------------------------------------

export interface RuleRecorded {
  type: string;
  parameters: Record<string, unknown>;
}

export interface PreferenceConfirm {
  rule_recorded: RuleRecorded;
  honored_fully: boolean;
  /** composes "that one I don't split". */
  not_honored_part: string | null;
}

// --- Clarification --------------------------------------------------------

export interface ConflictingAnswer {
  answer: string;
  from_first_name: string;
}

export interface Clarification {
  /** Internal: routing identifier, not composable. See INTERNAL_PATHS. */
  open_question_id: string;
  ambiguity: { candidates: string[] };
  conflicting_answers: ConflictingAnswer[] | null;
}

// --- The discriminated union ----------------------------------------------

export interface ClassBlocks {
  IntroMyKeeper: IntroMyKeeper;
  IntroMyCFO: IntroMyCFO;
  QuestionBatch: QuestionBatch;
  Digest: Digest;
  ClosePair: ClosePair;
  Briefing: Briefing;
  Alert: Alert;
  ScenarioAnswer: ScenarioAnswer;
  Correction: Correction;
  LifeEventReply: LifeEventReply;
  FraudReply: FraudReply;
  LedgerAnswer: LedgerAnswer;
  Handoff: Handoff;
  Goodbye: Goodbye;
  PreferenceConfirm: PreferenceConfirm;
  Clarification: Clarification;
}

/** A complete package: the shared core plus exactly one class block. */
export type FactPackage<C extends MessageClass = MessageClass> =
  FactPackageCore & { class: C; block: ClassBlocks[C] };
