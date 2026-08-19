# The cross-household write path: plan

**Status: DRAFT FOR GUY'S APPROVAL. Nothing here is built.**

Raised 19 August 2026. Two findings confirmed against a real database, a third
of the same shape unproven, and a root cause that is none of them.

---

## 1. The root cause is authorization, not collision

**Lead with this, because "fix the indexes" is the plausible answer somebody
will reach for later and it does not close the hole.**

Migration 0008 gives the sync role this on every table it can reach:

```sql
CREATE POLICY "sync_worker_access" ON "plaid_items" FOR ALL TO marginsheet_sync
  USING (true) WITH CHECK (true);
```

**`marginsheet_sync` is unconstrained by row-level security by design.** It sees
and writes every household's rows. So `set_config('marginsheet.household_id', ...)`
inside `exchange.ts` **constrains nothing for the role that executes it**. It is
read by policies attached to `marginsheet_app` and by nothing on this path.

That is why the confirmed writes succeeded **with no error at all**: there was
never a policy in the way. The evidence recorded it as `threw=nothing`, and that
was the mechanism rather than an oddity of `ON CONFLICT`.

**What this does to the obvious fix.** Making the unique indexes composite with
`household_id` stops the *collision*. It does not stop the *write*. A sync run
would simply insert a second row for the other household rather than updating
theirs, and every existing statement that names a Plaid id without a household
predicate stays able to reach across the boundary. **A composite key answers a
question nobody asked.**

**Why the policy is written that way, stated fairly.** The sync Worker legitimately
acts for many households in one process: a webhook batch, a cron sweep, an outbox
drain. A per-session GUC does not obviously fit work that is inherently
multi-household, and `USING (true)` is the honest expression of "this role serves
all households" rather than an oversight. The question this plan must answer is
not "who was careless" but **what constrains a component that legitimately spans
households**, given that RLS is the mechanism the rest of the system leans on.

**The blast radius is bounded by grants, not by policy.** Migrations 0023 and 0024
narrow the role to nine tables: `plaid_items`, `institutions`, `financial_accounts`,
`account_balance_snapshots`, `liability_details`, `transactions`, `provider_events`,
`commitments`, `household_state_signals`, plus read-only `schema_migrations`. The
policy is unconstrained on 36 tables; the role can only reach ten. **The grant is
doing the work the policy is not**, which is worth stating plainly because it means
the enumerated-grant discipline is currently the only boundary on this path.

### Is this pattern anywhere else?

**Checked, and no.** Every `USING (true)` policy in the schema belongs to
`marginsheet_sync` under the single name `sync_worker_access`: 36 occurrences, one
role, one policy name. No other role has a policy that is nominally present and
actually unconstrained. `marginsheet_app` carries the real
`household_isolation` predicate everywhere it appears.

---

## 2. What is proven, and what is not

| Table | Index | State |
|---|---|---|
| `plaid_items` | `item_id`, global unique | **CONFIRMED.** A wrote, B's `access_token_ciphertext` was replaced, `threw=nothing` |
| `financial_accounts` | `plaid_account_id`, global unique | **CONFIRMED.** A wrote, B's account was renamed and re-pointed, `threw=nothing` |
| `transactions` | `plaid_transaction_id`, global unique | **CONFIRMED (4a, 19 Aug).** A wrote, B's transaction was rewritten, `threw=nothing` |
| `transactions` | `applyRemoved`, no unique index involved | **CONFIRMED (4a, 19 Aug).** A flagged B's transaction `removed`, `threw=nothing` |

Both confirmations read `current_setting` back inside the transaction and asserted
the writer was A before drawing any conclusion, because the same assertion failure
is produced by an unrestored planted mutation.

**Task 4a is complete and both paths confirm.** It ran first because
`"same shape, untested"` is the exact state that produced two vacuous tests this
week, and the caution was warranted in an unexpected direction: the table behaves
as the other two do, **and it carries a second path that is worse than any of
them.**

**`applyRemoved` is the most serious of the four findings.** The other three
corrupt a CONNECTION. This one writes to the LEDGER:

```sql
update transactions
   set removed = true, updated_at = now()
 where plaid_transaction_id = any(${plaidTransactionIds})
```

`applyRemoved` carries **no household predicate**. Under `USING (true)` nothing
else scopes it, and the test confirmed it end to end:

```
household A flagged household B's transaction as removed. threw=nothing.
```

**`removed` decides what a household is told they spent.** So this is wrong data
in a close, arriving through an ordinary removed-stream batch, with no error
anywhere. Not a broken connection somebody eventually notices.

### Two fixture failures preceded the verdict, and neither was a result

Recorded because the second is a lesson about this task specifically.

**A test-ordering dependency.** The harness runs one test by name (`vitest -t`),
so tests reading rows an earlier test created got `undefined` and reported a
TypeError. **A control that only passes when its neighbours ran is a control
nobody can run alone.** Every fixture is now built inside the test that needs it.

**An invented enum value.** `'outflow'` was written as a `transaction_direction`
when the enum is `('income', 'expense', 'transfer')`. **Inventing a plausible
value rather than reading the schema is the same move as inferring behaviour from
shape, one layer down** — and it happened inside the task that existed
specifically to replace shape-matching with evidence.

Both runs failed before reaching any assertion. **Reported as non-verdicts rather
than results**: a red that never reached its assertions is not evidence.

---

## 3. Three cases, not one question

The first draft treated overlap as a single problem. It is three, **with
different fixes, different surfaces and different failure modes**, and the split
is what makes each one tractable (Guy, 19 August 2026).

**Cases 1 and 2 are within-household data quality. Case 3 is authorization.**
Only case 3 is a security finding, and only case 3 is what this plan was opened
for. The other two are recorded here because they share a symptom and would
otherwise be solved by the same wrong mechanism.

### Case 1: same login, same household. Refuse and say so.

The household connects a Chase login they already have. **Exact `item_id` match,
no heuristic anywhere.**

**CHECKED AGAINST THE CODE BEFORE DESIGNING ANYTHING, and it is already handled at
the data level.** The 4.3.3 spike established that Plaid is idempotent on a public
token: re-exchanging returns **the same `item_id` and the same access token**.
`exchange.ts` upserts on `item_id` and distinguishes insert from update with
`(xmax = 0)`, returning **`alreadyConnected`** without a second query. Two
exchanges produce one row, one Item at Plaid, and one billable connection.

**So there is no mechanism to build. The open question is only whether the
household is TOLD**, and today nothing tells them: `alreadyConnected` is consumed
by no surface, because the connect UI is M8's and does not exist. It is computed,
correct, and unread.

**Owed to M8**, as one sentence in the connect flow: *"You've already connected
this Chase login."* Not a new field, not a new check. A field that already exists
finding a reader.

### Case 2: different logins, overlapping account, same household

Two people in one household each have their own login at the same bank, and one
account is visible to both. A spouse who is an additional user on a card. Her
login should connect, the shared card should not be added twice, **and her
checking and savings should be added.**

**The duplicate is the ACCOUNT, not the login.** The login is entirely legitimate
and carries accounts nothing else can see.

**Matching is a heuristic, not an identity, and the plan must not pretend
otherwise.** `plaid_account_id` is issued **per Item**, so the same physical card
reached through two logins arrives with **two different ids**. Nothing in the
payload identifies the underlying account. What actually matches is **mask, plus
type, plus institution** — and two different cards ending 1234 at one bank is
uncommon rather than impossible.

Three consequences, and the first is the rule:

- **It tells the household rather than silently dropping.** *"The Visa ending 1234
  is already connected. We'll skip it and add your checking and savings."* A
  heuristic that acts silently is a heuristic that is wrong invisibly, and the
  household is the only party who can say *"no, that's a different card."*
- **It is per ACCOUNT at selection time, not per Item at exchange time.** One
  duplicate account among three is still a login worth connecting. A check that
  refuses the Item because one account overlaps throws away two good accounts.
- **That places it in Link's account picker, which is M8's surface**, not M4's.
  M4 owns the exchange; the decision happens before the exchange, on a list of
  accounts the household is looking at.

**Not a schema problem.** Two ids for one physical card inside one household do
not collide on any index. Skipping the duplicate is a product choice about what
the household should see, and the constraint work in this plan neither helps nor
hinders it.

**RULED 19 AUGUST 2026 (Guy): a skipped account is RECORDED as seen-and-skipped,
with which Item it was skipped in favour of.**

Because otherwise a household that connects a card through two logins and later
disconnects the first **silently loses the card, having done nothing wrong.** A
tidy list is not worth that.

**And that decides disconnect too, as the same decision rather than a follow-on.**
Disconnecting an Item must check whether anything it holds was the **winner** of a
skip, and offer the alternative rather than dropping the account. The record has
to name the winning Item for that to be answerable at all, which is why it is one
ruling and not two: a skip log that does not say what won cannot be read at
disconnect time.

### Case 3: same login, different households. The isolation failure.

**This is not deduplication at all.** Two households linking the same bank login
is the case this plan was opened for: it is where the confirmed cross-household
writes came from, and the households are strangers to each other by definition of
the boundary.

**Both households need their own Item, their own token and their own sync, and
neither may reach the other's rows.** This is where Option A applies, and where
the double-billing cost is paid.

#### Option A: two Items, one per household

Each household exchanges its own public token and holds its own Item and its own
access token. The unique index becomes `(household_id, item_id)`.

- **Ledger:** each household has a complete, independent copy of the shared
  account's transactions. Both are correct. Neither can see the other.
- **Plaid's bill:** **two billable Items for one bank login.** Plaid bills per Item
  per month on Transactions, so a shared account costs double for as long as both
  households keep it connected. At two founder households this is noise; at scale
  it is a line item that grows with exactly the customers who are most engaged.
- **What a household sees:** nothing unusual. Their connection is theirs, their
  balances are theirs, and disconnecting affects nobody else.
- **Failure mode:** none that is visible. The cost is invisible to the household
  and lands on us.

#### Option B: one Item, shared, boundary drawn elsewhere

The Item is stored once. Households reference it. The household boundary moves from
the connection to the rows derived from it.

- **Ledger:** one sync run, transactions fanned out to each referencing household,
  or a join at read time. Cheaper, and it introduces a **shared object with two
  owners**, which this schema has nowhere else.
- **Plaid's bill:** one Item, one charge. Correct by the shape of what is actually
  connected.
- **What a household sees:** a connection they did not create and cannot fully
  control. If household A disconnects, does B's data stop? If A's token needs
  reauth, who is asked? **A household can affect another household's ledger by
  acting on their own screen**, which is the thing this product's isolation
  doctrine exists to prevent.
- **Failure mode:** the reauth and disconnect flows become multi-household
  questions, and `household_isolation` stops being expressible as a predicate on a
  column for the connection tables.

#### Option C: refuse the second connection

The constraint stays global and a second household linking the same Item is told
the account is already connected elsewhere.

- Stated only to be rejected. It leaks the existence of another household to a
  stranger who guesses a bank login, and **it refuses a legitimate household for
  the convenience of our schema.** Same reasoning that rejected pre-checking
  global phone uniqueness inside a policy: an inconvenience to us is not a reason
  to refuse a household.

#### The ruling (case 3)

**Option A**, on the boundary argument rather than the cost one. **Approved by Guy, 19 August 2026.** Two Items is more
expensive and it keeps the household boundary exactly where every other rule in
this system assumes it is: a household's data is a household's, derived from a
connection they own. Option B is cheaper and moves an isolation boundary into a
shape no existing control can express, which is the kind of change that makes
every downstream control approximately right.

**RULED 19 AUGUST 2026: OPTION A.** Guy, on the boundary argument rather than
the cost one. Option B moves an isolation boundary into a shape no existing
control can express, and **a boundary nothing can check is one that erodes
silently.**

#### The double billing is accepted knowingly. Read this before optimising it.

**Two billable Plaid Items for one bank login is not waste. It is the price of
the household boundary**, and it was chosen with the cost in front of us.

Whoever finds this line later will find it the way costs are always found: as a
duplicate, on an invoice, with an obvious-looking fix. The fix is Option B above,
and the reason it was rejected is not that it is hard. It is that it puts one
Plaid Item under two households, which makes reauth and disconnect
multi-household questions and makes `household_isolation` inexpressible as a
predicate on a column for the connection tables. **One household would be able to
affect another household's ledger by acting on their own screen.**

**And the cost grows with exactly the customers who are most engaged**, because
the households most likely to share a login are couples and families running
their money together, which is this product's centre rather than its edge. So the
line gets more conspicuous as the product succeeds, and it will look worse at the
moment it is most worth paying.

If this is ever revisited, the thing to change is **not** which household owns the
Item. It is whether Plaid's billing shape can be addressed some other way, or
whether the boundary can be kept while the Item is shared. Anyone proposing the
latter is proposing Option B and should read this section as its rebuttal.

#### What Option A leaves unresolved, and it is owed rather than solved

**Two households syncing the same account means the same transaction appears in
two ledgers.** That is CORRECT for a joint account: both households genuinely
share that money, and neither ledger is wrong.

But it is **the first case in this system where one transaction is legitimate in
two places**, and nothing downstream has met it:

- **Categorisation (M5):** two households can file the same spend differently, and
  both filings are right. `source_renames` and `merchant_corrections` are
  household-scoped, so this works, but nothing has confirmed it.
- **Questions and the close (M10 to M13):** two households may ask about the same
  transaction and receive different answers, correctly. The composer has never
  been asked to hold that.
- **Kept and Margin:** the same dollar reduces two households' Margin. Correct,
  because both households really did have that money leave. It has never been
  stated out loud, and it will read as a double count to the first person who
  notices.

**Flagged as owed, not solved.** It is not a blocker for Option A, and it is not
something to improvise when it first appears in a real household's books.

---

## 4. Tasks, in order

- **4a. DONE, 19 Aug 2026.** Both `transactions` paths confirmed. Four findings
  total, and `applyRemoved` is the worst of them.
- **4b. DONE.** Option A ruled by Guy: two Items, one per household.
- **4e. NEXT, AND IT MOVED AHEAD OF 4c** (Guy, 19 Aug 2026). `applyRemoved` and
  every sibling get an explicit household predicate, independent of RLS.

  **Three reasons, and the first is the plan's own sentence turned on itself.** A
  statement should be correct even when the policy is wrong, **and the policy is
  wrong.** Second: it is a predicate on one statement whose failure is the worst
  of the four, so it is the smallest change against the largest harm. Third, and
  the ordering argument proper: **4c must not be verified against code that
  depends on it.** If `applyRemoved` is correct on its own terms first, landing
  4c tests whether the narrowing works. Landing 4c first tests only whether the
  narrowing is the one thing standing between us and a known-bad statement.
- **4c. Constrain the sync role.** Designed below and **awaiting a ruling**; the
  plan deferred the choice until 4a was known, and 4a changed it.
- **4d. The constraints**, per Option A: `(household_id, item_id)` and the
  siblings. Append-only migration.

---

## 5. What this plan does not decide

- Whether `provider_events`, `institutions`, `messages` and `stripe_subscriptions`
  should keep their global unique indexes. They are shared or provider-global by
  nature and are **not** in scope here; naming them is so the next reader does not
  assume they were missed.
- **Case 1's message and case 2's account-level dedup are M8's**, not this plan's.
  Case 1 needs no mechanism at all, only a reader for a field that already exists.
  Case 2 needs a heuristic that TELLS rather than drops, applied per account in
  Link's picker, and it carries its own open question about whether a skipped
  account is recorded so it can be re-offered. This plan states them so they are
  not solved here by the wrong mechanism, and hands them over intact.

---

## 6. Task 4c: constraining the sync role. DESIGN, AWAITING RULING.

### The shape the facts force

**The sync role must READ across households and WRITE within one.** That is not a
compromise, it is what the component does: the watchdog sweep scans every Item to
find stuck ones, the outbox drain looks for unclaimed signals, and neither can
name a household in advance. But **every write belongs to exactly one household**,
and all four confirmed findings were writes.

So the policy splits by command rather than being replaced:

```sql
-- reads: unchanged, because sweeps must find work they cannot name
CREATE POLICY "sync_worker_read" ON <table> FOR SELECT TO marginsheet_sync
  USING (true);

-- writes: only into the household this transaction has declared
CREATE POLICY "sync_worker_write" ON <table> FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid)
  WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);
```

**This would have refused all four findings**, because in each one the GUC named
household A and the row belonged to B.

### Three complications, none of them cosmetic

**1. Two of the four write paths do not set the GUC today.** `exchange.ts` and
`reconnect.ts` set it; `apply-streams.ts` and `outbox.ts` receive a `tx` from a
caller and never declare a household. Under the policy above those writes would be
**refused**, which is fail-closed and correct, and it means 4c is not only a
migration: **every write path must declare its household first, or the sync
Worker stops working.**

That is the real cost of 4c and it should be stated before it is chosen rather
than discovered during it.

**2. Three tables do not fit the predicate and each needs a decision.**

- **`institutions`** has no `household_id`. It is shared reference data, correctly
  global, and a household-scoped write policy on it is simply wrong. It needs a
  different rule, probably unchanged.
- **`households`** is keyed `id`, not `household_id`, so the predicate must be
  written against `id` for that table alone. `markFirstSyncCompleted` writes here.
- **`provider_events`** has a **nullable** `household_id`, by design: a webhook
  arrives before we know which household it concerns. A predicate that requires a
  match refuses the insert that identifies the household in the first place.

**A single policy body applied uniformly across the sync role's ten tables is
therefore wrong**, and writing it that way would produce a boundary that is
correct on seven tables and broken on three. Same lesson as 4e stopping where it
did.

**3. It cannot be verified against code that depends on it**, which is why 4e went
first. With `applyRemoved` correct on its own terms, landing this tests whether
the narrowing works. Landing it first would have tested only whether the narrowing
was the one thing standing between us and a known-bad statement.

### What this plan recommends

**Do it, in the order the complications force:**

- **4c-i.** Every sync write path declares its household, so the GUC is set on all
  of them. **No policy change yet.** Nothing behaves differently, and the change
  is reviewable on its own.
- **4c-ii.** The split policy, per table, with `institutions`, `households` and
  `provider_events` handled explicitly rather than swept into one body.
  Append-only migration.
- **4c-iii.** A negative control per shape: a write as household A against a
  household B row must be **refused**, on a table with `household_id`, on
  `households`, and on `provider_events` before and after its household is known.
  **Three shapes, because one refusal proves a boundary exists and three prove it
  is a boundary rather than a lucky predicate.**

**The alternative, stated so it is a decision:** leave `USING (true)` and rely on
explicit household predicates in every statement, as 4e did. That is genuinely
simpler and it is what the provider-key rule already requires. It fails the moment
somebody writes a statement without one, and **nothing would catch that** — which
is the argument for the policy: a predicate somebody forgets is a hole, a policy
somebody forgets is a refusal.

**Recommendation: both.** The predicates are correctness at the statement, the
policy is the backstop, and 4e already proved the statement-level rule can be got
right one at a time.
