# ledger-spec.md
## The MarginSheet P&L engine. Governs M6.
## Extracted from Base44 14 August 2026. Status: draft, gaps marked.

Source: `base44/functions/get-marginsheet/entry.ts`, `base44/shared/categories.ts`, `base44/shared/transactions.ts`, `base44/shared/depositClusters.ts`, `base44/shared/queueGrouping.ts`.

---

## 1. The verdict

```
Kept   = Income − Spending
Margin = Kept / Income        (rendered as %)
```

Negative Kept renders as **Overspent**, with Margin in parentheses.

**Naming correction for the rebuild.** Base44's code calls the dollar result `margin` and the percentage `margin_rate`. The locked product vocabulary is `Kept` for dollars and `Margin` for the percentage. The rebuild must rename: `kept` and `margin_pct`. This is the exact confusion the vocabulary was locked to prevent, and it currently lives in the variable names.

**Margin guard.** Margin is computed only when `income > 0` and `|kept / income| <= 10`. Otherwise null. A ratio beyond 1000% is nonsensical for a monthly household P&L and renders as absent rather than absurd.

---

## 2. P&L lines

Eight lines total, of which five are spending. **Four after the Taxes decision.**

| Line | Type | Post-decision |
|---|---|---|
| `income` | Income | unchanged |
| `fixed_obligations` | Spending | absorbs taxes |
| `variable_operating` | Spending | unchanged |
| `discretionary` | Spending | unchanged |
| `interest_fees` | Spending | unchanged |
| ~~`taxes`~~ | ~~Spending~~ | **removed as a line** |
| `transfer` | Neither | unchanged |
| `deployment` | Below the line | unchanged |

**Transfer and deployment are neither income nor spending.** Deployment sits below the Kept line.

### The Taxes change, in full

`taxes` is not one category. It is a parent plus four children, all of which move:

| Category | Old `pl_line` | New `pl_line` | New name |
|---|---|---|---|
| Taxes | taxes | **fixed_obligations** | **Taxes After Takehome** |
| Property taxes | taxes | fixed_obligations | unchanged |
| Income taxes | taxes | fixed_obligations | unchanged |
| Estimated tax payments | taxes | fixed_obligations | unchanged |
| Other local & county taxes | taxes | fixed_obligations | unchanged |

Existing doctrine that survives the move, from the category tree comment:
- Taxes means compulsory remittances to a taxing authority.
- Tax preparation (TurboTax, CPAs) is **not** taxes. It routes to General services by merchant override.
- Vehicle registration (DMV) is **not** taxes. It routes to Transportation by merchant override.
- **Tax refunds book as negative taxes**, which now means a negative can appear inside Fixed obligations. Confirm this is intended.

**Open:** does the child tree survive, so the sheet reads "Fixed obligations → Taxes After Takehome → Property taxes"? Recommendation: yes.

---

## 3. Exclusions

### Excluded from everything
- `removed = true` (Plaid reported the transaction removed)
- `split_parent_id` is set (split children; the parts count under the parent)

### Excluded from spending
- `is_transfer = true`
- `is_reimbursable = true` (household AR, a receivable and not a cost)

### Excluded from income
- `is_transfer = true`
- `reimbursement_pair_id` set **and** `direction = "income"` (the matched reimbursement deposit; excluding it prevents the reimbursement counting as income after the expense was already excluded)

### Reimbursables surface separately
`awaiting_reimbursement` sums all open reimbursables **across all months**, not just the month being viewed, with an itemized list carrying merchant, amount, date, account name and mask. This is household AR rendered on the P&L page without entering the P&L.

---

## 4. Income by source

Income groups by **payer**, not by category. The payer is already in the data, so no household setup is required.

**Inclusion test.** A transaction counts as income if either:
- its category has `pl_line = "income"`, or
- it has no category and `direction = "income"`

**Grouping.** By `merchant_name` (fallback `name`), lowercased and trimmed as the key. `SourceRename` supplies display names, matched on the same lowercased key.

**Subline selection.**
1. Uncategorized income always gets its own subline, exempt from the top-N rule, carrying a pending count.
2. Categorized sources sort by amount descending.
3. The top 5 qualify only if **recurring** (more than one occurrence across all history) **or** **material** (amount at or above the materiality floor).
4. Everything else rolls into "Other income".

The recurrence check runs across the household's entire history, not the month. A one-off payer does not earn a named line in a month where it happened to be large.

**Drill filters.** Every subline carries a `drill_filter` object with merchants, direction, and date range. This is the site's "every line opens" promise, already built.

---

## 5. The transparency block

Undocumented anywhere outside the code, and it is significant enough to be doctrine.

Because unconfirmed inflows count as income (see §7), Kept and Margin are both inflated by anything that later turns out to be a transfer. The engine states that error direction explicitly rather than hiding it:

| Field | Meaning |
|---|---|
| `uncategorized_inflow_total` | The exposure |
| `margin_if_transfers` | Kept if every uncategorized inflow were a transfer |
| `margin_rate_if_transfers` | Margin under the same assumption |
| `unresolved_count` | Transactions in `needs_review` this month |
| `potential_shift` | Absolute sum of unresolved amounts |
| `has_provisional` | Any provisionally booked items |
| `has_pending` | Any pending items |

This is the mechanical form of the inclusion doctrine: count it, label it, and show which way it can move. It is also the household's reason to answer questions, stated in arithmetic rather than in a nag.

**Carry this into the rebuild unchanged.** It should also be a field in the fact package, because the brain composing a close needs to know when a number is soft.

---

## 6. Deployment attribution

Deployment sits below Kept. `undeployed_kept = kept − deployment_total`.

**Entry condition:** `is_transfer AND possible_deployment AND amount > 0`.

**Destination kinds:**
- Debt: `credit_card`, `loan`, `external_debt`
- Savings: `investment`, `savings`, `external_savings_investment`

**Resolution cascade, in order:**
1. `destination` JSON with a kind in the debt or savings sets
2. `destination.kind = "connected_account"`, resolved through the account's type or subtype
3. **Card mask extraction**: any 4-digit run in the transaction name or merchant, matched against connected credit card masks
4. **Transfer pair**: look at the other side's account type
5. **Category name heuristic**: contains "credit card" or "card payment" → debt; "savings" or "invest" → savings
6. **Final fallback**: debt, labelled "destination not specified"

Rung 6 matters. A `possible_deployment` transaction always appears, even unattributed, rather than silently vanishing from the sheet.

---

## 7. The inflow doctrine, and a contradiction to resolve

Two comments in the codebase disagree, and the spec must pick one.

**`transactions.ts` says:** an inflow counts as income only when affirmatively identified. Unplaced inflows are not income; they are transfers or unclassified, and are excluded from income until resolved.

**The `Transaction.direction` schema says:** unconfirmed inflows count as income while awaiting review. They are labelled, never hidden. `unclassified` is legacy and no longer set.

**`get-marginsheet` sides with the schema.** It counts uncategorized `direction = "income"` transactions in the income total and then discloses the exposure through the transparency block.

**Ruling for the spec:** the schema and the P&L code are correct, and the `transactions.ts` header comment is stale. Unconfirmed inflows count, get flagged with `queue_reason = "unclassified_inflow"`, and the transparency block carries the counterfactual. **Confirm this.**

### The classification rules that do apply

`classifyInflow` runs on negative amounts only:

| Signal | Verdict |
|---|---|
| Name matches `^(from\|to)\s+\S+` | transfer, **overrides PFC** |
| `TRANSFER_IN_ACCOUNT_TRANSFER` | transfer, always |
| `TRANSFER_IN_DEPOSIT`, `TRANSFER_IN_OTHER_TRANSFER_IN`, `TRANSFER_IN_TRANSFER_IN_FROM_APPS` | unclassified inflow, queued |
| PFC primary `INCOME` | income |
| Other `TRANSFER_IN_*` (savings, investment, cash advances) | transfer |
| No rule matches | falls through to auto-categorization |

**Affirmative income evidence.** Plaid's `payment_meta.payer` or a counterparty typed `income_source` is strong enough evidence to file a deposit as income without asking.

---

## 8. Category resolution

Three tiers, in order:
1. Exact match on the Plaid PFC detailed value against a category's `plaid_pfc_mappings`
2. Match by PFC primary prefix
3. Fallback to the `PLAID_PFC_TO_LINE` map, yielding a line but no category

**Confidence mapping:** Plaid `VERY_HIGH` or `HIGH` → high; `MEDIUM` → medium; everything else → low.

**Merchant normalization for learned records:** lowercase, strip business suffixes (inc, llc, corp, co, ltd, llp, pllc, pc, pa, dba, corporation, company, limited), strip punctuation, collapse whitespace. Deliberately conservative, so learning survives naming drift without absorbing unrelated merchants.

**Merchant display cleaning** is separate and more aggressive: strips stacked payment-processor prefixes, phone numbers, long digit runs, store numbers, trailing city and state, then title-cases.

---

## 9. Question clustering

I previously reported this as missing. It exists.

**Categorical questions** (`queue_reason = "ambiguous"`) group by merchant and direction only, ignoring amount. Seven Lowe's at seven amounts is one question.

**Transfer and deployment questions** group by merchant, direction, and rounded absolute amount, because the amount is part of what is being asked.

**Unclassified inflows** use deposit clustering:
- Group by merchant and account
- Within each group, sort by absolute amount and start a new cluster when the next amount exceeds twice the current cluster's max
- Cadence from mean date spacing: monthly 27 to 33 days, biweekly 13 to 15, weekly 6 to 8, otherwise irregular
- A singleton inside a multi-item group is flagged an outlier

This is the brain spec's amount banding for opaque deposit merchants, already built.

**Drift to fix:** `CATEGORICAL_REASONS` contains only `"ambiguous"`, which does not appear in the `queue_reason` schema enum (`possible_transfer`, `possible_deployment`, `low_confidence`, `first_seen_merchant`, `anomaly`, `unclassified_inflow`). Either the enum is stale or categorical grouping never fires. **Verify against production data before porting.**

---

## 10. Gaps: not yet extracted

Still inside `transactions.ts` (1,469 lines, 130 read):

- `computeMaterialityFloor` implementation. The brain spec states 0.5% of average monthly income clamped $25 to $250; confirm the code agrees.
- Transfer pairing algorithm. How `transfer_pair_id` is assigned, the matching window, the amount tolerance.
- Refund netting. The site promises a refund nets against original spending, and `PLAID_PFC_TO_LINE` maps `REFUND` to income, so an override must exist.
- The full auto-categorization cascade and where the learned-record hierarchy is applied.
- Pending to posted transition handling.

---

## 11. The largest gap: there is no projection

`get-marginsheet` computes **actuals only** for the requested month. It returns `is_current_month` as a flag and nothing else forward-looking.

There is no expected income, no committed spending, no cadence model, and no commitments discovered from history.

The site sells the opposite on two pages: "This month, projected: what is committed, what is likely, and where you are heading while there is still time to steer," with an August projected column rendered in full detail. The homepage hero demo is a projected month.

**The projected MarginSheet does not exist.** It is the half of the product that MyCFO depends on, that the watcher's can't-cover rule depends on, and that the brain spec assumes when it refers to "the Margin Plan engine's outputs."

This changes the M6 estimate materially. M6 is not a port. It is a port plus a new engine.

---

## 12. Scale note

`get-marginsheet` fetches transactions with a hard limit of 5,000 and filters in memory. A household with two years across nine accounts can exceed that, and the failure is silent: the earliest transactions simply vanish from `available_months` and any month they belonged to.

The rebuild should aggregate in SQL rather than fetch and filter.

---

## 13. Access gate

`trialing`, `active`, and `past_due` may read the MarginSheet. `canceled` and `expired` receive 403.
