// The canon, as instances of the schema.
//
// "Every golden-test fixture is an instance of it, which makes the canon
// EXECUTABLE RATHER THAN INTERPRETABLE."
//
// A DRIFT NOTE, recorded so nobody re-derives the smaller number: the service
// spec's QA harness section says the golden tests are "the canonical
// exchanges (#1 through #5)". The conversational spec's library runs #1
// through #6, and #6 (the monthly close) is the one exchange described as
// "the composed deliverable on the fact package boundary", which makes it
// load-bearing for ClosePair. Ruled 15 Aug 2026: #1 through #6, the
// conversational spec being the canon's home. The service spec's count is
// stale.
//
// Similarly, the 14 August additions are listed twice and differ: the QA
// section omits fraud, the advice-gate build list includes it. Ruled: the
// union, fraud included.
//
// NOTHING HERE IS INVENTED. Where no canonical text exists, the fixture
// carries status "owed" and an owner rather than a plausible-sounding
// message.

import type { FactPackageCore } from "../core.js";
import type { Fixture } from "../canon.js";

/** Shared core for the fixtures, so each one shows only what it varies. */
const core = (
  overrides: Partial<FactPackageCore> & Pick<FactPackageCore, "class">
): FactPackageCore => ({
  household_id: "hh_0000000000000000",
  recipient: { member_id: "mem_000000000000", first_name: "Guy" },
  thread_state: "new",
  channel: "sms",
  hardship_flag: false,
  known_context: [],
  format_rules: {
    rounding: "nearest_dollar",
    percent_style: "integer_percent_symbol",
    currency_style: "usd_symbol_thousands_separated",
  },
  composed_at: "2026-08-15T09:00:00Z",
  package_version: "v1",
  ...overrides,
});

// ---------------------------------------------------------------------------
// FULL: complete canonical text exists in a spec.
// ---------------------------------------------------------------------------

export const introMyKeeper: Fixture<"IntroMyKeeper"> = {
  name: "intro-mykeeper",
  messageClass: "IntroMyKeeper",
  status: "full",
  source: "conversation-service-spec §The introductions, beat two (verbatim SMS)",
  package: {
    ...core({ class: "IntroMyKeeper" }),
    class: "IntroMyKeeper",
    block: { transaction_count: 2347 },
  },
  expectedOutput:
    "Hi Guy, I'm MyKeeper, your bookkeeper. I'm starting on your books now. 2,347 transactions are loading from your accounts and my first job is to go through every one. Once it's settled, I'll text you the few things I couldn't place myself. Most of it I handle on my own.",
};

/**
 * The same class with a null count. The spec states this fallback verbatim,
 * which makes it canon rather than an inference: "if unavailable, 'several
 * thousand transactions', never a fabricated figure".
 */
export const introMyKeeperNullCount: Fixture<"IntroMyKeeper"> = {
  name: "intro-mykeeper-null-count",
  messageClass: "IntroMyKeeper",
  status: "partial",
  source: "conversation-service-spec §The introductions, beat two (fallback stated verbatim)",
  package: {
    ...core({ class: "IntroMyKeeper" }),
    class: "IntroMyKeeper",
    block: { transaction_count: null },
  },
  requiredFragments: ["several thousand transactions"],
  missing:
    "The spec states the fallback phrase but not the whole message in its null form. The rest of the sentence structure is inferred from the counted variant, so this is held to the fragment only.",
};

export const introMyCFO: Fixture<"IntroMyCFO"> = {
  name: "intro-mycfo",
  messageClass: "IntroMyCFO",
  status: "full",
  source: "conversation-service-spec §The introductions, beat three (verbatim SMS)",
  package: {
    ...core({ class: "IntroMyCFO" }),
    class: "IntroMyCFO",
    block: { briefing_eta_weeks: { low: 1, high: 2 } },
  },
  expectedOutput:
    "Hi Guy, I'm MyCFO. I work the bigger picture: where each month is heading, what's landing before it lands, and what decisions actually cost. Once MyKeeper has the books in order, I'll send your first full briefing, usually within two weeks. From then on, you'll see the month coming instead of finding out at the end. While I wait on the books, one question: what are you hoping to accomplish this year and next? I'll remember whatever you tell me.",
};

export const digestCleanWeek: Fixture<"Digest"> = {
  name: "digest-clean-week",
  messageClass: "Digest",
  status: "full",
  source: "conversation-service-spec §The weekly digest, the clean-week digest (verbatim)",
  package: {
    ...core({ class: "Digest" }),
    class: "Digest",
    block: {
      period: { start: "2026-08-09", end: "2026-08-15" },
      txns_processed: 187,
      disclosures: [],
      spot_checks: [],
      receivables: [],
      closures: [],
      clean_week: true,
      first_digest: false,
      briefing_pending: false,
      backlog_note: null,
    },
  },
  expectedOutput:
    "Good morning Guy. 187 transactions through the books this week, all filed, nothing I needed you for. Books are clean.",
};

export const digestFirst: Fixture<"Digest"> = {
  name: "digest-first",
  messageClass: "Digest",
  status: "full",
  source: "conversation-service-spec §The weekly digest, the first digest (verbatim)",
  package: {
    ...core({ class: "Digest" }),
    class: "Digest",
    block: {
      period: { start: "2026-08-09", end: "2026-08-15" },
      txns_processed: 1840,
      disclosures: [],
      spot_checks: [],
      receivables: [],
      closures: [],
      clean_week: false,
      first_digest: true,
      briefing_pending: true,
      backlog_note: 3,
    },
  },
  expectedOutput:
    "First week on the books: through 1,840 of your transactions, handled all but the 3 I texted you about. On pace for your briefing from MyCFO next week.",
};

/**
 * Exchange #4, the gold standard. The one class where labels carry full
 * weight, and the only multi-turn canon in either document.
 *
 * The expected output here is MyCFO's FIRST turn. The full exchange runs
 * three MyCFO turns across two household replies; the later turns are held
 * separately because each is a distinct composition against a package that
 * has since gained the household's answer.
 */
export const lifeEventReply: Fixture<"LifeEventReply"> = {
  name: "life-event-inside-bad-news",
  messageClass: "LifeEventReply",
  status: "full",
  source:
    "mycfo-mykeeper-conversational-spec §The canonical exchange library, #4 (verbatim, MyCFO's second turn)",
  package: {
    ...core({
      class: "LifeEventReply",
      recipient: { member_id: "mem_000000000000", first_name: "Sam" },
      thread_state: "live",
      hardship_flag: false,
      known_context: [
        {
          entry_id: "kc_000000000001",
          type: "fact",
          text: "She's scaling back to be home with the baby. Probably permanent.",
          said_by_first_name: "Sam",
          said_when: "2026-09-02",
        },
      ],
    }),
    class: "LifeEventReply",
    block: {
      event_class: "income_change_new_child",
      label_eligible: true,
      work_already_done: [
        "the household's income is now about $21,100 a month",
        "roughly $1,800 over each month, drawing from savings",
        "which covers about 14 months at this pace",
      ],
      session_offer: true,
    },
  },
  expectedOutput:
    "Congratulations on the baby. That's the best reason a number ever changes. So the household's income is now about $21,100 a month, and here's the honest picture at current spending: roughly $1,800 over each month, drawing from savings, which covers about 14 months at this pace. It sounds like the real question is what the new normal should look like. Want me to lay out what's committed versus what's chosen at the new income, so you two can decide where the new Margin comes from?",
};

// ---------------------------------------------------------------------------
// PARTIAL: the spec describes structure and quotes fragments, but no whole
// composed message exists to compare against.
// ---------------------------------------------------------------------------

export const closePair: Fixture<"ClosePair"> = {
  name: "monthly-close-july",
  messageClass: "ClosePair",
  status: "partial",
  source: "mycfo-mykeeper-conversational-spec §canonical exchange library, #6 (described with quoted fragments)",
  package: {
    ...core({ class: "ClosePair", channel: "sms+email_pair" }),
    class: "ClosePair",
    block: {
      close_email_facts: {
        income: "$24,200",
        spending: "$16,700",
        kept: "$7,500",
        margin_pct: "31%",
        verdict: "Kept",
        category_moves: [
          "Dining ran $1,240 against your usual $900, most of it the anniversary week",
          "the car loan you paid off in June is gone from your books",
        ],
        notable: ["your best since March", "projected to run about $1,200 over for the month, covered from checking"],
        receivables: [],
      },
      herald_headline_facts: { margin_pct: "31%" },
    },
  },
  requiredFragments: [
    "July is closed: 31%",
    "your best since March",
    "Nothing needs you yet",
  ],
  missing:
    "The spec quotes the subject line, several body fragments, and the four-word close, but not the full email body. A whole-message comparison would certify text the spec never wrote.",
};

export const alertFirstFlag: Fixture<"Alert"> = {
  name: "unprompted-month-warning",
  messageClass: "Alert",
  status: "partial",
  source: "mycfo-mykeeper-conversational-spec §canonical exchange library, #1 (described, one fragment quoted)",
  package: {
    ...core({ class: "Alert", recipient: { member_id: "mem_000000000000", first_name: "Sam" } }),
    class: "Alert",
    block: {
      rule_id: "projected_overspend",
      first_flag: true,
      numbers: { shortfall: "$1,200" },
      dates: { commitment_date: "2026-08-28", window_closes: "2026-08-25" },
      cost_of_inaction: null,
      pattern_context: ["dining and travel are the drivers this month"],
    },
  },
  requiredFragments: ["Nothing's wrong yet"],
  missing:
    "The spec names the beats (the figure, the drivers, the reassurance, the drill-down offer) and quotes only 'Nothing's wrong yet'. No full composed alert exists in either document.",
};

export const scenarioAnswer: Fixture<"ScenarioAnswer"> = {
  name: "the-car-decision",
  messageClass: "ScenarioAnswer",
  status: "partial",
  source: "mycfo-mykeeper-conversational-spec §canonical exchange library, #2 (described, fragments quoted)",
  package: {
    ...core({ class: "ScenarioAnswer", recipient: { member_id: "mem_000000000000", first_name: "Sam" }, thread_state: "live" }),
    class: "ScenarioAnswer",
    block: {
      question_as_parsed: "What would the new car do to us?",
      margin_ledger: {
        kept_before: "$7,500",
        kept_after: "$6,560",
        margin_before: "31%",
        margin_after: "27%",
      },
      cash_ledger: null,
      ledgers_diverge: false,
    },
  },
  requiredFragments: ["Let's look at the math", "Your call."],
  missing:
    "The spec names the open, the hidden-cost surfacing ($940 not $740), the Margin arithmetic, the counter-scenario, and the close, but writes only the two quoted phrases.",
};

export const correction: Fixture<"Correction"> = {
  name: "correction-tier-three",
  messageClass: "Correction",
  status: "partial",
  source: "conversation-service-spec §the mistake doctrine, tier three (one sentence quoted verbatim)",
  package: {
    ...core({ class: "Correction", thread_state: "live" }),
    class: "Correction",
    block: {
      artifact_corrected: "ClosePair",
      old_value: "$2,140",
      new_value: "$2,090",
      plain_dollar_difference: "$50",
      verdict_changed: false,
      cause_attribution: {
        txn: "HARTMAN'S 08/03",
        moved_from: "Dining",
        moved_to: "Groceries",
        corrected_by_first_name: "Sarah",
      },
      band_demoted: false,
    },
  },
  requiredFragments: ["You're right, I had it wrong", "the rule's updated so it stays fixed"],
  missing:
    "The spec gives the emotional range in one sentence and the mechanics, but no full correction message. The verdict-flip variant, described as the highest-stakes fixture, has no canon at all.",
};

export const questionBatch: Fixture<"QuestionBatch"> = {
  name: "first-question-batch",
  messageClass: "QuestionBatch",
  status: "partial",
  source: "conversation-service-spec §The introductions, first question batch cap (rules stated, no composed example)",
  package: {
    ...core({ class: "QuestionBatch" }),
    class: "QuestionBatch",
    block: {
      questions: [
        {
          question_id: "q_000000000001",
          txn: {
            merchant_string: "SQ *TARTINE",
            amount: "$84.20",
            date: "2026-08-11",
            account_last4: "4419",
          },
          best_guess: { category: "Dining", confidence_band_label_INTERNAL: "band_b_medium" },
          answer_space: ["Dining", "Groceries", "Something else"],
        },
      ],
    },
  },
  requiredFragments: ["if it's all right, you don't need to answer at all"],
  missing:
    "The spec states the cap of 3, the materiality ordering, and that the first message establishes the inclusion doctrine in one sentence, but does not write that sentence verbatim. The fragment above is the spec's paraphrase, not quoted canon.",
};

export const handoff: Fixture<"Handoff"> = {
  name: "handoff-keeper-to-cfo",
  messageClass: "Handoff",
  status: "partial",
  source: "mycfo-mykeeper-conversational-spec §canonical exchange library, #3 (the handoff sentence named, not quoted)",
  package: {
    ...core({ class: "Handoff", thread_state: "live" }),
    class: "Handoff",
    block: {
      from_brain: "mykeeper",
      to_brain: "mycfo",
      question_summary: "What is the baseball spending costing per month?",
      expertise_frame: true,
    },
  },
  requiredFragments: [],
  missing:
    "Exchange #3 names 'the handoff sentence' as a demonstrated beat but never writes it. No fragment can be asserted, which makes this the weakest of the partials.",
};

export const preferenceConfirm: Fixture<"PreferenceConfirm"> = {
  name: "preference-confirm-partial-honor",
  messageClass: "PreferenceConfirm",
  status: "partial",
  source: "conversation-service-spec §the fact package schema, PreferenceConfirm (one fragment in a comment)",
  package: {
    ...core({ class: "PreferenceConfirm", thread_state: "live" }),
    class: "PreferenceConfirm",
    block: {
      rule_recorded: { type: "threshold", parameters: { min_amount: "100.00" } },
      honored_fully: false,
      not_honored_part: "the split transactions",
    },
  },
  requiredFragments: ["that one I don't split"],
  missing:
    "The only canon is the phrase in the schema's inline comment. No composed confirmation exists.",
};

// ---------------------------------------------------------------------------
// OWED: no canonical example exists. Ordered by risk (ruled 15 Aug 2026).
// ---------------------------------------------------------------------------

export const fraudReply: Fixture<"FraudReply"> = {
  name: "fraud-reply",
  messageClass: "FraudReply",
  status: "owed",
  source: "conversation-service-spec §compliance boundaries (rules only, no composed example)",
  package: {
    ...core({ class: "FraudReply", thread_state: "live" }),
    class: "FraudReply",
    block: {
      account_last4: "4419",
      recent_txns: ["TAMPA GENERAL 08/14 $412.00"],
      pattern_facts: ["you haven't had a Tampa charge in the twelve months I can see"],
      boundary_line: true,
    },
  },
  owed: {
    owner: "Guy",
    risk: 1,
    why:
      "Highest risk of the five. It carries a HARD COMPLIANCE BOUNDARY (never 'that's definitely fraud', never 'that looks legitimate'; pattern facts only; whether it is fraud is the bank's and the household's call) and it sits on the 14 August additions list, so a golden test is expected to exist. Without canon that test would certify whatever the model produced, on the one class where a wrong sentence is an adjudication the product forbids.",
  },
};

export const goodbye: Fixture<"Goodbye"> = {
  name: "goodbye",
  messageClass: "Goodbye",
  status: "owed",
  source: "conversation-service-spec §the fact package schema, Goodbye (fields only)",
  package: {
    ...core({ class: "Goodbye", channel: "email" }),
    class: "Goodbye",
    block: {
      brain: "mykeeper",
      books_state: { current_through: "2026-08-15", open_items: 0 },
      export_location: "the export in your app",
      tenure_facts: { months: 7, total_kept: "$14,900" },
      retention_chosen: "keep",
      trial_lapse: false,
    },
  },
  owed: {
    owner: "Guy",
    risk: 2,
    why:
      "Real doctrine to hold it to (no guilt, no retention pitch, the books handed over clean), and it is the last thing a household ever reads from either brain. A wrong register here is the final impression.",
  },
};

export const clarification: Fixture<"Clarification"> = {
  name: "clarification-conflicting-answers",
  messageClass: "Clarification",
  status: "owed",
  source: "conversation-service-spec §question routing (mechanics only, no composed example)",
  package: {
    ...core({ class: "Clarification", thread_state: "live" }),
    class: "Clarification",
    block: {
      open_question_id: "q_000000000001",
      ambiguity: { candidates: ["Dining", "Groceries"] },
      conflicting_answers: [
        { answer: "Dining", from_first_name: "Guy" },
        { answer: "Groceries", from_first_name: "Sarah" },
      ],
    },
  },
  owed: {
    owner: "Guy",
    risk: 3,
    why:
      "Real doctrine: conflicting answers are never silently adjudicated, both answers and both names are surfaced, and the household decides. The composition has to name two people's disagreement about their own money without taking a side, which is a register question no rule list settles.",
  },
};

export const briefing: Fixture<"Briefing"> = {
  name: "briefing",
  messageClass: "Briefing",
  status: "owed",
  source: "conversation-service-spec §the fact package schema, Briefing (fields only)",
  package: {
    ...core({ class: "Briefing", channel: "email" }),
    class: "Briefing",
    block: {
      census_findings: {
        cadences: ["the insurance bills every other month"],
        income_streams: ["two streams, one irregular"],
        subscriptions_full: ["14 active subscriptions, $312 a month"],
        forgotten_subscriptions: ["two you have not used since March"],
        cost_creep: ["utilities up 11% year over year"],
        seasonal_shape: ["your spending peaks in December and July"],
      },
      standing_invitation: true,
    },
  },
  owed: {
    owner: "Guy",
    risk: 4,
    why:
      "M15 is far enough out that this can wait. The fields are known and the census work that fills them is not built yet, so canon written now would be written against an imagined census.",
  },
};

export const ledgerAnswer: Fixture<"LedgerAnswer"> = {
  name: "ledger-answer",
  messageClass: "LedgerAnswer",
  status: "owed",
  source: "conversation-service-spec §the fact package schema, LedgerAnswer (fields only)",
  package: {
    ...core({ class: "LedgerAnswer", thread_state: "live" }),
    class: "LedgerAnswer",
    block: {
      query_as_parsed: {
        merchant: "Publix",
        date_range: { start: "2026-07-01", end: "2026-07-31" },
        aggregate: "sum",
      },
      result: { amount: "$742.18", txn_count: 9, txns: null },
    },
  },
  owed: {
    owner: "Guy",
    risk: 5,
    why:
      "Lowest stakes and most mechanical: a query, a number, a count. The register risk is small because the message is nearly all fact.",
  },
};

export const FIXTURES: readonly Fixture[] = [
  introMyKeeper,
  introMyKeeperNullCount,
  introMyCFO,
  digestCleanWeek,
  digestFirst,
  lifeEventReply,
  closePair,
  alertFirstFlag,
  scenarioAnswer,
  correction,
  questionBatch,
  handoff,
  preferenceConfirm,
  fraudReply,
  goodbye,
  clarification,
  briefing,
  ledgerAnswer,
] as const;
