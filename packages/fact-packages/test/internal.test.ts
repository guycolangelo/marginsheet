// Rule 1, invariant 3's application half.
//
// The type-level guarantee is asserted with @ts-expect-error: if the property
// ever becomes reachable on a ComposerView, the build fails because the
// expected error stops occurring. The runtime guarantee is asserted by
// stripping real packages and by a negative control that smuggles an internal
// field through an untyped path.

import { describe, it, expect } from "vitest";
import { toComposerView, findInternalFields, INTERNAL_KEYS } from "../src/internal.js";
import type { ComposerView } from "../src/internal.js";
import { questionBatch, alertFirstFlag, FIXTURES } from "../src/fixtures/index.js";
import type { FactPackage } from "../src/classes.js";

describe("type level: internal fields are unreachable, not merely discouraged", () => {
  it("ComposerView has no confidence_band_label_INTERNAL property", () => {
    const view = toComposerView(questionBatch.package as FactPackage<"QuestionBatch">);
    const question = view.block.questions[0];

    // The category survives: the composer may say what it filed as.
    expect(question.best_guess.category).toBe("Dining");

    // @ts-expect-error confidence_band_label_INTERNAL is stripped from ComposerView.
    // If this line ever compiles, the type-level guarantee is gone and this
    // test fails by the expected error not occurring.
    question.best_guess.confidence_band_label_INTERNAL;
  });

  it("ComposerView has no rule_id, though the locked schema names it plainly", () => {
    const view = toComposerView(alertFirstFlag.package as FactPackage<"Alert">);

    // The alert's facts survive.
    expect(view.block.first_flag).toBe(true);

    // @ts-expect-error rule_id is internal by rule 1 despite carrying no suffix.
    view.block.rule_id;
  });

  it("the household_id is stripped from the composer's view", () => {
    const view = toComposerView(questionBatch.package as FactPackage<"QuestionBatch">);
    // @ts-expect-error household_id is a routing handle, not a fact to compose.
    view.household_id;
    // The recipient's first name survives, because the greeting rule needs it.
    expect(view.recipient.first_name).toBe("Guy");
  });
});

describe("runtime: the object itself carries no internal fields", () => {
  it("strips every internal field from every fixture, at every depth", () => {
    for (const fixture of FIXTURES) {
      const view = toComposerView(fixture.package);
      const survivors = findInternalFields(view);
      expect(survivors, `${fixture.name} leaked: ${survivors.join(", ")}`).toEqual([]);
    }
  });

  it("finds internal fields before stripping, so the detector is not blind", () => {
    // The positive control for the assertion above: if findInternalFields
    // returned [] for everything, the test would pass on a broken stripper.
    const before = findInternalFields(questionBatch.package);
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((p) => p.includes("confidence_band_label_INTERNAL"))).toBe(true);
  });

  it("NEGATIVE CONTROL: strips an internal field smuggled through an untyped path", () => {
    // A shape the types never saw: nested arrays, unexpected keys, an
    // internal field placed where no schema puts one. An allow-list stripper
    // would miss this; a structural one does not.
    const smuggled = {
      block: {
        odd: [
          { deep: { confidence_band_label_INTERNAL: "band_c", keep: "yes" } },
          [{ rule_id: "should_not_survive" }],
        ],
      },
    };

    expect(findInternalFields(smuggled).length).toBeGreaterThan(0);

    const view = toComposerView(smuggled);
    expect(findInternalFields(view)).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("band_c");
    expect(JSON.stringify(view)).not.toContain("should_not_survive");
    // And the neighbouring value survives, so the stripper is surgical.
    expect(JSON.stringify(view)).toContain("yes");
  });

  it("every declared internal key is actually stripped", () => {
    const probe: Record<string, unknown> = { keep_me: "kept" };
    for (const key of INTERNAL_KEYS) probe[key] = "leaked";
    const view = toComposerView(probe) as Record<string, unknown>;

    for (const key of INTERNAL_KEYS) {
      expect(view[key], `${key} survived`).toBeUndefined();
    }
    expect(view.keep_me).toBe("kept");
  });
});
