// Key-validation smoke (M0 plan Task 0.5). Runs ONLY when RUN_MODEL_SMOKE=1,
// via the model-smoke workflow (workflow_dispatch). One count_tokens call per
// pinned model: validates the API key and the model ID against the live API
// at zero token cost. M0's no-live-model-calls rule holds everywhere else.
//
// PROBE_MODEL (optional workflow input) additionally probes any candidate ID
// and reports its status without failing the run. Used to settle pin
// questions with evidence.

import { describe, it, expect } from "vitest";
import { MODELS } from "../src/models.js";

const RUN = process.env.RUN_MODEL_SMOKE === "1";

async function countTokens(model: string): Promise<{ status: number; body: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  return { status: res.status, body: await res.text() };
}

describe.skipIf(!RUN)("model smoke: pinned IDs against the live API", () => {
  for (const [alias, model] of Object.entries(MODELS)) {
    it(`${alias} (${model}) is served and the key is valid`, async () => {
      const { status, body } = await countTokens(model);
      expect(status, `${model}: ${body}`).toBe(200);
    });
  }

  it.skipIf(!process.env.PROBE_MODEL)("probe: reports candidate ID status without failing", async () => {
    const candidate = process.env.PROBE_MODEL!;
    const { status, body } = await countTokens(candidate);
    console.log(`PROBE ${candidate}: HTTP ${status} ${status === 200 ? "(served)" : body}`);
    expect(true).toBe(true);
  });
});
