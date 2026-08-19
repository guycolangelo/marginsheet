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
| `transactions` | `plaid_transaction_id`, global unique | **UNPROVEN. Same shape, and shape is not evidence** |

Both confirmations read `current_setting` back inside the transaction and asserted
the writer was A before drawing any conclusion, because the same assertion failure
is produced by an unrestored planted mutation.

**Task 1 of this plan is to prove or disprove the transactions case**, and it is
first because `"same shape, untested"` is the exact state that produced two
vacuous tests this week. It also has a second path that the other two do not:

```sql
update transactions
   set removed = true, updated_at = now()
 where plaid_transaction_id = any(${plaidTransactionIds})
```

`applyRemoved` carries **no household predicate**. Under `USING (true)` there is
nothing else scoping it. If a removed-stream batch ever names a transaction id
belonging to another household, that household's transaction is flagged removed.
**This is the worst of the three if it holds**, because `transactions` is where the
ledger lives and `removed` changes what a household is told they spent.

Two tests, and the second is not optional:

1. the upsert path, as for the other two tables
2. **`applyRemoved` given an id belonging to another household**, asserting that
   household's row is untouched

---

## 3. The joint-account question, argued rather than resolved

**This is a product decision wearing a schema costume, and it is Guy's to rule.**
The collision is not an attack and not an error: `item_id` is Plaid's, and two
households linking the same bank login produce the same Item. A shared account, a
couple who separated, an adult child on a parent's account. **Ordinary use.**

Whatever we do to the constraint decides what happens to those households, so the
constraint cannot be chosen without deciding this first.

### Option A: two Items, one per household

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

### Option B: one Item, shared, boundary drawn elsewhere

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

### Option C: refuse the second connection

The constraint stays global and a second household linking the same Item is told
the account is already connected elsewhere.

- Stated only to be rejected. It leaks the existence of another household to a
  stranger who guesses a bank login, and **it refuses a legitimate household for
  the convenience of our schema.** Same reasoning that rejected pre-checking
  global phone uniqueness inside a policy: an inconvenience to us is not a reason
  to refuse a household.

### What the plan recommends, and why it is a recommendation

**Option A**, on the boundary argument rather than the cost one. Two Items is more
expensive and it keeps the household boundary exactly where every other rule in
this system assumes it is: a household's data is a household's, derived from a
connection they own. Option B is cheaper and moves an isolation boundary into a
shape no existing control can express, which is the kind of change that makes
every downstream control approximately right.

**The cost is real and should be accepted knowingly, not discovered.** If a
material share of households share logins, this is a recurring bill that grows
with engagement, and the honest time to notice is now rather than in a Plaid
invoice. **Guy rules; this plan makes the case.**

---

## 4. Tasks, in order

- **4a. Prove or disprove `transactions`**, both the upsert path and `applyRemoved`.
  Register entries with planted mutations, GUC read back inside the transaction.
  **Nothing else starts until this lands**, because it changes the size of the fix.
- **4b. Guy's ruling on section 3.** The constraint cannot be written before this.
- **4c. Constrain the sync role.** The authorization fix, and the one that closes
  the hole regardless of 4b. Options to be costed once 4a is known: a per-run
  household GUC with a real predicate, explicit household predicates on every sync
  write, or both. `USING (true)` should not survive this module.
- **4d. The constraints**, per 4b's ruling. Append-only migration, and the
  `(household_id, ...)` shape only if Option A is chosen.
- **4e. `applyRemoved` and every sibling get an explicit household predicate**,
  independent of RLS. Defence in depth is the point: the statement should be
  correct even if the policy is wrong, because it was.

---

## 5. What this plan does not decide

- Whether `provider_events`, `institutions`, `messages` and `stripe_subscriptions`
  should keep their global unique indexes. They are shared or provider-global by
  nature and are **not** in scope here; naming them is so the next reader does not
  assume they were missed.
- Anything about M8's connect UI. If Option A is chosen, the second household's
  Link flow is unchanged; if Option B, it is not, and that becomes M8's problem
  with this plan as its input.
