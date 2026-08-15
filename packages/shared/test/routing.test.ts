// Forced-unavailability tests (M0 plan Task 0.5): every prefix of failure for
// every call class, plus the two doctrine-critical properties tested by name.

import { describe, it, expect } from "vitest";
import { MODELS, ROUTING, type CallClass, type ModelId } from "../src/models.js";
import { resolveRoute } from "../src/routing.js";

const ALL_MODELS = Object.values(MODELS) as ModelId[];
const ALL_CLASSES = Object.keys(ROUTING) as CallClass[];

function allSubsets(models: ModelId[]): ModelId[][] {
  return models.reduce<ModelId[][]>(
    (subsets, m) => subsets.concat(subsets.map((s) => [...s, m])),
    [[]]
  );
}

describe("registry", () => {
  it("aliases pin distinct model IDs", () => {
    expect(new Set(ALL_MODELS).size).toBe(ALL_MODELS.length);
  });

  it("every chain references registry aliases only and every class has a terminal behavior", () => {
    for (const cls of ALL_CLASSES) {
      const config = ROUTING[cls];
      expect(config.chain.length).toBeGreaterThan(0);
      for (const step of config.chain) {
        expect(MODELS[step.alias]).toBeDefined();
      }
      expect(config.onExhausted).toBeDefined();
      expect(config.doctrine.length).toBeGreaterThan(0);
    }
  });
});

describe("chain resolution per class", () => {
  it("high_stakes_composition: FRONTIER, then MID_TIER, then stop_and_queue", () => {
    expect(resolveRoute("high_stakes_composition")).toMatchObject({
      kind: "model",
      alias: "FRONTIER",
      flagged: false,
    });
    expect(resolveRoute("high_stakes_composition", [MODELS.FRONTIER])).toMatchObject({
      kind: "model",
      alias: "MID_TIER",
      flagged: false,
    });
    expect(
      resolveRoute("high_stakes_composition", [MODELS.FRONTIER, MODELS.MID_TIER])
    ).toEqual({ kind: "exhausted", behavior: "stop_and_queue" });
  });

  it("routine_composition: fallback to MID_TIER is flagged", () => {
    expect(resolveRoute("routine_composition", [MODELS.FRONTIER])).toMatchObject({
      kind: "model",
      alias: "MID_TIER",
      flagged: true,
    });
    expect(
      resolveRoute("routine_composition", [MODELS.FRONTIER, MODELS.MID_TIER])
    ).toEqual({ kind: "exhausted", behavior: "flagged_fallback" });
  });

  it("time_critical_alerts: exhaustion degrades to the canonical fixture", () => {
    expect(
      resolveRoute("time_critical_alerts", [MODELS.FRONTIER, MODELS.MID_TIER])
    ).toEqual({
      kind: "exhausted",
      behavior: "degrade_to_fixture",
      canonicalFixture: "time-critical-alerts",
    });
  });

  it("advice_gate_judge: MID_TIER, then FAST_TIER, then no_send", () => {
    expect(resolveRoute("advice_gate_judge")).toMatchObject({
      kind: "model",
      alias: "MID_TIER",
    });
    expect(resolveRoute("advice_gate_judge", [MODELS.MID_TIER])).toMatchObject({
      kind: "model",
      alias: "FAST_TIER",
    });
    expect(
      resolveRoute("advice_gate_judge", [MODELS.MID_TIER, MODELS.FAST_TIER])
    ).toEqual({ kind: "exhausted", behavior: "no_send" });
  });

  it("parsing_extraction: FAST_TIER, then MID_TIER, then free_fallthrough", () => {
    expect(resolveRoute("parsing_extraction")).toMatchObject({
      kind: "model",
      alias: "FAST_TIER",
    });
    expect(
      resolveRoute("parsing_extraction", [MODELS.FAST_TIER, MODELS.MID_TIER])
    ).toEqual({ kind: "exhausted", behavior: "free_fallthrough" });
  });
});

describe("doctrine-critical properties", () => {
  it("the advice gate never fails open: every unavailability subset yields a model or no_send, nothing else", () => {
    for (const subset of allSubsets(ALL_MODELS)) {
      const result = resolveRoute("advice_gate_judge", subset);
      if (result.kind === "exhausted") {
        expect(result.behavior).toBe("no_send");
      } else {
        expect(["MID_TIER", "FAST_TIER"]).toContain(result.alias);
      }
    }
  });

  it("stop_and_queue never silently degrades: high stakes exhaustion carries no fixture and no flagged step exists", () => {
    const config = ROUTING.high_stakes_composition;
    expect(config.canonicalFixture).toBeUndefined();
    expect(config.chain.every((s) => s.flagged !== true)).toBe(true);
    const exhausted = resolveRoute("high_stakes_composition", ALL_MODELS);
    expect(exhausted).toEqual({ kind: "exhausted", behavior: "stop_and_queue" });
  });

  it("every class resolves to something for every subset (exhaustive, no throw)", () => {
    for (const cls of ALL_CLASSES) {
      for (const subset of allSubsets(ALL_MODELS)) {
        const result = resolveRoute(cls, subset);
        expect(["model", "exhausted"]).toContain(result.kind);
      }
    }
  });
});
