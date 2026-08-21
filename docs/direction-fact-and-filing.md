# Should `direction` be replaced rather than corrected?

Answering Guy's question of 21 Aug 2026 before the repair, because the answer
changes what the repair is.

**Recommendation: replace, and it is cheaper than it looks, because replacing
does not remove `direction`. It demotes it.**

## Why `undetermined` alone is not enough, which is Guy's point sharpened

`undetermined` on the 56 card credits would make the column **more** misleading
rather than less. It implies the other 1,872 rows are filed correctly.

They are not. **520 depository inflows are largely internal SoFi vault moves**,
"From Joint Savings", "From Entertainment Vault", filed as income, every one
inflating income and none of it income. Some of the 1,042 depository outflows
are card payments, filed as spending.

So a curated-looking column, marked precisely in the 56 places we happened to
look, wrong in 500+ places it does not flag. **A column that looks reviewed is
worse than one that looks raw**, which is the same rule as showing a zero we
cannot substantiate.

## The actual defect, in one sentence

**The enum conflates a fact with a filing.** Which way the money moved is a fact
M4 holds. Whether that is income, expense or transfer is a filing decision
needing context M4 does not have: **a deposit from ADP and a deposit from Joint
Savings are the same fact and different filings.**

The schema already knows this and says so. `commitment_direction` is
`(inflow, outflow)`, a fact-shaped column, and migration 0004's comment warns
that it is "NOT transaction_direction, which is income, expense, or transfer"
and that the pair is "a real trap". **The trap exists precisely because one is a
fact and the other is a filing while both are called direction.**

## The shape

| Column | Values | Written by | Meaning |
|---|---|---|---|
| `transactions.flow` (new, NOT NULL) | `inflow` / `outflow` | **M4** | money in or money out. A fact, always knowable at sync. |
| `transactions.direction` (nullable) | income / expense / transfer / undetermined | **M5** | the filing. NULL until filed. |

**`direction` is not deleted and its semantics do not change.** Everything the
specs say about `resolveDirection` stays true, and becomes true for the first
time: it was claimed as the single source of truth from 0004 and M4 wrote the
column anyway.

**`undetermined` survives with a changed owner.** It stops being M4's excuse and
becomes M5's honest output for a card credit it genuinely cannot resolve into
payment or refund. Migration 0034 is not wasted.

## What it costs

**The repair becomes total and mechanical instead of partial and interpretive.**
`direction` was a pure function of Plaid's sign, so the backfill is exact with no
judgement anywhere: `expense` means Plaid sent positive means `outflow`, and
`income` means negative means `inflow`. 1,928 rows, one statement. Then
`direction` is nulled, because nothing has filed anything yet and NULL is the
truthful value for that.

Compare the alternative: 56 rows changed by hand-reasoning about which ones we
noticed, leaving 500+ known-wrong rows silently asserting a filing.

**Nothing reads `transactions.direction` today.** The only reader in the
repository is the readout diagnostic written this morning. **This is the
cheapest this change will ever be**, and the price rises sharply the moment M5
writes the column and M6a reads it, at which point it is a coordinated migration
across three modules instead of one.

**Concretely:**

- one migration: `money_flow` enum, `flow` column, backfill, drop NOT NULL on
  `direction`, null it, comments on both
- `apply-streams.ts`: write `flow`, stop writing `direction`
- two enum tests, and the readout's `stored_direction` reporting
- `config/single-writer-columns.json`: `transactions.direction` moves to zero
  declared writers, which the control must be taught to express as a legitimate
  state rather than a scan failure
- a spec amendment naming the new column in `data-model-spec` and the ownership
  split in `ledger-spec` and `categorization-spec`

**The 37 spec mentions across 8 files are not 37 edits.** Most describe the
filing semantics, which survive untouched. What changes is who writes it and
when.

## Two things I am flagging rather than deciding

**The indexes.** `transactions_merchant_key_idx` is
`(household, merchant_key, direction)` and exists for correction matching,
recurrence inheritance and refund matching. **All three plausibly want the fact
rather than the filing**: a refund is an inflow matching a prior outflow at the
same merchant, and a household's correction of "Amazon" applies to purchases
rather than to refunds. So the index probably wants `flow`. That is M5's design
and changing it here would be scope, so it is named and left.

**The type.** `flow` could reuse `commitment_direction`, since the two would
then mean the identical thing, which would **dissolve** 0004's trap rather than
double it. Against that: a type named `commitment_direction` on `transactions`
reads badly. I recommend a new `money_flow` and note that folding the two
together later is a real option nobody should discover by accident.

## The objection worth stating

**This is a schema change to the ledger's core table during M4, and M4 must
close before M5 opens.** It looks like M5 scope leaking backwards.

**It is the opposite.** M4 currently does M5's job with a third of the
information. Removing that is M4 finishing its own job rather than starting the
next one, and the column it leaves behind is a fact M4 is entitled to write.
