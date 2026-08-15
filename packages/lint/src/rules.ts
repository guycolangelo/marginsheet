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
  | "decision_commentary";

export interface Rule {
  id: string;
  contexts: LintContext[];
  pattern: RegExp;
  message: string;
}

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|sixty|ninety";

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
];
