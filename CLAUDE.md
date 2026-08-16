# CLAUDE.md — MarginSheet™
## The constitution. Read before every task. If a task contradicts this file, stop and ask Guy.

MarginSheet is a premium household financial operating system: an AI bookkeeper (MyKeeper™) and an AI CFO (MyCFO™) keep a household's books and watch the month ahead. The core is three things: the brains, the MarginSheet (actuals + projections), and Cash Flow. The product is a belief system — The Margin Method™ — and features are downstream of doctrine.

---

## Authority hierarchy (when documents disagree)

1. Guy's live rulings in conversation
2. `conversation-service-spec.md` + `mycfo-mykeeper-conversational-spec.md` (all of Phase B)
3. The Margin Method / Manifesto (doctrine, vocabulary, posture)
4. The eight Phase A specs (below)
5. Base44 code (historical reference only; it is being decommissioned)

## The spec map

| Module | Spec |
|---|---|
| M0 foundation | this file |
| M1 schema | `data-model-spec.md` |
| M2 fact packages | conversation-service-spec §fact-package |
| M3, M7 auth/spine/billing | `identity-onboarding-spec.md` |
| M4 Plaid | `plaid-pipeline-spec.md` |
| M5 filing | `categorization-spec.md` |
| M6a actuals | `ledger-spec.md` |
| M6b projections/goals/cash flow | `projection-spec.md` |
| M8 app | `app-ui-spec.md` |
| M9 migration | `migration-spec.md` |
| Amendments, Aug 2026 | `docs/spec-amendments-2026-08.md` (year-end projection, goal priority, Dashboard, Cash Flow, budgeting scope) |
| M10–M21 conversation service | conversation-service-spec + conversational spec |

---

## Build discipline (non-negotiable)

- **One module at a time. Never stacked.** Tests green before the next module opens.
- **Every task plan is drafted for Guy's approval before execution.** No unapproved scope.
- **Verify against the database directly, never against reports.** Reports lie, data doesn't.
- **"If the thing this guards were completely broken, would this go red?"** Ask it of every control before trusting it. A control that observes something adjacent to what it is trusted to guarantee will pass honestly and forever while the guarantee is absent. Eight have now failed this question: `/health` returned green against three databases holding zero tables; six connection-string secrets held the empty string while every environment reported healthy; the isolation suite validated a credential no Worker uses; the production environment carried no reviewer while the workflow said it did; a live Twilio probe reported DECOUPLING: HOLDS by scanning a 404 error body; deploy verification was guarded by `if: success()`, so it reported on the case where nothing was wrong and was absent in the case it existed to catch; the role-rotation gate asked permission to rotate and never named a target; and **the open-items mechanism this file has required since M0 was never built at all.** Each was correctly written. None could go red. A control that cannot fail is documentation.

  The sixth is the purest example of the family and worth stating on its own: **it was not a control pointed at the wrong thing, it was a control that structurally cannot observe its own failure case.** The first five watched a proxy. This one watched the right thing and was skipped exactly when the thing went wrong. When a check is conditional, the condition is part of the check, and "run only if everything already succeeded" means "never run when it matters."

  Its sibling: nothing compared deployed state against main's tip, so **"green" never meant "current."** An approval arriving out of order rolled production back one commit and no check said so. A control that verifies the artifact without verifying that the artifact is the current one is answering a question nobody asked.

- **The eighth is the one that was tracking the other seven.** This file has required since M0 that "open items travel with named owners and print in CI". Nothing implemented it. Every owed item across three modules lived in prose that no gate ever read: the reviewer that did not exist, the handler half owed to M4 and M7, the canon fixtures, the sandbox limits that fail closed only when a real recipient appears. They were recorded faithfully and tracked by nobody.

  That makes it different in kind from the other seven. **A control that guards nothing is one failure; the mechanism for remembering failures guarding nothing is how the other seven stayed open.** It was found the same way as the rest, by trying to use it: an item needed recording "like the others" and there were no others.

  Now `docs/open-items.json` carries them and the `open-items` CI job prints them, failing when an item has no owner or nothing it is owed to. It does **not** fail because items exist. Carrying an open item is legitimate; carrying an unowned one is not.

- **Guard the target, not the action.** A gate that asks "am I allowed to do this" is not a gate on "am I allowed to do this **here**", and the damage is always decided by the second question. The role-rotating test suites were gated by `AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE`, a permission to rotate that never named a place. It was set by hand against the shared dev branch on 16 Aug 2026 and dev's Workers lost their database until the secret was reissued. The operator answering that prompt is answering a question about themselves while the blast radius is a property of the target. **Any destructive operation guarded by permission rather than by place has this hole.**

  Two corollaries, both paid for.

  **Allowlist the target, never blocklist it.** Resolving the endpoint and refusing dev, staging and main is a blocklist, and a blocklist is wrong by default the moment a new long-lived branch exists: the one nobody remembered to add is the one that gets destroyed. Naming the target and refusing anything that is not `pr-<n>` fails closed on everything unanticipated. Same shape as the enumerated column grants in migrations 0002 and 0011, which list what the role may write rather than granting ALL and subtracting.

  **The refusal belongs at the operation, not in each caller.** Four test files carried their own copy of the `ALTER ROLE` and their own copy of the gate. A control that has to be remembered in four places is a control that will be correct in three. It now lives in one helper that throws before the connection is touched, so a caller whose skip logic is wrong still cannot rotate anything.

  The workflow had also carried a prominent comment saying "Never point this at a long-lived branch." It was accurate and it stopped nothing, which is the 15 Aug lesson restated: **a document asserting a practice is not evidence of the practice.**
- **A journey test starts where the household starts.** For any flow that ends in a person doing something, the test follows the artifact the person receives: it fetches the URL out of the sent email, presents the token as delivered, opens what was actually sent. It does not call the handler directly. Calling the handler proves the mechanism; only following the artifact proves the journey, and a household never reaches the mechanism except through the artifact. On 16 Aug 2026 eleven passing tests proved a sign-in action worked while the emailed link returned 404, because every one of them reached past the link. This shape recurs wherever a composed message contains something a person is meant to act on, which is most of M13, M14 and M15.
- **Migrations are append-only after merge.** Once a migration file is on main, its contents are frozen. Corrections go forward as a new migration, never as an edit. The failure mode is worse than an error: an environment that has already applied a migration will never apply it again, so an edit reaches only the databases that have not seen it yet, and you end up with **two databases carrying identical ledgers and different schemas**. Nothing reports a problem until something reads the column. Enforced by the `migrations-append-only` CI job, which hashes every migration on main and fails on any modification. Additions pass; edits do not.
- Each spec's invariants section seeds that module's test suite. An invariant without a test is not done.
- Golden tests and the lint layer block merges in CI. No prompt version ships failing either.
- The advice gate is live before the first real message ever sends, and it never fails open.
- Scope creep toward parked items (Module 8 Balance Sheet, Module 11 build, shared learning networks, early-activation offer) is refused by default; "while we're in there" is a 2027 phrase.

## Stack (locked)

Cloudflare Workers + Pages · Neon Postgres (single DB, branching in CI) · Durable Objects (per-household lock) · Queues + Cron · R2 · Better Auth (passwordless: passkey + magic link; phone = security primitive via Twilio Verify) · Plaid production (Sandbox for CI only) · Stripe · Twilio (two A2P numbers, one per brain) · Postmark (brains' email) · Kit (commercial voice only) · Sentry · PostHog · GitHub Actions.

**Model routing** (fallback chains, golden-tested per chain member):
- High-stakes composition (close, Briefing, verdict-flip corrections): Fable 5 → Sonnet 5 → **stop and queue**
- Routine composition: Fable 5 → Sonnet 5 (flagged)
- Time-critical alerts: Fable 5 → Sonnet 5 → canonical fixture
- Advice-gate judge: Sonnet 5 → Haiku 4.5 → **no send, ever**
- Parsing/extraction/merchant lookup: Haiku 4.5 → Sonnet 5
- The composer never computes; every number traces to a fact-package field or it is a hard failure.

## Vocabulary and format (locked; lint-enforced)

- Dollar result = **Kept** (negative = **Overspent**). Percentage = **Margin**, always the % symbol.
- Negative Margin in parentheses: (6%). Positive figures never take parentheses. Overspent renders as a positive figure and is never behavioral commentary.
- **No em dashes anywhere**, in any output, code comments included.
- "budgeting apps" always in quotation marks. "Commandments" banned. Numerals for day counts ("the first 14 days").
- ™ on first/prominent use: MarginSheet™, The Margin Method™, MyKeeper™, MyCFO™. "AI" never appended to the marks. **"AI" appended is lint-enforced; PLACEMENT IS NOT, deliberately (ruled 16 Aug 2026).** The unit of "first use" is a **journey, not a file**: the sign-in confirm page and the signed-in page are two files and one journey, and a household walking it met the mark twice inside two sentences while each file was individually correct. A file-scoped rule would have passed that and called it checked. **A rule that is wrong about its unit is worse than a human reading the copy**, because it produces confidence rather than merely producing nothing. So trademark placement is a **copy-review item**, checked when a journey's copy is reviewed, and it is not lint's job.
- P&L lines: income, fixed_obligations, variable_operating, discretionary, interest_fees, transfer, deployment. Taxes is a category ("Taxes After Takehome") under fixed_obligations, **not a line**.
- Banned in analytical replies: "should," "need to," "afford," "cut" (as instruction), "recommend," affordability verdicts, "delta/variance/discrepancy" in corrections, "again/still haven't/reminder" in follow-up alerts, "good call"/"that cost you" on decisions.

## Product doctrine (the short form)

- Income − Spending = Kept. The trial is 14 days, card required. Annual Planning Session is included with every subscription; the clean-books gate is eligibility, never price.
- Unconfirmed inflows count as income, labeled, with the transparency counterfactual shown. Transfers are neither. Refunds net against spending. Reimbursements are AR. Gifts are income, filed by asking.
- The brains state facts and costs; they never name actions with money. Meanings are asked, never asserted. Estimates are sourced or asked, never invented. Model memory is banned as a source for current figures.
- Commercial voice (billing, offers, dunning) is MarginSheet through Kit — never a brain.
- The app is the inspection room, not the workroom. Nothing chases the household.
- Corrections: fix the books first, own it in one flat sentence, never silently revise a sent artifact.

## THE SINGLE ASSISTANT RULING (locked 15 August 2026)

Supersedes the two-staff model everywhere it appears.

**MyKeeper is the household's only named assistant.** One name, one phone number, one contact card, one email identity. A household never chooses who to contact, because there is only one door.

Behind that name the two brains remain architecturally separate:
- The bookkeeping brain: retrospective, transaction-level, structured.
- The advisory brain: prospective, aggregate-level, forward-looking.

They keep separate system prompts, separate jurisdictions, separate golden tests, and **the advice gate stays enforced on advisory output exactly as specified**. MyKeeper routes to the right brain, sometimes both, and answers as one.

**MyCFO becomes an INTERNAL DESIGNATION ONLY.** It may appear in fact packages, routing config, instrumentation, and the QA harness. It must never appear in any household-facing surface, message, email, or marketing. "MyCFO" is a banned string in composed output, enforced by `packages/lint` alongside the other banned constructions.

Consequences:
1. The conversational spec's two registers become two MODES of one voice. That is a canon revision, not a rename, and it is **owed to Guy**.
2. Handoffs stay in the architecture and become invisible. The three-minute fulfillment budget still applies; the brains no longer name each other to the household.
3. One A2P campaign, one number, one Postmark sender identity instead of two.
4. Intro flow: one introduction, not two staggered ones.
5. Any fact-package class existing only to carry cross-brain attribution is reviewed and **reported**, never silently deleted.

## THE ARTICLE-AS-ANSWER PATTERN (locked 15 August 2026)

Names a permitted mechanic. It tightens nothing and loosens nothing.

When a household asks a strategy question (debt payoff order is the canonical case), the permitted answer is: name the common approaches evenly with their real rationale, point to a published Method article, and state that the choice is theirs. Once the household names their choice, serve the data sorted the way that choice implies.

"Here are your cards ranked by rate, highest first" is a fact and passes. "Here's where to start" is a recommendation and fails. **The sorted list does the work; the framing sentence must not.**

This requires a named reference source in the fact package that the composer may point to, distinct from prose it generates. Owed as an M2 amendment with its own plan (Guy, 15 Aug 2026), carrying two requirements he added:

1. **The article's identity is a stable slug, not its URL or title.** Both of those change when an article is edited or renamed. The reference block carries the slug and resolves title and URL at assembly time, so a renamed article never strands a citation inside an artifact that was already sent. This is the same rule as corrections: a household who read something on Tuesday must still find it on Friday.
2. **The gate rule ships as a fixture PAIR, not only as a rule.** One passing example (cards ranked by rate, reference attached, no action named) and one failing example (the same list, framed as "here's where to start"). Side by side they make the line teachable to whoever tunes the judge; a rule stated in prose does not.

## NET WORTH DOCTRINE (locked August 2026)

MarginSheet's promise is control, and the opportunity to create wealth. It never promises wealth outcomes. The causal chain in all copy and all product language is: control, then opportunity, then wealth. Only the first is promised.

1. Net worth is never a hero metric. It is never the largest number on a screen, never the lead figure in a digest, never the opening line of any composed deliverable.
2. Net worth is never celebrated. No congratulations, no milestones, no streaks, no achievement framing, from either brain, in any channel, ever. The brains do not have opinions about the size of a household's net worth in either direction.
3. The Module 8 Balance Sheet reports position ("where you stand") without scoring it. Net worth may appear as a computed line on the Balance Sheet. It is information, not evaluation.
4. Margin is the only celebrated number, because Margin is the only number the household controls. Net worth moves with markets and estimates; Margin moves only with household decisions.
5. Rationale for reviewers: a net-worth-led product flatters the user about assets the same way a moralizing product lectures the user about debts. Both are the tool having opinions about the person. MarginSheet is an instrument. It sees everything and judges nothing.

Rules 1 and 2 are enforced by `packages/lint` (`no-net-worth-lead`, `no-net-worth-celebration`), the same engine that gates commits today and M11's send path in October. Rule 1's "largest number on a screen" clause is a design review item, not lint-detectable; see the rules file.

## Current state (updated 14 Aug 2026)

Spec phase complete (8/8 + 2 brain docs). Targets: **1 Oct stretch** (platform, founder migrated), **1 Nov real** (founder fully live), beta cohort gated on founder OK + objective floor (zero advice-gate hard failures, zero traceability failures, trailing 14 days). M0 opens next. External clocks: A2P 10DLC submission, cyber liability quotes, attorney hour (8 items) — Guy's desk.
