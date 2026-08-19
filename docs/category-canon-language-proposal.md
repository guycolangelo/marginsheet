# Money Intelligence: the language layer
## Proposal, 18 August 2026. NOT MERGED. Category canon v3.1 (tier 4, level with the spec text it amends).

---

## 0. The headline, before the detail

**Three of the five scoped parts have almost nothing to change, and that is the finding rather than a shortfall.**

| Part | Scope named | What is actually there |
|---|---|---|
| 1. System prompts | MyKeeper's self-description, category framing | **`prompts/` contains one file: `.gitkeep`.** No prompts exist. |
| 2. Lint layer | Extend the vocabulary linter | **Real work, and it is where this PR lives.** |
| 3. In-product copy | Every user-visible string in `apps/web` | **`apps/web` is one 33-line M0 placeholder** whose own comment says "the app arrives with M8". |
| 4. Advice gate coverage | Fixtures for smuggled recommendations | **Half buildable.** The other half needs the M11 judge. |
| 5. Two-ledger golden tests | Assert both ledgers, tender, term | **One third buildable.** Two thirds need fact-package fields that do not exist. |

**The string named in the scope does not exist.** `"Complete Household Financial Management System"` appears nowhere in the repository. Neither does any variant. Searched across every tracked file.

**The count of household-facing strings changed by this proposal is one, and it is a comment.** Not one sentence a household will read was reworded, because there are none yet.

---

## 1. The table of changed strings

| File | Old | New | Kind |
|---|---|---|---|
| `apps/web/public/index.html:16` | `this product's clicks are households' financial data` | `this product's clicks are households' money data` | **Internal HTML comment.** Not user-visible. Changed so `apps/web` passes the new `household_copy` scan rather than being allowlisted. |

That is the entire table. Every other `financial` in the repository is in code comments outside household trees, where the canon's own wording (`any household-facing string`) does not reach.

**Not changed, deliberately:** `financial_accounts`, the M4 table name, which the rule is asserted not to match; and six internal comments in `services/api`, `packages/shared` and `packages/schema` that use "financial data" correctly to describe what the system protects.

---

## 2. The lint rules, with their planted failures

Six new rules and one extension. **Every one ships as a fixture pair**: a string that must fire and a string that must not.

| Rule | Contexts | Fires on | Permits |
|---|---|---|---|
| `no-financial-in-household-copy` | `household_copy`, `composed_artifact` | "your financial picture" | our own comments; `financial_accounts` |
| `no-competitor-category-terms` | universal | personal finance, financial management/wellness/health | Money Intelligence Platform |
| `no-agent-descriptor` | universal | "MyKeeper is an agent", "AI agent", "agentic" | `user_agent`, "user agent" |
| `no-ai-category-language` | universal | AI-powered, AI assistant | (see finding 5) |
| `money-intelligence-capitalized` | universal | lowercase "money intelligence" | the capitalised noun |
| `no-burden-verbs` | artifact, analytical, decision, copy | "this ties up your Margin" | "this commits $2,496 through August 2028" |
| `budgeting-apps-quoted` **extended** | universal | the unquoted **singular** | either form, quoted |

### Three of these were designed against a failure the obvious version would have missed

**`no-financial-in-household-copy` is not universal, and binding it universally would be wrong by the canon's own terms.** The canon bans the word in "any household-facing string". Seven internal comments in this repo say "financial data" correctly, describing what the system protects. A universal rule fires on privacy code doing exactly what doctrine asks, and a rule that fires on our own reasoning is a rule people learn to suppress. Same lesson as `no-mycfo-in-composed-output`: the context binding is the rule.

**`no-agent-descriptor` cannot be `/\bagent\b/`.** `user_agent` is an HTTP header appearing throughout M3's session-privacy work. A bare word ban would redden the network-identity doctrine's own implementation. The canon bans the **descriptor**, and the pattern matches the descriptor.

**`no-burden-verbs` was written from the canon's literal list and failed its own fixture.** The canon lists `tied up`. The sentence the ban exists to stop, quoted in the task itself, is "this **ties** up your Margin for two years". The literal rule passed it. Caught by the fixture, not by review, and now inflected.

### The extension nobody asked for

`budgeting-apps-quoted` matched the plural only. The canon writes the ban as **"budgeting app"**. The singular has been legal since M0 while the doctrine banned it.

---

## 3. The advice gate: coverage added, and the half that cannot be

**No behaviour change**, as scoped. What the deterministic layer can and cannot reach splits cleanly, and the split is the finding.

**Catchable, and now covered:**
- "your Money Intelligence indicates you **should**" → `no-should`, already existed
- "this **ties up** your Margin for two years" → `no-burden-verbs`, new

**Not catchable, and recorded as `advice-gate-judge-half-untestable`:**
- "the intelligence **suggests**"
- "the analysis **points to**"
- "this costs **$104 a month**" with no term

None of those contains a banned token. They are advisory or misleading **by construction, not by vocabulary**, and `packages/lint` describes itself as "the deterministic layer of M11's advice gate". The judge is M11 and does not exist.

**The financing pair is the sharpest case in the product and both halves are now tested:**

> `This commits $2,496 through August 2028.` **passes**
> `This ties up your Margin for two years.` **fires**

One word apart, as the task says. What no lint rule can catch is the third form: **`This costs $104 a month.`** True, containing nothing banned, and the canon's own description of it is "the category's cleanest lie by omission". That needs the term in the fact package, which brings us to the fence.

---

## 4. Where the scope fence was hit, three times

The instruction was to stop and report rather than route around. Three tasks in the scope require changes the same instruction refuses.

**The two-ledger rule needs a `tender` field.** The canon makes tender the thing that decides divergence: debit is a gap of zero, a credit card is a one-cycle gap, an installment has no lump at all. `ScenarioAnswer` carries `question_as_parsed`, `margin_ledger`, `cash_ledger`, `ledgers_diverge` and nothing else. "Establish the tender before a cash-timing claim" cannot be tested because it cannot be composed.

**The financing verdict needs `term` and `total`.** `MarginLedger` is four strings: kept before, kept after, margin before, margin after. CLAUDE.md: "every number traces to a fact-package field or it is a hard failure." The canon: "$2,496 through August 2028." Both cannot hold with this contract. **The financing verdict is not untested, it is uncomposable.**

**Margin integrity is engine work.** Detecting an unconnected spending account from card payments leaving for an account we do not hold is transaction analysis. Material uncategorized inflow needs a threshold. Neither is language.

All three are logged with owners and triggers. None was worked around.

---

## 5. What the two-ledger tests actually assert

Built against **the contract that already exists**, not against spec text I would have had to invent.

The fact package already models the rule. `ledgers_diverge` carries the comment *"true FORCES the two-ledger answer shape"*, written before this canon and agreeing with it. So the invariant is testable now:

- a scenario claiming divergence **must** carry a cash ledger
- a non-diverging scenario may answer on one, because the rule is "wherever they diverge", not "always"
- no scenario fixture is golden-eligible, so **no text is being certified**

Planted and verified: flipping `the-car-decision` to claim divergence while carrying no cash ledger reddens the invariant.

### The fixture flagged, and why it was left alone

**`the-car-decision` is the only scenario fixture and it answers on one ledger.** It sets `ledgers_diverge: false`, so that is correct **by its own data**.

It is also a car, the archetypal financed purchase, and **nothing in the fixture records how it is paid for**. The `false` is internally consistent and rests on an assumption nobody stated.

**It was not changed.** Setting it true would mean inventing the tender, and the canon says the tender cannot be inferred and must be asked. The asking beat does not exist in the spec. So the assumption is asserted in a test where it is visible, rather than corrected into a different assumption.

---

## 6. What the canon does not answer

1. **Does the fact-package contract gain `tender`, `term` and `total`?** Three canon rules are unbuildable until this is ruled. Refused by this task's scope.
2. **The competitive line trips our own rule.** "AI assistants answer" is banned by `no-ai-category-language`. Not accommodated: the line is marketing copy, `apps/site` is empty, and an exemption written before the sentence has a surface cannot be scoped.
3. **"Money Intelligence" as a required positive.** The canon requires the vocabulary; a linter can ban a word but cannot require one without knowing which surfaces must carry it. No rule was invented for this.
4. **Where the two constraint sentences are required.** "MyKeeper does the work. You make the decisions." is required "wherever the Analyst is introduced". Introduced where? The intro fixtures are `IntroMyKeeper` and `IntroMyCFO`, both quoting spec text that predates the canon. Changing them is spec revision, not linting.
5. **Whether MyCFO's fixtures survive the category.** `intro-mycfo` is a `full` fixture with verbatim canonical text. The canon says the household messages MyKeeper only. That collision is already owed as the single-assistant canon revision and is not this task's.
6. **BNPL's shape.** Empirical, answerable at 4.5b.

---

## 7. What was not touched

Schema, statement structure, category mapping, engines, the Plaid pipeline, M4's Durable Objects work, the fact-package contract, routing, and any behavioural change to either brain. The advice gate's mechanism is unchanged; only its test coverage grew.

No migration. No fixture data edited. No spec text written.
