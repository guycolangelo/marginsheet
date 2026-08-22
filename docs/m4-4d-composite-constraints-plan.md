# M4 task 4d: the three provider keys become composite, before M5's backfill

## Draft 22 August 2026, for Guy's approval.

Closes `cross-household-upsert-overwrites-another-household`, confirmed against a real database on 19 Aug 2026: acting as household A, `exchange.ts` upserted **household B's `plaid_items` row and replaced B's `access_token_ciphertext`**. `household_isolation` did not refuse it, and the route is ordinary use rather than an attack -- `item_id` is Plaid's, and two households linking the same joint account produce the same one.

---

## 1. THE THREE, NAMED BEFORE ANYTHING IS TOUCHED

| Index | Declared | Table's household column | Its one ON CONFLICT site |
|---|---|---|---|
| `plaid_items_item_id_unique` | 0002:139 | `household_id` | `exchange.ts:101` -- `on conflict (item_id)` |
| `financial_accounts_plaid_account_id_unique` | 0002:133 | `household_id` | `exchange.ts:122` -- `on conflict (plaid_account_id)` |
| `transactions_plaid_transaction_id_unique` | 0003:104 | `household_id` | `apply-streams.ts:114` -- `on conflict (plaid_transaction_id)` |

**One index, one arbiter, each.** The mapping was checked rather than assumed: those are the only three `on conflict` clauses in the sync Worker naming any of these columns.

---

## 2. CAN THIS HIT THE 0045 SHAPE? NO, AND STRUCTURALLY SO

The paragraph a constraint migration now owes.

**The new constraint is strictly WEAKER than the one it replaces, so no data that satisfies the old one can violate the new one.** `UNIQUE (a)` implies `UNIQUE (h, a)`: if every value of `a` is distinct across the table, then every pair `(h, a)` is distinct, because the pairs differ in their second component alone. **This holds for any number of households and any data whatsoever**, so it is not an argument about production's current contents and does not weaken as the product grows.

**That is the opposite of 0045, and the contrast is the general rule.** 0045 added a foreign key where there had been no constraint at all: strictly **stronger**, so existing rows could and did violate it. **A migration that ADDS or STRENGTHENS a constraint can be refused by data that already exists; a migration that REPLACES one with a strictly weaker one cannot.** That is checkable at authoring time by asking whether the old constraint implies the new one, and it is the question to answer in writing rather than the reassurance that production looks fine.

**Explicitly NOT relying on "there is only one household."** That argument would be true today, unverifiable from the migration, and false the moment a second household exists -- which is the condition the whole task exists to serve.

---

## 3. THE HAZARD THAT IS REAL, AND IT IS ORDERING RATHER THAN DATA

**`ON CONFLICT` requires a unique index matching its inference specification exactly.** The moment `plaid_items_item_id_unique` is dropped, `on conflict (item_id)` raises *"there is no unique or exclusion constraint matching the ON CONFLICT specification"* -- **at runtime, not at migration time.**

**Migrate runs BEFORE the Worker deploy.** So a single-phase swap opens a window, roughly the length of a Worker deploy, in which the **new schema is live under the old code** and any exchange or transaction write throws. Nothing corrupts; it fails loudly. But it is a window in which a household pressing Sync gets an error, and today's lesson is that the environment holding data is the one that finds these.

### Two options, and I recommend the second

**Single-phase.** One migration drops and creates inside one transaction, code changes in the same PR. Simplest, one migration, and carries the window above.

**Two-phase, recommended.**

1. **Migration A** creates the composite unique indexes and **leaves the global ones in place.** Both exist. The new code's `on conflict (household_id, ...)` has its arbiter the moment it deploys, and the old code's `on conflict (item_id)` still has its own. **There is no instant at which any deployed code lacks a matching index.**
2. **Migration B**, a following PR, drops the three global indexes once the new code is live everywhere.

The cost is one extra migration and one extra deploy. What it buys is that **no window exists at all**, rather than a short one that is unlikely to be hit.

**What phase A does not fix, stated so the gap is not discovered later.** While a global unique index still exists, a second household linking a genuinely shared joint account is **refused** with a unique violation. That is today's behaviour and phase A does not make it worse; phase B is what ends it. The silent cross-household overwrite -- the actual finding -- **is closed by phase A**, because it is the `on conflict (item_id)` arbiter that reaches another household's row, and the new code stops naming it.

---

## 4. THE MUTATION IS DATABASE STATE

An index lives in the database, so a `source` mutation on the migration text would prove a file changed and nothing else: **the migration is applied once, when the CI branch is created, and the harness runs afterwards.**

Both registered controls plant with `kind: "sql"` and a `proof` query that reads the catalog back and refuses to run the test if the mutation did not land:

- **`composite-key-refuses-a-duplicate-within-a-household`** -- plant: `DROP INDEX plaid_items_household_item_unique`. Proof: the index is absent from `pg_indexes`.
- **`composite-key-admits-the-same-provider-id-across-households`** -- plant: recreate the **global** unique index alongside the composite. **That is the plausible-and-wrong mutation**: it reads as belt-and-braces, it is what somebody nervous about removing a constraint would actually write, and it silently restores the refusal the task exists to remove. Proof: two unique indexes on the column.

---

## 5. FIXTURES

**The discriminating case is two households holding the SAME provider id**, and it is the one no existing fixture can express, because until now the schema forbade it.

1. **Two households, one `plaid_account_id`.** Both rows exist. **Red against the current schema**, which is the point.
2. **One household, one `plaid_account_id` twice.** Refused. Without this, the migration could drop uniqueness entirely and fixture 1 would still pass.
3. **The upsert no longer reaches across.** The 19 Aug finding, executed: acting as household A, upsert an `item_id` owned by B, and assert **B's `access_token_ciphertext` is unchanged** and A now holds its own row. This is the finding's own reproduction, so it is the fixture that proves the task rather than the schema.
4. **Same, as `marginsheet_sync` rather than the owner**, because `sync_worker_write` is written to that role and an owner connection is not subject to it. Registered with `guards_policy: true`.

Fixture 3's evidence branch on branch `finding/cross-household-upsert` and PR #113 is the ancestor; it was removed from the authorization PR at the time so a real finding would not hold a live security fix behind a red check.

---

## 6. WHAT THIS TASK DOES NOT DO

- **No change to `outbox.markEnqueued` or `reconnect`**, which key on ids we mint. The provider-namespace rule is about provider keys, and applying it uniformly to cases that differ teaches nobody which case mattered.
- **No account-overlap decision.** Two households legitimately sharing an account is a product question (`account-overlap-recorded-not-acted-on`), and this task only stops the database from silently merging them.


---

## 7. PHASE B'S PLANT, WRITTEN NOW WHILE THE REASONING IS FRESH

**Registered in phase B, not here, and the reason is a correction worth keeping.** The belt-and-braces mutation -- `CREATE UNIQUE INDEX ... ON plaid_items (item_id)` alongside the composite -- was drafted as a phase A register entry and pointed at *"the household-scoped index exists and is unique"*. **That plant cannot redden that test.** Adding a second index does not remove the first, so the assertion passes and the harness would have reported an insensitive control.

The register's own checks caught it, on the `owed` status rather than on the mismatch, which is the weaker of the two signals and still enough. **A plant must break the thing the register says the test notices**, and a control whose plant is aimed at a different assertion is one nobody runs.

**So phase B brings its test and its plant together:**

- **Test:** two households legitimately hold one shared joint account -- the same `plaid_account_id` under two `household_id`s -- and **both rows exist.** It fails today and cannot pass until the global index is dropped, which makes it phase B's reason stated as a test rather than argued in a comment.
- **Plant:** recreate the global unique index alongside the composite. It is belt-and-braces-shaped, it is what somebody nervous about dropping a constraint actually writes, it breaks nothing visible -- the arbiter still cannot cross a household and every phase A fixture still passes -- and **the only thing it does is silently refuse the second household.** A mutation that ADDS a constraint reads as caution, which is exactly why it is the one worth planting.
