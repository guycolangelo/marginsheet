# 4.6, the accessor, and 4.7 with its neighbour

Drafted 21 Aug 2026 for Guy's approval. Nothing starts without it.

Three of the four pieces below follow from rulings already made today. The
fourth needs a decision that is Guy's rather than mine, and it is stated as a
decision rather than buried as a step.

## Sequencing, and why it is not the obvious order

**The accessor comes before 4.6, because 4.6 is the accessor's first consumer.**
Reconciliation is the one thing permitted to read credit `current`, and its
arithmetic is exactly where a type-blind read produces a sign error that reads
as a sync fault. Building 4.6 first means writing the code the rule forbids and
then unwinding it.

**4.7's neighbour ships with 4.7 rather than before it.** The liabilities writer
is a Plaid fetch and an upsert, which is 4.7's shape, and it has no dependency
on the recurring work in either direction.

---

## Piece 0: the balance accessor (approved as scoped)

**Reach, not wording, enforced at the type level.**

Two mechanisms, because one cannot cover both halves and saying so is part of
the design rather than an apology for it.

**The type half.** A module exporting accessors and never the row.

```
cashPosition(accounts)         -> depository current, summed
forReconciliation(account)     -> credit current, one account
committedOutflow(liability)    -> last_statement_balance with its due date
```

No accessor exists for `available_balance` on either type, and none for
`credit_limit`. **A consumer that wants one has to add it, which is a diff
somebody reviews**, rather than reading a column that was already in scope.

`forReconciliation` returns a **branded** type, so a value drawn for
reconciliation cannot be passed where a cash figure is expected. That is the
rung above a runtime check and it costs nothing to keep.

**The scan half, because SQL is a string and no type reaches inside it.** A
control in the shape of `every-write-declares-a-household`: **any file naming
`current_balance`, `available_balance`, `credit_limit` or `last_statement_balance`
outside the accessor module and the sync's writers is a failure.** Writers are
exempt by an explicit allowlist, not by a pattern, so a new reader cannot be
added by resembling a writer.

**Planted mutation** (plausible and wrong, never obviously broken): add a second
`select fa.current_balance` to a route that already legitimately joins
`financial_accounts`. It type-checks, it reads as a reasonable extension of an
existing query, and the scan must redden on it.

**What this does not do.** It does not stop a consumer misreading a value it is
entitled to. `forReconciliation` returning credit `current` to something that
then subtracts it as though it were cash is a defect the brand catches and a
plain number would not, which is the argument for the brand.

## Piece 1: 4.6, reconciliation that blocks

As already scoped, with two additions from today.

**Renumber `0032_balance_reconciliations` to `0034`.** Two migrations claim
0032 across two branches. The check added in #144 catches it on rebase, so this
is a note about what will go red rather than a thing to remember.

**The sign inversion is type-aware through the accessor**, not through a local
ternary. Depository spending decreases `current`; credit spending increases it.
A reconciliation that subtracts before knowing the type reports permanent drift
on every card, **and the drift looks like a sync fault rather than a sign
error**, which is what makes it expensive rather than merely wrong.

**Pre-commitment, written before the first run.** N=3 syncs, at least 6 hours
apart. If reconciliation is clean on all three, the invariant blocks from then
on. If any card shows drift, **the first question is the sign and not the
data**, because a sign error and a missing transaction both present as a
constant offset, and only one of them changes with the next transaction.

## Piece 2: 4.7, recurring to `commitments`

Unchanged from its existing scope.

## Piece 3: 4.7's neighbour, the liabilities writer

**Cash Flow's only committed-outflow input has a consumer, a grant, a declared
consent and no writer.** Nothing calls `/liabilities/get`.

Everything except the fetch already exists: `liability_details` since 0002,
`marginsheet_sync` grants since 0023, `liabilities` declared in
`config/plaid-consent.json` as an additionally-consented product. **That is why
it was invisible: every check around it passes.**

**The work.** A `/liabilities/get` call on the sync path, an upsert into
`liability_details` keyed on `(household_id, account_id)`, and `fetched_at`
written on every path the handler reaches deliberately, for the reason
`processed_at` is written that way.

**The control that matters is not "does the fetch succeed".** It is that **a
household with a connected card has a non-null `last_statement_balance` and
`next_payment_due_date`**, because the failure mode here is the one this
codebase keeps finding: an empty result that is a legitimate business answer.
A household with no cards genuinely has no committed outflow, so **the control
asserts the pair for a household that has one**, or it cannot fail.

**Not in scope:** rendering. What Cash Flow does with the pair is M6b.

---

## The decision that is Guy's

**What may `direction` hold for a card credit, given the pipeline cannot tell a
payment from a refund?**

`transaction_direction` is `(income, expense, transfer)`, NOT NULL since 0003.
`directionOf` returns two of the three and can never return `transfer`.

Three shapes, with what each costs:

**A. Write `transfer` for every card credit.** Correct for payments, which are
the overwhelming majority, and wrong for refunds, which M5 re-files anyway.
Cheapest, and it puts a wrong value in the ledger deliberately.

**B. Add a fourth value, `undetermined`, and write it for card credits.**
Honest: the pipeline says what it knows and nothing more, which is the doctrine
`apply-streams.ts` already states and then exempts itself from. Costs a
migration and forces every future reader to handle a fourth case, **which is the
point rather than a drawback**, since a reader that ignores it is a reader
making a filing decision.

**C. Make the column nullable and let M5 fill it.** Same honesty as B with less
type pressure, and it merges "not yet filed" with "no value", which this
codebase has a finding about.

**My recommendation is B.** It is the only one where a consumer cannot silently
inherit a guess, and the migration is cheap now and expensive after M5 reads the
column.

**And a second decision, separable from the first: repair the stored rows, or
leave them?** The ledger is small now. Nothing reads `direction`, so no
household has seen a wrong figure, and every sync until the fix writes more.
**Whether a repair can write `transfer` safely depends on the sign question that
Sandbox could not answer**, which is a production read of Chase's rows and needs
Guy's authorisation.
