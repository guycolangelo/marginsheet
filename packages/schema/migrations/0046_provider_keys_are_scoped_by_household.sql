-- =========================================================================
-- M4 task 4d, PHASE A: the three provider keys gain a household-scoped index.
--
-- THE FINDING, CONFIRMED AGAINST A REAL DATABASE ON 19 AUG 2026. Acting as
-- household A, exchange.ts upserted HOUSEHOLD B's plaid_items row and replaced
-- B's access_token_ciphertext. household_isolation did not refuse it. The route
-- is ordinary use rather than an attack: item_id is Plaid's, and two households
-- linking the same joint account produce the same one.
--
-- WHY THE INDEX IS THE FIX RATHER THAN THE POLICY. `on conflict (item_id)`
-- infers its arbiter from a unique index on item_id ALONE, and that index spans
-- every household. The arbiter therefore FINDS another household's row and
-- converts an insert into an update of it, which is a write the policy never
-- sees as cross-household because by then it is an UPDATE of a row the GUC does
-- not protect. Scoping the index scopes the arbiter.
--
-- PHASE A KEEPS THE GLOBAL INDEXES. Migrate runs BEFORE the Worker deploy, so
-- dropping them in the same migration would leave the new schema live under the
-- old code, whose `on conflict (item_id)` would raise "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" on every write.
-- With both present there is no instant at which any deployed code lacks its
-- arbiter. 0047 drops the globals once this is live everywhere.
--
-- WHAT PHASE A CHANGES AND WHAT IT DOES NOT, stated so the gap is not
-- discovered later. It closes the SILENT OVERWRITE: the new arbiter cannot
-- reach another household's row. It does NOT yet admit a shared joint account,
-- because the surviving global index refuses the second household's insert with
-- a unique violation. A LOUD REFUSAL IS NOT THE END STATE AND IT IS STRICTLY
-- BETTER THAN A SILENT CORRUPTION, which is what made the phasing worth its
-- extra migration.
--
-- ---------------------------------------------------------------------------
-- CAN EXISTING ROWS REFUSE THIS MIGRATION? NO, AND STRUCTURALLY SO.
--
-- The standing paragraph a constraint migration owes, and this one answers it
-- by IMPLICATION rather than by inspecting production.
--
-- Every index below is STRICTLY WEAKER than one that already exists.
-- UNIQUE (a) implies UNIQUE (h, a): if every value of a is distinct across the
-- table, then every pair (h, a) is distinct, because two pairs sharing h must
-- differ in a, and two pairs differing in a are already distinct. So any data
-- satisfying the global index satisfies the composite, FOR ANY NUMBER OF
-- HOUSEHOLDS AND ANY DATA WHATEVER.
--
-- That is not an argument about production's current contents and does not
-- weaken as the product grows. It deliberately does NOT rest on "there is only
-- one household", which is true today, unverifiable from this file, and false
-- exactly when this task starts mattering.
--
-- 0045 IS THE INSTANCE THAT BOUGHT THIS PARAGRAPH. It added a foreign key where
-- there had been no constraint at all: strictly STRONGER, so existing rows
-- could violate it, and they did. Production refused it, rolled it back whole,
-- and froze: nothing numbered after it could run and no code could deploy. CI
-- could not have caught it, because every CI branch is fresh and an empty table
-- satisfies every constraint vacuously.
-- ---------------------------------------------------------------------------

-- plaid_items: THE LIVE CROSS-HOUSEHOLD OVERWRITE PATH. This is the one that
-- was demonstrated, and the one whose arbiter reached a row holding another
-- household's Plaid access token.
CREATE UNIQUE INDEX "plaid_items_household_item_unique"
	ON "plaid_items" USING btree ("household_id", "item_id");--> statement-breakpoint

-- financial_accounts: LATENT. Same shape, same global index, and never
-- demonstrated because the test that would have proved it omitted a NOT NULL
-- column and threw for a schema reason before reaching any policy.
CREATE UNIQUE INDEX "financial_accounts_household_account_unique"
	ON "financial_accounts" USING btree ("household_id", "plaid_account_id");--> statement-breakpoint

-- transactions: LATENT. Reachable the moment two households hold one account,
-- because a transaction id is scoped to the Item that produced it.
CREATE UNIQUE INDEX "transactions_household_transaction_unique"
	ON "transactions" USING btree ("household_id", "plaid_transaction_id");--> statement-breakpoint

COMMENT ON INDEX "plaid_items_household_item_unique" IS
	'The arbiter for exchange.ts''s upsert. A unique index on item_id alone spans every household, so `on conflict (item_id)` FINDS another household''s row and converts an insert into an update of it. Confirmed 19 Aug 2026 against a real database: household A replaced household B''s access_token_ciphertext and household_isolation did not refuse it, because by the time the policy sees the statement it is an UPDATE of a row the GUC does not protect. Scoping the index scopes the arbiter.';--> statement-breakpoint

COMMENT ON INDEX "financial_accounts_household_account_unique" IS
	'Same shape as plaid_items and never demonstrated, which is a fact about the test rather than about the risk: the fixture that would have proved it omitted financial_accounts.plaid_item_id, which is NOT NULL, so the statement threw for a schema reason before reaching any policy and the swallowed exception made it pass vacuously.';--> statement-breakpoint

COMMENT ON INDEX "transactions_household_transaction_unique" IS
	'Latent until two households hold one account. Plaid ids are Item-scoped, so a shared joint account produces the same plaid_transaction_id for both households and the global index makes one of them the other''s update.';
