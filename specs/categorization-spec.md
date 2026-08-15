# categorization-spec.md
## The filing pipeline: sync, classification, transfers, refunds, escalation. Governs M5 and informs M4.
## Extracted from `base44/shared/transactions.ts` (all 1,469 lines), 14 August 2026.

Companion to `ledger-spec.md` (what the numbers mean) and `projection-spec.md` (forward-looking). This document is how a raw Plaid transaction becomes a filed one. Closes ledger-spec §10.

---

## 1. The pipeline, in order

Per sync, per Item:

1. **Pull** `/transactions/sync` with stored cursor, 500 per page, cursor persisted after every page
2. **Per added transaction:** clean merchant → inflow doctrine → auto-categorize → refund doctrine → resolve direction → create
3. **Per modified:** update in place; re-categorize only if `auto_filed` AND the PFC changed (user judgment survives Plaid revisions)
4. **Per removed:** flag `removed = true` (never delete)
5. **Pending → posted:** carry user edits forward, tombstone the pending twin
6. **Transfer detection** (§5) across the household
7. **Retroactive cleanup** (§8) — deterministic re-evaluation, zero LLM calls, before escalation
8. **LLM escalation** (§7) on what survives
9. **Question card authoring** for remaining queue groups, cached before the user ever opens the flow

Order matters and is doctrine: cleanup runs before escalation **so only genuinely ambiguous and material items ever reach the LLM** ("eliminates the LLM stampede"). Idempotency: a re-delivered added transaction updates in place, keyed on `plaid_transaction_id`.

**Sync coordination:** if a webhook marked the Item `queued` mid-sync, the follow-up runs immediately from the just-persisted cursor, then `idle`. Never left waiting for a sweep.

---

## 2. Classification precedence (the full hierarchy)

Highest to lowest. First to produce an answer wins:

1. **User rules** (`CategoryRule`, manual or learned). A rule that sets a category fully determines the result. A rule that matched but set no category applies its flags (`mark_transfer`, `mark_reimbursable`, `mark_deployment`, `mark_reviewed`) while category resolution continues down the chain.
2. **Merchant corrections** (the learned layer). Key: `normalizedMerchant|direction|accountType`, with wildcard fallback `normalizedMerchant||` for legacy corrections. Direction in the key prevents an outflow inheriting an inflow's classification.
3. **Merchant overrides** (§3): tax-prep, DMV — before PFC can misfile them.
4. **Plaid PFC mapping** — exact detailed match, then primary-prefix match (per ledger-spec §8).
5. **Merchant recurrence** — inherit the prior filing for this merchant when PFC fails.
6. **Ambiguous** → materiality gate → queue or auto-file uncategorized.

This is the filing hierarchy the brain spec extends: household-learned over global-learned over provider guess. The global (Keepers' guild) rung slots between 2 and 4 in the rebuild.

### Confidence doctrine, changed and important
**Plaid's confidence field is not gated on.** If the PFC maps to one of our categories, it files at any confidence level. A transaction is *ambiguous* only when its P&L line is genuinely undetermined (PFC maps to nothing, or `OTHER_OTHER`). The stored `confidence` field is bookkeeping, not a gate. The gate is mapped-or-not, then materiality.

**Never-queue list:** `LOAN_PAYMENTS_MORTGAGE_PAYMENT`, `LOAN_PAYMENTS_CAR_PAYMENT`, `LOAN_PAYMENTS_BNPL` always auto-file. Nobody needs to be asked whether the mortgage is the mortgage.

---

## 3. Merchant overrides (doctrine encoded as regex)

- **Tax prep** (TurboTax, H&R Block, CPA, …) → General services. Tax preparation is not a tax.
- **DMV / vehicle registration** → Transportation. Registration is a cost of owning a car.
- **Tax subcategory elevation**, when PFC lands on the Taxes line: EFTPS/estimated patterns → Estimated tax payments; IRS/state DOR/FTB → Income taxes; county collector/assessor/treasurer → Property taxes; else parent. **Survives the Taxes After Takehome move unchanged** — only the parent's `pl_line` changes.
- **Interest/dividend inflows** (intrst, interest, dividend, div, coupon) → auto-filed to **Interest earned** (subcategory of Other income, created on demand). Never queued.

---

## 4. The inflow doctrine, complete (with 14 August rulings applied)

Applied **before** auto-categorization, on negative amounts:

| Class | Result |
|---|---|
| `transfer` (per ledger-spec §7 table) | `is_transfer`, Internal transfer category, auto-filed |
| `unclassified` + **income evidence** (`payment_meta.payer` or counterparty `income_source`) | Filed to Other income, high confidence, no question |
| `unclassified`, below materiality floor | Counts as income, auto-filed, no question |
| `unclassified`, at or above floor | Counts as income, queued `unclassified_inflow` |
| PFC `INCOME` | Income |
| No doctrine applies | Falls through to auto-categorize |

**`resolveDirection` is the single source of truth for the stored direction**, applied last: transfer if `is_transfer`; income if the category's line is income; expense for all other categorized; uncategorized inflows → income (inclusion doctrine), outflows → expense. `unclassified` as a direction value is legacy and never set.

---

## 5. Transfer detection

Runs household-wide over the last 45 days each sync, skipping `user_reviewed` (answers are authoritative and survive syncs), splits, and existing transfers.

**Pair matching first.** A pair is: different accounts, opposite signs, amounts within `max($0.01, 0.5%)`, dates within **5 days**. Both sides marked `is_transfer` with a shared `transfer_pair_id` (sorted-id concatenation), silently — a matched pair never becomes a question.

**Single-sided Plaid transfer signals** (PFC primary in TRANSFER/TRANSFER_IN/TRANSFER_OUT/WITHDRAWAL/DEPOSIT), unmatched, cascade:
1. **Card-reference:** a 4-digit mask in the description matching a connected credit card → auto-filed transfer; `possible_deployment` if that card is `in_payoff_pool` and `revolving`
2. **Interest/dividend** → Income per §3
3. Below materiality floor → auto-filed, no question
4. Else queued: `possible_deployment` if the account is savings/investment/payoff-pool card, otherwise `possible_transfer`

**The standing test, verbatim doctrine:** *queue only what a competent human bookkeeper would genuinely need to ask the client. If the data already contains the answer, use it.*

**Invariant:** `is_transfer` is set only by a matched pair, a card-reference, a rule, or a user answer — never by an unresolved queue item. Queued possible-transfers carry no Transfer-line category while unresolved (three cleanup passes enforce this against historical drift; the rebuild makes it an invariant instead).

**Rebuild note:** pairing is O(n²) over 45 days of candidates and pure JS. In Postgres this is a self-join with the same tolerances. Keep the exact tolerances; they are tuned.

---

## 6. The refund doctrine (Guy's 14 August ruling, already implemented)

An inflow whose category resolves to a **spending line** is a refund, not income:
- `direction = expense`, books as negative spending, netting the category in the month the refund lands
- **Prior-purchase match:** same normalized merchant, expense, `amount >= refund`, within **120 days** → refund inherits that transaction's exact category and subcategory
- **Uncategorized inflow rescue:** even when PFC maps to nothing, a matching prior purchase reveals the spending category — filed as a refund, auto-filed, dequeued

Gaps vs. the ruling, for the rebuild:
- `PLAID_PFC_TO_LINE` maps `REFUND → income`; the doctrine overrides it in practice, but the dead mapping is a trap. **Change to spending-side handling in the port.**
- No `refund_pair_id` — the match informs the category but the link isn't stored. The rebuild stores the pair (mirroring `reimbursement_pair_id`) so the drill-down can show "refund of the June 3 purchase."
- Gifts (income per ruling) arrive via the question machinery, not detection — consistent with meanings-are-asked.

---

## 7. LLM escalation (M3.5's mechanics, model routing per plan v3)

Post-sync, on `needs_review` items. Entitlement-gated. **Caps: 15 LLM calls per run, one call per merchant per run, one adjudication per pattern ever (cached).**

- **`ambiguous`** → `categorize` task. High-confidence result: auto-file + mint an `llm`-source MerchantCorrection (the merchant never hits the LLM again). Medium/low: category set, stays queued for the question card. Failure: falls back to deterministic, stays queued.
- **`possible_transfer` / `possible_deployment`** → `adjudicate` task, keyed on `merchant|direction|accountType`, result cached in `LlmCache` to power the question card. The LLM **informs the question; it never resolves a transfer** — only a pair, a card-reference, or the household does.
- `PENDING_CLAIM` (another worker holds the 5-minute claim) → skip, no error.

The cache-first, cap-hard, deterministic-fallback structure is the cost model. Rebuild keeps all three; Haiku takes `categorize`/`adjudicate` per the routing table.

---

## 8. Retroactive cleanup

Every sync, re-evaluates all transactions against current rules, corrections, doctrine, and the recomputed floor. **Zero LLM calls, verified** — LlmCallLog count is asserted unchanged before/after. Never touches `user_reviewed` or paired transfers. Applies inflow doctrine, stored-income-evidence filing, materiality re-gating (floor moves as history grows), refund matching, direction realignment. Bulk-updates in chunks of 100.

This is how a rule change or a learned correction reaches history without a stampede: the deterministic layer re-files everything it can, and the queue shrinks monotonically.

**Rebuild:** becomes a set-based SQL pass rather than a 5,000-row fetch-and-loop (same scale ceiling as ledger-spec §12).

---

## 9. The materiality floor (closes ledger-spec §10)

**0.5% of average monthly income, clamped $25–$250** — confirms the brain spec's number exactly.

Income base: affirmatively identified income only — `direction=income`, not transfer, not reimbursable, not removed, **and `review_state != needs_review`**. Unresolved inflows count on the MarginSheet but never inflate the floor: the inclusion doctrine's one deliberate carve-out, and it's correct (a floor inflated by unresolved deposits would suppress the very questions that resolve them). Months = date span / 30, min 1. No income history → $25.

Applied to: ambiguous items, unclassified inflows, single-sided transfer signals. **Never applied to:** pair matching, card-references, never-queue PFCs, commitments (projection-spec §6).

---

## 10. Pending → posted

Posted arrives with `pending_transaction_id` → carry forward category, subcategory, notes, `is_transfer`, `is_reimbursable`, and any non-`auto_filed` review_state from the pending twin; tombstone the pending (`removed`). User edits to a pending transaction survive posting. Never show both.

---

## 11. Merchant identity (three distinct operations — keep them distinct)

1. **Display cleaning** (`cleanMerchantName`): stacked processor prefixes stripped (SP, AplPay, FRG*, TST*, SQ*, …), phone numbers, store numbers, long digit runs, trailing city/state, symbol runs; title-cased. Only when Plaid provides no cleaned name.
2. **Correction keying** (`normalizeMerchantName`): lowercase, business suffixes stripped, punctuation stripped. Deliberately conservative — anything looser risks absorbing unrelated merchants, so it stays a question instead.
3. **History keying**: plain lowercase of display name — *inconsistent with (2)*, meaning recurrence-inheritance and refund matching can miss what correction matching hits. **Rebuild: one normalized key everywhere.**

---

## 12. Invariants for the M5 test suite

1. `user_reviewed` is never modified by any automated pass.
2. `is_transfer` only via pair, card-reference, rule, or answer.
3. Retroactive cleanup makes zero LLM calls (asserted, not assumed).
4. An LLM merchant/pattern result is computed at most once per household (cache hit thereafter).
5. Unresolved queue items never carry a Transfer-line category.
6. Refund netting never books an inflow to a spending line as income.
7. The floor's income base excludes unresolved inflows.
8. Pending edits survive posting; pending twins never render alongside posted.
9. Re-delivered `added` events update in place (idempotency on `plaid_transaction_id`).
10. A new institution connecting never re-flags merchants the household already answered (history is household-scoped, not Item-scoped).

---

## 13. What M5 adds that Base44 lacks (from the brain spec)

Banded learned records for opaque deposit merchants (deposit clustering exists in `depositClusters.ts`; the *minted rule* isn't banded), the calibration table (per-band guess-match, 95% graduation, double-fault demotion), file-and-disclose as a distinct tier, known_context as a filing input, the merchant lookup tool, and the Keepers' guild rung in the hierarchy. Everything else in this document is port, not design.

## 14. Amendment (14 August, evening): the `correct_transaction` intent

An unprompted member text like "that Publix purchase around 450 was for a prescription, not groceries" is a **transaction-scoped correction**, distinct from every bounded-answer type, and the mixed-reply extraction gains it as a named intent:

1. **Locate via ledger query:** merchant + approximate amount (± tolerance) + implied recency resolves against the books. Two or more candidates → one clarifying message naming both, never a silent pick. Zero candidates → say so plainly.
2. **Scope is transaction, not merchant:** the filing changes, `review_state = user_reviewed` (untouchable to every automated pass, existing invariant), and **no merchant correction mints.** Publix stays groceries by default. Over-learning from a one-off is the quiet failure this intent exists to prevent.
3. **One optional follow-up, materiality permitting:** offer the watch ("want me to ask when a Publix charge looks pharmacy-sized?") — a yes mints a rule or disclosure preference through conversation; a non-reply changes nothing, the correction already landed.
4. The in-app recategorize action carries the identical scope choice ("just this one" / "always") with just-this-one as default — one distinction, both doors (app-ui §3).
5. **Canon candidate:** this exchange belongs in the fixture library; flag for the conversational spec's next amendment pass.
