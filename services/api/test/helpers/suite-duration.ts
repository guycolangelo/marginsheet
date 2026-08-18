// A budget on the WHOLE run, replacing what the per-test timeout gave up.
//
// 17 Aug 2026: testTimeout went from vitest's 5s default to 20s, because the
// default describes local latency and these tests make real TLS round trips to
// a remote Postgres. A 5s budget there refuses at RANDOM rather than refusing
// to proceed, and a random red teaches re-running, which is the habit that
// eventually swallows a real one.
//
// The honest cost of that change is that a raised timeout hides a genuine
// performance regression. So the per-test budget got looser and a budget on the
// total run replaced it. THAT TRADE IS THE POINT: the distinction between "the
// default was wrong for remote tests" and "a test got slow" stays checkable.
//
// The threshold and the observed band live in config/suite-duration.json rather
// than being computed from the run, because a check that reads its expectation
// from the thing it is checking cannot disagree with it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = join(import.meta.dirname, "..", "..", "..", "..", "config", "suite-duration.json");

type Budget = {
  maxMs: number;
  observedBand: { minMs: number; maxMs: number; runs: string; characterisedOn: string; cause: string };
};

export async function setup() {
  const startedAt = Date.now();

  return async function teardown() {
    const elapsed = Date.now() - startedAt;
    const budget = JSON.parse(readFileSync(CONFIG, "utf8")) as Budget;

    // An override may only LOWER the threshold, never raise it. That makes the
    // mechanism testable (see suite-duration.test.ts) without creating a way to
    // switch the check off from the environment, which is how a budget quietly
    // stops meaning anything.
    const override = Number(process.env.SUITE_DURATION_MAX_MS);
    const max =
      Number.isFinite(override) && override > 0 && override < budget.maxMs ? override : budget.maxMs;

    if (elapsed <= max) return;

    const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    const band = budget.observedBand;
    // A bare "exceeded" tells the next person nothing about whether they are
    // looking at a regression or at the top of a band somebody already
    // characterised. So the message carries both.
    throw new Error(
      `SUITE DURATION ${s(elapsed)} EXCEEDED THE BUDGET OF ${s(max)}.\n\n` +
        `  observed band: ${s(band.minMs)} to ${s(band.maxMs)} over ${band.runs} runs, ` +
        `characterised ${band.characterisedOn}\n` +
        `  known cause of that spread: ${band.cause}\n` +
        `  this run: ${s(elapsed)}, which is ${(elapsed / band.maxMs).toFixed(1)}x the top of the band\n\n` +
        `This budget exists because the per-test timeout was raised to 20s on ` +
        `17 Aug 2026 and something had to keep watching for a real slowdown. ` +
        `If the band has genuinely moved, update config/suite-duration.json and ` +
        `say why. Raising maxMs to make this go away is the thing the budget ` +
        `exists to make visible.`
    );
  };
}
