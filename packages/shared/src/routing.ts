// Route resolution: pure and exhaustive. Given a call class and the set of
// currently unavailable models, return the next model to use or the terminal
// behavior. The conversation service consumes this as a library; nothing here
// performs IO or invents behavior beyond the table.

import {
  MODELS,
  ROUTING,
  type CallClass,
  type FallbackBehavior,
  type ModelAlias,
  type ModelId,
} from "./models.js";

export type RouteResult =
  | { kind: "model"; alias: ModelAlias; model: ModelId; flagged: boolean }
  | { kind: "exhausted"; behavior: FallbackBehavior; canonicalFixture?: string };

export function resolveRoute(
  callClass: CallClass,
  unavailable: Iterable<ModelId> = []
): RouteResult {
  const down = new Set(unavailable);
  const config = ROUTING[callClass];

  for (const step of config.chain) {
    const model = MODELS[step.alias];
    if (!down.has(model)) {
      return {
        kind: "model",
        alias: step.alias,
        model,
        flagged: step.flagged === true,
      };
    }
  }

  const result: RouteResult = {
    kind: "exhausted",
    behavior: config.onExhausted,
  };
  if (config.canonicalFixture !== undefined) {
    result.canonicalFixture = config.canonicalFixture;
  }
  return result;
}
