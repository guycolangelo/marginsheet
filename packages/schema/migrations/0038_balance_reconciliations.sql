-- Reconciling what the institution says against what our ledger says (4.6).
--
-- WHAT IS COMPARED, AND WHY IT IS A CHANGE RATHER THAN A BALANCE. We hold 730
-- days of transactions and no opening balance, so an absolute figure is not
-- derivable. The CHANGE is: between two syncs, the reported balance must move
-- by exactly the sum of the transactions written in that interval.
--
-- THAT ARITHMETIC HAS BEEN OBSERVED RECONCILING TO THE CENT. On 21 Aug 2026 a
-- sync wrote one transaction and SoFi Checking moved from 1731.96 to 1579.96,
-- and available from 1710.96 to 1558.96: both by exactly 152.00. That single
-- observation is the whole evidential basis for a ZERO tolerance, and it is
-- recorded here so the next person arguing for a threshold argues against it.
--
-- ZERO TOLERANCE, WITH A SETTLING WINDOW (Guy, 21 Aug 2026). A tolerance is a
-- claim about how wrong a figure may be before we stop trusting it, and any
-- non-zero number is a guess about an error nobody has observed. The failures
-- we actually expect are a pending transaction changing amount, a transaction
-- posting between the balance read and the transaction read, and an
-- institution's own intraday inconsistency. ALL OF THOSE ARE TIMING RATHER THAN
-- MAGNITUDE: the figures agree once things settle. A dollar threshold answers
-- the wrong axis, hiding small real errors permanently while doing nothing
-- about the transient ones it was chosen for.
--
-- ONE ROW PER ACCOUNT PER SYNC, NOT PER DAY. account_balance_snapshots is
-- deliberately per day, because the projection reads a series; this is per
-- sync, because the window counts syncs. Different grain, different table. THE
-- HISTORY IS THE POINT: it makes the window evaluable and lets a person see the
-- SHAPE of a drift rather than only its verdict.
CREATE TABLE "balance_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- What the institution said, via Plaid, at this sync.
	"reported_balance" numeric(14, 2),
	-- The previous reported balance plus the transactions written since it.
	"expected_balance" numeric(14, 2),
	-- reported minus expected. ZERO IS THE ONLY PASSING VALUE.
	"difference" numeric(14, 2),
	-- Null on the first observation for an account, which has no predecessor to
	-- compute a change from. A first observation is NOT a drift and must never
	-- be counted as one: absence of a prior reading is not disagreement.
	"comparable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "balance_reconciliations" ADD CONSTRAINT "balance_reconciliations_account_same_household_fk"
	FOREIGN KEY ("household_id","account_id") REFERENCES "public"."financial_accounts"("household_id","id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The window asks for the most recent observations of one account, so the index
-- is the query.
CREATE INDEX "balance_reconciliations_account_observed" ON "balance_reconciliations"
	USING btree ("account_id","observed_at" DESC);--> statement-breakpoint

ALTER TABLE "balance_reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- FORCE as well as ENABLE, so the table owner does not bypass every policy.
ALTER TABLE "balance_reconciliations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "household_isolation" ON "balance_reconciliations" FOR ALL TO marginsheet_app
	USING ("household_id" = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid)
	WITH CHECK ("household_id" = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint

-- READS ACROSS HOUSEHOLDS, WRITES WITHIN ONE, exactly as 0026 established for
-- every other table the pipeline touches.
CREATE POLICY "sync_worker_read" ON "balance_reconciliations" FOR SELECT TO marginsheet_sync
	USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "balance_reconciliations" FOR ALL TO marginsheet_sync
	USING ("household_id" = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid)
	WITH CHECK ("household_id" = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT ON "balance_reconciliations" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT ON "balance_reconciliations" TO marginsheet_app;--> statement-breakpoint

-- THE SURFACING DOES NOT HAPPEN HERE, AND THE FIRST DRAFT OF THIS MIGRATION
-- SAID IT DID. It read: "the investigation item goes in insight_ledger, which
-- already exists and which marginsheet_sync can already write."
--
-- THE SECOND HALF IS FALSE, AND insight_ledger IS THE TABLE 0023 NAMES AS ITS
-- OWN EXAMPLE. That migration narrowed marginsheet_sync from 39 tables to 9
-- precisely because it held "messages, threads, known_context, decision_journal,
-- insight_ledger and every LLM log", and its stated reason is that a component
-- with one job and a role that can read every household's conversation history
-- are different things wearing the same sentence.
--
-- So writing the finding from the sync Worker would have required granting an
-- eleventh table, and it would have been the exact table whose removal 0023
-- exists to demonstrate. THE DRIFT LIVES IN balance_reconciliations AND STAYS
-- THERE. Whatever surfaces insights reads this table with a role entitled to
-- both, which is a component that does not exist yet and is recorded in
-- docs/open-items.json rather than reached for here.
--
-- The enum value is still added, because the surfacing will need it and adding
-- a value nothing writes yet is inert. It is NOT evidence that anything writes
-- it: single-writer-columns is where that claim would have to be made.
ALTER TYPE "public"."insight_source" ADD VALUE IF NOT EXISTS 'reconciliation';--> statement-breakpoint

COMMENT ON TABLE "balance_reconciliations" IS
	'One row per account per sync, comparing the institution reported balance against our ledger. ZERO TOLERANCE: the only passing difference is exactly 0.00, because every failure we expect is TIMING rather than MAGNITUDE and a dollar threshold answers the wrong axis. A disagreement counts as DRIFT only when it persists across 3 consecutive comparable observations spanning at least 6 hours; three is chosen so read skew has two chances to clear, and the 6 hour span exists because counting syncs alone is defective, since three hand-run syncs in a minute would confirm a drift that a single settle would have cleared. NEITHER NUMBER HAS AN OBSERVATION BEHIND IT, unlike the 30 second Plaid deadline which had five production syncs: they are reasoned rather than measured and should move the moment real data disagrees. WHAT A CONFIRMED DRIFT MEANS: the ledger and the institution disagree about what happened in this account, and we do not know which is wrong, so EVERY figure derived from that account is under the same doubt rather than only the balance line.';
