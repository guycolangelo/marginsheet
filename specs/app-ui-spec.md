# app-ui-spec.md
## The application: surfaces, data contracts, actions. Governs M8.
## Drafted 14 August 2026. This is the inventory-and-contracts document: what every surface consumes, exposes, and has promised. Visual design is explicitly NOT here — it belongs to the Claude Design pass this document feeds, ported to React per the stack.

Sources: the marginsheet.com promises (site audit), Base44's page inventory (`src/pages/`, extracted tree), every engine spec drafted 14 August, the brain spec's app-side requirements (memory surface, tag view, in-app queue).

---

## 0. Doctrine for the app itself

The app is the **inspection room, not the workroom**. The site promises "we will never put you to work" and "nobody in your house reviews a transaction — that is the entire point." Therefore:

- No surface may *require* routine attention. Every surface answers a visit; none solicits one.
- No badges, streaks, unread counts engineered for return visits, or red dots on money. The question queue shows its count plainly when visited; it never chases.
- Conversation lives in SMS; documents live in email; **the app is where the household verifies, inspects, and administers.** The brains are reachable from the app only as deep links into the existing channels, never as an in-app chat surface at launch (one exception: the ported per-transaction bookkeeper chat, §3, which is transaction-scoped by design).
- Every number rendered traces to an engine output. The app computes nothing; it renders `get-marginsheet`-successor responses, projection outputs, and balance paths. (The transparency block ships to the UI for exactly this reason.)
- Vocabulary is locked everywhere pixels render: Kept, Margin, Overspent (parenthesized negatives, positives never parenthesized), MarginSheet, the Waterfall. % always the symbol. No em dashes in any string.

**Platform:** responsive web (Pages), mobile-first — beta households will meet every surface on a phone. No native app at launch.

---

## 1. Navigation inventory

Seven primary surfaces plus administration. Base44's page set (MarginSheet, Transactions, Accounts, AccountDetail, Settings, plus auth/checkout flows) maps forward; three surfaces are new builds (Cash Flow, Goals, Memory).

| Surface | Status | Governs-spec |
|---|---|---|
| 1. MarginSheet (home) | Port + projection column | ledger, projection |
| 2. Transactions (the ledger) | Port | ledger, categorization |
| 3. Questions (the queue) | Port, restyled around dispatch state | categorization, brain spec |
| 4. Cash Flow | **New** | projection §4 |
| 5. Goals | **New** | projection §2 |
| 6. Memory | **New** | brain spec (known_context, decision journal, standing instructions) |
| 7. Accounts | Port | plaid-pipeline |
| 8. Settings | Port + additions | identity-onboarding, M20 |

---

## 2. Surface 1: The MarginSheet

The home surface. Two columns on desktop, stacked on mobile, exactly as the site renders the demo: **last month settled, this month projected.**

**Consumes:** the M6a actuals response (income by source with drill filters, spending sections by line, Kept, Margin, deployment below the line, awaiting-reimbursement, the transparency block, available months) + the M6b `ProjectedMonth` (blend with component kind labels, `vs_goals`).

**Contracts:**
- **Every line opens** (site promise): every subline carries its `drill_filter`; tapping renders the filtered Transactions surface. This includes lines inside the close *email* — the close deep-links here, so drill routes are URL-addressable (`/transactions?merchants=…&direction=…&date_from=…`).
- **The 20% aim** renders on every sheet as the Method's stated standard against the household's Margin — attributed ("The Method's aim: 20%"), never imperative, per the advice-gate carve-out. When Household Goals holds a chosen target, the chosen target renders instead, labeled as theirs.
- The projected column labels components by kind — posted / committed / estimated — quietly (the site's "(two payments)" and "(estimated payment)" annotations are this contract already).
- The transparency block renders as one calm line when nonzero ("3 unresolved items could move this month by up to $412"), linking to Questions. Never a warning color; the inclusion doctrine is confident, not anxious.
- Overspent months render the parenthesized Margin exactly as the demo does. Verdict styling never moralizes.
- Month picker across `available_months`; deployment section renders debt payoff and savings/investing with the "destination not specified" fallback rows visible (ledger §6 rung 6 — attributed deployment never silently vanishes, and neither does unattributed).

---

## 3. Surface 2: Transactions

The full ledger, ported from Base44's Transactions + transaction components.

**Consumes:** paginated transaction queries (the `transactions-get` successor) with every filter the drill routes need: date range, merchants[], direction, category, account, uncategorized, tag, review_state.

**Contracts:**
- Row shows: cleaned merchant, raw descriptor on expand (always preserved, ledger doctrine), amount, date, account mask, category chip, and state flags (pending, provisional, reimbursable with lifecycle, refund-paired, transfer-paired, split-parent rollup).
- Actions per row: recategorize (mints the correction through the same machinery a text answer uses — one learning path, not two), mark transfer / reimbursable, split, note, and the **ported per-transaction bookkeeper chat** (`chat_transcript`), kept transaction-scoped as-is per the data-model ruling.
- **Single-transaction vs. merchant-wide scope is explicit at recategorize:** "just this one" (transaction corrected, `user_reviewed`, no learning minted) or "Publix always" (merchant correction minted, applies forward and to the cluster). The same scope distinction the conversational path honors (categorization-spec amendment: the `correct_transaction` intent). Default: just this one — over-learning from a one-off is the quiet failure.
- **Category management** (ported `manage-categories`): create custom categories and subcategories, assign P&L line, edit, archive (system categories archive, never delete). Lives behind the category picker's "manage" door — **optional, never a step in any path.** Nobody is ever asked to build a tree; the seeded defaults are the product working, not a starting template.
- **Rule management** (ported `manage-rules`): full rule CRUD — conditions (merchant contains/exact, amount gte/lte, account, direction, channel), actions (category, mark transfer/reimbursable/deployment/reviewed), account scope, active toggle. `manual` and `learned` rules render in one list with their source labeled; a rule minted from a text answer is editable here like any other. Same door posture: available, never required, never suggested by the UI.
- Reimbursables view: the AR list (open/received/converted lifecycle, ported `manage-reimbursement` flow) — this is where "awaiting reimbursement" on the MarginSheet lands.
- Refund pairs render the link both directions ("refund of the June 3 purchase") — the `refund_pair_id` contract from the ledger ruling.
- Never a bulk "review all" workflow. The queue is the queue; the ledger is for looking things up.

---

## 4. Surface 3: Questions

The in-app queue — the fallback surface the brain spec requires (questions returned after one clarification land here; the silence doctrine's overflow lands here).

**Consumes:** grouped queue items (clusters per categorization §9: merchant groups, deposit clusters with cadence descriptions) + `question_dispatches` state (sent to whom, answered by whom, conflicts).

**Contracts:**
- Each card is the *same question the text asked*, same wording, same answer space — answering here resolves through the identical machinery (mint, apply to group, clear). One question, two doors.
- Dispatch state renders honestly: "texted to you and Sarah Tuesday," "Sarah answered — filed as the Hendersons' gift" (closure receipts visible), conflict cards show both answers and ask which to file, mirroring the SMS behavior.
- Deposit-cluster cards carry the cluster description ("4 deposits of $7,819–$10,000, arriving roughly monthly") — ported `describeCluster` output.
- The count is stated plainly on the surface itself. It appears nowhere else in the app chrome (doctrine §0).

---

## 5. Surface 4: Cash Flow (new)

The choreography surface. **The scope that grew 14 August:** all depository accounts, per-account paths plus the household sum, 13 weeks.

**Consumes:** `BalancePath` per account and `all_depository` (projection §4): daily points, expected in/out per day, trough, tight week, `short` and `short_but_covered` events.

**Contracts:**
- Default view: the **summed depository path**, 13 weeks, daily resolution rendered with weekly bucketing beyond ~5 weeks (rendering choice; the data stays daily). Trough and tight week marked.
- Account switcher: each depository account's own path — this is where `short_but_covered` becomes *visible* ("checking dips under the Amex pull on the 15th; savings is fine"), matching the watcher's message without the app ever advising a move.
- Commitments render on their dates with source honesty (statement-fact autopays vs. average-based streams — the LiabilityDetail-vs-Recurring authority distinction, shown quietly).
- Events render as calm markers, never alarms; the watcher owns urgency, in-channel. The app shows state.
- Tapping a commitment opens its detail: cadence, window, history of matches, source, account attribution — and the one action: **"this isn't right"** → a correction path (pause / wrong amount / wrong account) that writes household-stated authority over the machine's inference.

---

## 6. Surface 5: Goals (new)

Household Goals, the stated object (projection §2).

**Consumes:** the `household_goals` row + linked known_context goal entries with provenance + `vs_goals` from the projection.

**Contracts:**
- Margin target: shown as theirs when chosen (with who/when provenance), as the Method's 20% aim when not — same attribution rule as the MarginSheet rendering.
- Life Happens target: months chosen, dollars computed, and the two-direction resilience number (forward target / backward runway) per the brain spec.
- Goals list: known_context goals, attributed ("Guy, at onboarding: pay off the truck"), editable — edits supersede with the dormant-link mechanics, never overwrite.
- Setting/changing a target here is a first-class write to Household Goals with `set_with = app`. The Annual Plan block renders "opens with budget season" until Module 11 exists — a real product surface stating a real future, not a fake door.
- On-track state renders as the projection-vs-goal comparison, factually. No celebration, no shame; the close email owns narrative.

---

## 7. Surface 6: Memory (new)

The household memory surface — the brain spec calls it a trust claim no competitor can copy: *see exactly what your staff knows.*

**Consumes:** known_context (all types, lifecycle states), standing instructions, tags + members + exclusions, the decision journal.

**Contracts:**
- Every known_context entry: text, type, provenance (who said it, when), lifecycle state. Dormant entries visible under "past" (dormant means stop volunteering, never stop knowing). **Correct** (supersedes) and **delete** (true deletion from composition, tombstoned) on every entry — the data-model invariant made touchable.
- Standing instructions listed per member with plain restatements ("Questions go to Sarah. The monthly statement still goes to you both."), editable, floor-protected classes marked as un-silenceable.
- Tag view (brain spec requirement): each tag, its confirmed merchants, its maybes, its exclusions ("Dugout Mugs — excluded, remembered"), its watch status.
- Decision journal: the scenarios modeled, arithmetic shown, what was chosen — rendered as records, never scored ("good call" and "that cost you" are banned strings here as everywhere).
- No confidence values anywhere on this surface, structurally (the fields don't exist to leak).

---

## 8. Surface 7: Accounts

Ported: institutions, accounts, balances, connection health, per-account detail (AccountDetail), snapshots history.

**Contracts:** reauth banner when `needs_reauth` (the app-surface-not-SMS ruling from plaid-pipeline §4); add-institution always available; remove-institution with plain consequences stated; credit cards show card_state and payoff-pool membership with the confirm flow (`classification_confirmed_at`) ported minus the removed interstitial; manual assets (ManualAsset ports — Module 8 groundwork stays alive).

---

## 9. Surface 8: Settings

Ported + the 14 August additions:
- Profile (display name, email), **phone with the in-app-only change flow behind recent-auth** (identity §1)
- Members: list, invite (name + phone), roles visible, remove (primary only, recent-auth)
- Passkeys: list, name, add, revoke (Better Auth surface)
- Billing: plan, next charge, card update (SetupIntent), **cancel — two interactions from here, confirm screen carrying exactly the retention question + export pointer + confirm** (identity §6, verbatim)
- Export: request → R2 link (the exit-package contents per M20; downloadable anytime, not only at exit — "the books are always yours" is cheap to honor early)
- Consent records visible (what was agreed to, when)
- Notification preferences **do not live here** — they are standing instructions, told to the brains, rendered in Memory (§7). Settings links there with one line explaining why. This is a doctrine choice, made deliberately: preferences are conversation, not configuration.

---

## 10. Onboarding surfaces

The spine's six steps (identity §2) are M7 build but render inside M8's shell: step components, progress, the Plaid accordion, resumption into the first incomplete step. Plus: paywall states for `canceled`/`expired` (plain state + card path, never a 403), past-due banner (Kit owns dunning; the app states the state).

---

## 11. Invariants (M8 test seeds)

1. Every rendered number matches its engine response byte-for-byte after formatting rules; the app performs no arithmetic (asserted by contract tests against fixture responses).
2. Every drill route is URL-addressable and resolves from a cold load (the close email depends on it).
3. Deleting a memory entry removes it from composition (round-trip: delete → compose a digest fixture → entry absent).
4. Recategorizing in-app and answering by text produce identical learned records.
5. No surface renders a badge, count, or prompt outside its own page (doctrine §0, checked by chrome audit).
6. The vocabulary lint (Overspent parentheses, % symbol, no em dashes) runs on the string catalog in CI.
7. Phone change is unreachable without recent-auth; cancel is reachable in two interactions; both asserted by flow tests.
8. Mobile-first: every surface passes at 375px; the MarginSheet demo layouts match the site's stacked rendering.

---

## 12. What this document deliberately does not decide

Layout, spacing, type, color, motion, component design: **Claude Design's pass**, exported and ported to React, with the Manifesto page as the coherence anchor (the plan's standing gate: no screen looks like it came from a different product than the Manifesto). The design pass receives this document as its brief. Sweep 1's design-system discipline applies from the first screen, not as a later pass — the rebuild gets to be born coherent instead of swept into coherence.
