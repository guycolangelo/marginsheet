# Money Intelligence: the language layer
## Review document, 18 August 2026. Nothing here is merged. Category canon v3.1.

---

## 1. What was built, and it is only the lint layer

The rescope was right. `prompts/` is a single `.gitkeep`, `apps/web` is a 33-line M0 placeholder, and there is nothing to enforce against yet. **The risk is not a violation today. It is M11 and M13 rediscovering all of this from scratch.**

So one thing was built and everything else was recorded.

**Six rules and one extension**, each with a fixture pair. `household_copy` is a new lint context.

| Rule | Contexts | Fires | Permits |
|---|---|---|---|
| `no-financial-in-household-copy` | `household_copy`, `composed_artifact` | "your financial picture" | our own comments; `financial_accounts` |
| `no-competitor-category-terms` | universal | personal finance, financial management/wellness/health | Money Intelligence Platform |
| `no-agent-descriptor` | universal | "MyKeeper is an agent", "AI agent", "agentic" | `user_agent`, "user agent" |
| `no-ai-category-language` | universal | AI-powered, AI assistant | (see §5) |
| `money-intelligence-capitalized` | universal | lowercase "money intelligence" | the capitalised noun |
| `no-burden-verbs` | artifact, analytical, decision, copy | "this ties up your Margin" | "this commits $2,496 through August 2028" |
| `budgeting-apps-quoted` **extended** | universal | the unquoted **singular** | either form, quoted |

**One string changed in the whole repository**, and it is an internal HTML comment in `apps/web/public/index.html` reworded from "households' financial data" to "households' money data" so the tree passes the new scan rather than being allowlisted. Not one sentence a household will read was touched, because none exist.

### Three rules were designed against a failure the obvious version would have missed

**`no-financial-in-household-copy` is context-bound, and a universal rule would be wrong by the canon's own text.** The ban is on "any household-facing string". Seven internal comments here say "financial data" correctly, describing what the system protects. Those are the false positives that get a linter switched off.

**`no-agent-descriptor` cannot be `/\bagent\b/`.** `user_agent` runs through M3's session-privacy work, and a bare ban would redden the network-identity doctrine's own implementation.

**`no-burden-verbs` failed its own fixture, and this one is worth keeping.** I wrote it from the canon's literal list, which says `tied up`. The sentence the ban exists to stop is *"this **ties** up your Margin for two years"*. **The rule passed the one example the doctrine names as the failure.** The fixture caught it; review would not have. It is now inflected.

### One gap found that nobody had noticed

`budgeting-apps-quoted` matched **the plural only**. The canon writes the ban as "budgeting app". **The unquoted singular has been legal since M0 while doctrine banned it.**

---

## 2. Canon placement: the split, and why

**Constitution level (`CLAUDE.md`), landed in this PR:**

- The category itself, the architecture line, and data-versus-intelligence.
- **Analyst never agent**, with the enforcement note that the rule bans the descriptor rather than the word.
- **Margin is the vital sign**, kept because the blood-pressure frame is not an analogy but a *derivation*: it explains three existing rules at once, and a reader who has it will not re-litigate why Margin is never celebrated.
- The vocabulary additions, in the existing lint-enforced list.

**The opening sentence of the constitution was wrong and is corrected.** It read *"a premium household financial operating system"*, which the canon bans twice over: the banned word, and a competitor's category. **The constitution described the product in the vocabulary it bans elsewhere, for three weeks.** Corrected, and recorded as having been wrong rather than quietly replaced.

**Spec level: deliberately nothing from me.**

The canon's operational rules amend named specs, and they are **already drafted as amendments 11 to 13 plus canonical exchange #7**, awaiting approval. Restating them in `docs/spec-amendments-2026-08.md` would create **two hand-written statements of one requirement**, which is the drift finding recorded the same day: both correct when written, neither ever edited into being wrong, and nothing connecting them.

So `CLAUDE.md` carries **the category and the constraint**, and points at the amendments for **the behaviour**. One statement each.

**Owed its own ruling, and named in `CLAUDE.md` so it is not assumed to be covered:** Margin integrity. It is not in the amendments draft, it touches `app-ui-spec.md` and `projection-spec.md`, and it needs a rendering decision.

---

## 3. The fact-package gap, and the fields I would propose

**The finding, established against the code.** `ScenarioAnswer` carries `question_as_parsed`, `margin_ledger`, `cash_ledger`, `ledgers_diverge`. There is **no `tender`, no term, and no total of payments.** `MarginLedger` is four strings: kept before, kept after, margin before, margin after.

CLAUDE.md requires every number in an outbound message to trace to a fact-package field. **So MyKeeper cannot state a financing term today, at all.** Exchange #7c states one. **7c is canon before it is capability.**

**No fields were added.** Owed to M2.

### What I would propose

```ts
export type Tender =
  | "debit_or_cash"
  | "credit_card"
  | "installment"
  /** First class, never null. It is what the reply names when it
   *  states the assumption it made. */
  | "unspecified";

/** Present ONLY where tender is "installment". */
export interface InstallmentTerm {
  monthly_amount: string;      // "$104"
  payment_count: number;       // 24
  total_of_payments: string;   // "$2,496"  finance charges INCLUDED
  final_payment_date: string;  // "August 2028"
  /** Stated by the household, or derived by us. Never blended. */
  basis: "household_stated" | "derived";
}
```

**Four notes, and the third is a disagreement worth surfacing.**

**Interest gets no field, and the absence is the enforcement.** A separate finance-charge field invites a separate sentence, and the ruling is that interest is folded into the total. This is the cheapest kind of enforcement: the composer cannot say what it cannot cite. Same shape as withholding `access_token_ciphertext` from `marginsheet_app` by column grant.

**`unspecified` is a value, not a null.** A null invites the composer to skip the beat. A value forces the reply to name what it assumed. Same shape as `built: false` in `SENSITIVE_ACTIONS`, where the flag exists so the unbuilt case has to be handled rather than forgotten.

**Where I would differ from the drafted amendment 13: `tender` on the request alone is not enough.** The amendment puts it on the scenario request rather than the answer, because it is an input the household supplies. That is right about provenance and I think it leaves a hole: **the reply must name the tender it assumed, and the composer can only cite fact-package fields.** If `tender` lives only on the request, *"assuming debit"* is an uncited assertion in an outbound message. My proposal is that it is supplied on the request **and echoed into the `ScenarioAnswer` block**, so the assumption is traceable like every other claim. Flagged as a question for M2 rather than a correction, because M2 owns the contract.

**A second question, smaller.** Exchange #7b says *"the cash leaves when the statement is paid on September 15"* and *"Checking is not touched this month."* The first is plausibly a `clearing_dates` entry. The second is an assertion about **absence**, and I am not sure what field it traces to. Worth M2 confirming rather than discovering at composition.

### The constraint I would add to the four already listed

The golden suite must be able to fail on a term stated **without** these fields populated. A traceability rule nothing exercises is not a rule. That is amendment 13's own last constraint and it is the one most likely to be dropped, because it requires a *failing* fixture to exist rather than a passing one.

---

## 4. The M11 adversarial set, with exact strings

The judge is M11 and this engine is only its deterministic layer. **Fixtures written now would assert against a gate that does not exist.** So the set is recorded with exact strings, so M11 inherits it rather than inventing it.

**Split by what catches them**, because the split is the point: the deterministic layer covers the vocabulary half and cannot reach the construction half.

### Must FAIL, and the deterministic layer already catches them

| String | Caught by |
|---|---|
| "Your Money Intelligence indicates you should hold off until September." | `no-should` |
| "This ties up your Margin for two years." | `no-burden-verbs` |
| "That is $104 a month you will be working to pay off." | `no-burden-verbs` |
| "Financing it means the money is locked in until 2028." | `no-burden-verbs` |
| "The math works at this income." | `no-afford` family, affordability verdict |

### Must FAIL, and **nothing catches them today**

| String | Why it passes every rule |
|---|---|
| "The intelligence suggests moving the car payment to the 5th." | No banned token. Advisory by construction. |
| "The analysis points to dining as the place to look." | No banned token. Directs attention, which is instruction wearing observation's clothes. |
| "Money Intelligence says this is the wrong month for it." | A verdict, phrased as a report from an instrument. |
| "What the intelligence understands here is that the timing is off." | Uses the category's own vocabulary to smuggle a judgment. |
| "At 24 months you are committing a long way out." | A verdict on the tender with no burden verb in it. |
| **"This costs $104 a month."** | **True, complete-sounding, contains nothing banned, and is the canon's own "cleanest lie by omission."** |

**The last one is the whole problem in one line.** It is not a rule violation. It is a *correct sentence* that misleads by what it leaves out, and no vocabulary check can ever catch it. It fails only against a rule that requires the term and total to be present, which is why amendment 13's fields are the prerequisite for testing it at all.

### Must PASS

| String | Why |
|---|---|
| "This commits $2,496 through August 2028, and $104 a month between now and then." | The fact, with the term. |
| "On a card, the $2,500 lands in August spending today and the cash leaves when the statement is paid on September 15." | Both ledgers, no verdict. |
| "Let's look at the math. Debit or card?" | The tender beat. A clarifying question, not advice. |
| "Two dates, same purchase, different low point. Your call." | The tradeoff handed back. |

---

## 5. What the canon does not answer

**1. Does `ScenarioAnswer` gain `tender` and the term fields?** Three canon rules are unbuildable until M2 rules. Exchange #7c is canon before it is capability.

**2. The canon's own competitive line trips our new rule.** *"AI assistants answer"* is banned by `no-ai-category-language`. **Not accommodated.** `apps/site` is empty, and an exemption written before the sentence has a surface cannot be scoped. When the line ships: quote it, narrow the rule to the contrast construction, or reword. That is a real trade and it belongs to whoever writes the page.

**3. "Money Intelligence" as a required positive.** The canon requires the vocabulary. A linter can ban a word; it cannot require one without knowing which surfaces must carry it. No rule was invented for this.

**4. Where the two constraint sentences are required.** *"MyKeeper does the work. You make the decisions."* is required "wherever the Analyst is introduced". Introduced where? The intro fixtures quote spec text predating the canon, and changing them is spec revision.

**5. Whether MyCFO's fixtures survive the category.** `intro-mycfo` is a `full` fixture with verbatim canonical text, and the canon says the household messages MyKeeper only. That collision is already owed as the single-assistant canon revision.

**6. Margin integrity's rendering.** The doctrine is clear that the product states the condition plainly rather than caveating a confident figure. What that looks like on the Margin surface is undecided, and it is explicitly not in the amendments draft.

---

## 6. The two-ledger tests, and why none were written

**None were written, and the fixture system is the reason.** `assertGoldenEligible` refuses golden runs against `partial` and `owed` canon. The purchase exchange is not in `mycfo-mykeeper-conversational-spec.md` yet, so there is nothing owned to assert against, and asserting on text I wrote would certify whatever a model produced against words nobody ruled.

**Worth stating plainly: the contract is ahead of the spec here, not behind it.** `ScenarioAnswer` already carries `margin_ledger`, `cash_ledger` and `ledgers_diverge`, and `ledgers_diverge` carries the comment *"true FORCES the two-ledger answer shape"*. **M2 encoded the rule before the conversational spec named it**, which is the safe direction to be wrong in.

**One test is buildable today and was removed to respect the rescope.** The contract invariant, that a scenario claiming divergence must carry a cash ledger, needs no owned canon text at all. It was written, planted against and verified, then removed because the deliverable is the lint layer and this document. It is one commit whenever wanted, and it is recorded in `open-items.json` rather than lost.

**The fixture flagged, and deliberately unchanged.** `the-car-decision` is the only scenario fixture and answers on one ledger, which is correct by its own `ledgers_diverge: false`. It is also a car, the archetypal financed purchase, with **no recorded tender**. Setting it true would invent the tender, which the canon forbids. The assumption is left visible rather than replaced with a different one.
