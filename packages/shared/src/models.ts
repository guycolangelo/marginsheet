// The model routing table from CLAUDE.md as typed config (M0 plan Task 0.5).
//
// Registry doctrine (ruled 15 Aug 2026): call sites never carry model ID
// strings. Chains reference registry aliases; swapping a model is a one-line
// change here, followed by rerunning the affected chains' golden tests.
//
// Doctrine cross-reference: CLAUDE.md's routing table names models by product
// name. Those names resolve here as:
//   "Fable 5"   -> FRONTIER
//   "Sonnet 5"  -> MID_TIER (pinned to claude-sonnet-4-6 by ruling, 15 Aug
//                  2026; when a Sonnet 5 pin is ruled in, this line changes
//                  and the chains' golden tests rerun)
//   "Haiku 4.5" -> FAST_TIER
// Each chain below carries its CLAUDE.md line verbatim in `doctrine` so the
// table and the code cannot drift silently.

export const MODELS = {
  FRONTIER: "claude-fable-5",
  MID_TIER: "claude-sonnet-4-6",
  FAST_TIER: "claude-haiku-4-5-20251001",
} as const;

export type ModelAlias = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelAlias];

export type CallClass =
  | "high_stakes_composition"
  | "routine_composition"
  | "time_critical_alerts"
  | "advice_gate_judge"
  | "parsing_extraction";

export type FallbackBehavior =
  | "stop_and_queue"
  | "flagged_fallback"
  | "degrade_to_fixture"
  | "no_send"
  | "free_fallthrough";

export interface ChainStep {
  alias: ModelAlias;
  // Doctrine: routine composition falling back to MID_TIER is flagged.
  flagged?: true;
}

export interface CallClassConfig {
  chain: readonly ChainStep[];
  // What happens when every chain member is unavailable. The consumer must
  // honor this enum; resolveRoute never invents an alternative.
  onExhausted: FallbackBehavior;
  // For degrade_to_fixture only: which canonical fixture set serves.
  canonicalFixture?: string;
  // The CLAUDE.md routing line this config encodes, verbatim.
  doctrine: string;
}

export const ROUTING: Record<CallClass, CallClassConfig> = {
  high_stakes_composition: {
    chain: [{ alias: "FRONTIER" }, { alias: "MID_TIER" }],
    onExhausted: "stop_and_queue",
    doctrine:
      "High-stakes composition (close, Briefing, verdict-flip corrections): Fable 5 → Sonnet 5 → stop and queue",
  },
  routine_composition: {
    chain: [{ alias: "FRONTIER" }, { alias: "MID_TIER", flagged: true }],
    onExhausted: "flagged_fallback",
    doctrine: "Routine composition: Fable 5 → Sonnet 5 (flagged)",
  },
  time_critical_alerts: {
    chain: [{ alias: "FRONTIER" }, { alias: "MID_TIER" }],
    onExhausted: "degrade_to_fixture",
    canonicalFixture: "time-critical-alerts",
    doctrine: "Time-critical alerts: Fable 5 → Sonnet 5 → canonical fixture",
  },
  advice_gate_judge: {
    chain: [{ alias: "MID_TIER" }, { alias: "FAST_TIER" }],
    onExhausted: "no_send",
    doctrine: "Advice-gate judge: Sonnet 5 → Haiku 4.5 → no send, ever",
  },
  parsing_extraction: {
    chain: [{ alias: "FAST_TIER" }, { alias: "MID_TIER" }],
    onExhausted: "free_fallthrough",
    doctrine: "Parsing/extraction/merchant lookup: Haiku 4.5 → Sonnet 5",
  },
};
