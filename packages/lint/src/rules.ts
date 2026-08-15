// The vocabulary and format rules from CLAUDE.md as deterministic checks.
// This engine is the deterministic layer of M11's advice gate: the
// conversation service imports it as a library; CI runs it over source and
// prompt files. Rules carry the context(s) they bind to, mirroring the
// doctrine: some words are banned everywhere, others only in analytical
// replies, corrections, or follow-up alerts.

export type LintContext =
  | "universal"
  | "analytical"
  | "correction"
  | "follow_up"
  | "decision_commentary"
  // A deliverable the household receives: digest, Briefing, close, herald.
  // Rules that govern what may LEAD an artifact bind here, since leading is
  // a property of a whole composed piece rather than of a sentence.
  | "composed_artifact";

export interface Rule {
  id: string;
  contexts: LintContext[];
  pattern: RegExp;
  message: string;
}

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|sixty|ninety";

// --- Net Worth Doctrine detection ------------------------------------------
//
// The subject: the term itself, or a figure labelled as one.
const NET_WORTH_TERM = String.raw`net[\s-]?worth`;

// Celebration and achievement framing. Kept broad on purpose: the doctrine
// bans a posture, not a word list, and over-firing near net worth costs a
// rewrite while under-firing ships a product that flatters people about
// assets they did not control.
const CELEBRATION = [
  String.raw`congratulations?`,
  String.raw`congrats`,
  String.raw`milestones?`,
  String.raw`streaks?`,
  String.raw`great job`,
  String.raw`well done`,
  String.raw`nice work`,
  String.raw`way to go`,
  String.raw`proud`,
  String.raw`crushing it`,
  String.raw`you'?ve hit`,
  String.raw`you'?ve reached`,
  String.raw`you'?ve crossed`,
  String.raw`you'?re on track to (being|be|becoming)`,
  String.raw`on your way to`,
  String.raw`record high`,
  String.raw`all[\s-]time high`,
  String.raw`new high`,
  String.raw`achievement`,
  String.raw`celebrate`,
  String.raw`wealthy`,
  String.raw`millionaire`,
].join("|");

// Proximity window: the same sentence, roughly. Matched in both orders,
// because "congratulations, your net worth..." and "your net worth just hit a
// milestone" are the same violation.
const NEAR = String.raw`[^.!?\n]{0,160}`;

export const NET_WORTH_CELEBRATION = new RegExp(
  `(?:${NET_WORTH_TERM})${NEAR}(?:${CELEBRATION})|(?:${CELEBRATION})${NEAR}(?:${NET_WORTH_TERM})`,
  "gi"
);

/**
 * Net worth leading a composed deliverable.
 *
 * Keyed on the OPENING SENTENCE, not a character count: the doctrine's words
 * are "the opening line of any composed deliverable". A character window
 * over-fires on short pieces, flagging a net worth line that legitimately
 * sits second because the whole artifact happens to be brief.
 *
 * Matches only when the term appears before the first sentence terminator or
 * line break, allowing for leading whitespace and a markdown heading marker.
 *
 * NOT DETECTABLE HERE, deliberately: "never the largest number on a screen"
 * is a property of rendered layout, not of text, and a lint rule pretending
 * to cover it would give false assurance. That clause is a design review item
 * for M8's Balance Sheet work.
 */
// The `g` flag is required by the engine's matchAll; anchored at ^ without
// the `m` flag it still matches at most once, which is what a lead rule means.
export const NET_WORTH_LEAD = new RegExp(
  `^[\\s#>*-]*[^.!?\\n]*?${NET_WORTH_TERM}`,
  "gi"
);

export const RULES: Rule[] = [
  {
    id: "no-em-dash",
    contexts: ["universal"],
    pattern: /—/g,
    message: "Em dashes are banned everywhere, code comments included.",
  },
  {
    id: "no-commandments",
    contexts: ["universal"],
    pattern: /\bcommandments?\b/gi,
    message: '"Commandments" is banned.',
  },
  {
    id: "budgeting-apps-quoted",
    contexts: ["universal"],
    pattern: /(?<!["“])\bbudgeting apps\b(?!["”])/gi,
    message: '"budgeting apps" always takes quotation marks.',
  },
  {
    id: "no-ai-on-marks",
    contexts: ["universal"],
    pattern: /\b(MarginSheet|MyKeeper|MyCFO)(™)? AI\b/g,
    message: '"AI" is never appended to the marks.',
  },
  {
    id: "day-counts-numeric",
    contexts: ["universal"],
    pattern: new RegExp(`\\b(${NUMBER_WORDS})\\s+days?\\b`, "gi"),
    message: 'Numerals for day counts ("the first 14 days").',
  },
  {
    id: "negative-margin-format",
    contexts: ["universal"],
    pattern: /-\s?\d+(\.\d+)?\s?%/g,
    message: "Negative Margin renders in parentheses: (6%), never -6%.",
  },
  {
    id: "negative-dollar-format",
    contexts: ["universal"],
    pattern: /-\$\d/g,
    message: "Overspent renders as a positive figure, never a negative dollar amount.",
  },
  {
    id: "margin-needs-percent",
    contexts: ["universal"],
    pattern: /\bMargin\b (?:of |is |was |at )?\d+(\.\d+)?(?!\s?%)\b/g,
    message: "Margin always carries the % symbol.",
  },
  {
    id: "no-should",
    contexts: ["analytical"],
    pattern: /\byou should\b|\bshould\b/gi,
    message: '"should" is banned in analytical replies.',
  },
  {
    id: "no-need-to",
    contexts: ["analytical"],
    pattern: /\bneed to\b/gi,
    message: '"need to" is banned in analytical replies.',
  },
  {
    id: "no-afford",
    contexts: ["analytical"],
    pattern: /\bafford(s|ed|ability)?\b/gi,
    message: "Affordability verdicts are banned. The brains state facts and costs.",
  },
  {
    id: "no-cut-instruction",
    contexts: ["analytical"],
    pattern: /\b(cut|cutting) (back|down|your|the|spending|out)\b/gi,
    message: '"cut" as instruction is banned.',
  },
  {
    id: "no-recommend",
    contexts: ["analytical"],
    pattern: /\brecommend(s|ed|ation)?\b/gi,
    message: '"recommend" is banned in analytical replies.',
  },
  {
    id: "no-delta-variance",
    contexts: ["correction"],
    pattern: /\b(delta|variance|discrepanc(y|ies))\b/gi,
    message: 'No "delta", "variance", or "discrepancy" in corrections.',
  },
  {
    id: "no-nagging",
    contexts: ["follow_up"],
    pattern: /\bagain\b|\bstill haven'?t\b|\breminder\b/gi,
    message: 'No "again", "still haven\'t", or "reminder" in follow-up alerts.',
  },
  {
    id: "no-decision-judgment",
    contexts: ["decision_commentary"],
    pattern: /\bgood call\b|\bthat cost you\b/gi,
    message: 'No "good call" or "that cost you" on decisions.',
  },

  // --- Net Worth Doctrine (locked August 2026) ----------------------------
  //
  // Rule 2, "never celebrated": banned everywhere, from either brain, in any
  // channel, ever. Proximity-based, because the violation is celebration
  // ATTACHED to net worth, not either token alone: a digest may say Margin
  // is up and may separately report a net worth line, and neither is a
  // violation until the praise lands on the net worth figure.
  {
    id: "no-net-worth-celebration",
    contexts: ["universal"],
    pattern: NET_WORTH_CELEBRATION,
    message:
      "Net worth is never celebrated (Net Worth Doctrine 2). No congratulations, milestones, streaks, or achievement framing attached to net worth, in any channel, ever. Margin is the only celebrated number, because Margin is the only number the household controls.",
  },
  // Rule 1, the lint-detectable half: net worth may not LEAD a composed
  // deliverable. "Largest number on a screen" is a design review item and is
  // deliberately not modeled here; see the note under NET_WORTH_LEAD.
  {
    id: "no-net-worth-lead",
    contexts: ["composed_artifact"],
    pattern: NET_WORTH_LEAD,
    message:
      "Net worth is never the lead figure or opening line of a composed deliverable (Net Worth Doctrine 1). It may appear as a reported line further down; it may not open the piece.",
  },
];
