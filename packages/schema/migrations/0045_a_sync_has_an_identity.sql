-- =========================================================================
-- A sync has an identity, so source_sync_run_id stops being a fabricated answer.
--
-- household_state_signals.source_sync_run_id is NOT NULL, its comment promises
-- "which Item and which sync run produced this", and run-sync has been passing
-- gen_random_uuid() since 4.4. THERE WAS NO SYNC RUN IDENTITY IN THIS SYSTEM,
-- so the column held a fresh random uuid per signal that joins to nothing, no
-- log line, and no other signal from the same sync.
--
-- IT IS WORSE THAN A NULL BECAUSE IT IS JOIN-SHAPED. A consumer at M13 grouping
-- signals by sync run gets one group per signal and NO ERROR, which is the
-- normal-case-indistinguishable-from-the-failure-case class: the reading looks
-- like an answer and nothing anywhere disagrees with it.
--
-- WHY THIS IS A TABLE AND NOT A COLUMN ON plaid_items, and the question was
-- asked deliberately rather than assumed:
--
--   plaid_items.sync_status + sync_started_at is the Item's CURRENT STATE. One
--   row per Item, overwritten every sync, read by the watchdog on a live cron.
--
--   sync_runs is HISTORY. One row per run, never overwritten, and the only
--   thing that can answer "how long do syncs actually take" or "which signals
--   came from one run".
--
-- State and history are two facts with different cardinality, different
-- lifetimes and different readers. Folding them would make the watchdog scan an
-- unbounded history for open rows instead of reading a column on the row it
-- already holds, which is a worse query for the one thing that runs on a timer.
--
-- SO THEY ARE SEPARATE AND THE DUPLICATION IS NOT SILENT. started_at here and
-- plaid_items.sync_started_at are two statements of one fact, which drift by
-- default. They are written in THE SAME committed marker transaction, and
-- sync-run-agrees-with-the-marker asserts that every Item in 'syncing' has
-- exactly one open run whose started_at matches. Two statements plus something
-- that reconciles them, rather than two statements and a hope.
--
-- WRITTEN IN THE MARKER'S TRANSACTION, WHICH COMMITS BEFORE THE WORK. A record
-- of an attempt that lives inside the transaction whose failure it records is
-- rolled back by the failure, which is the one circumstance it exists for.
-- =========================================================================

CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- NULL WHILE THE RUN IS OPEN, and an open run older than the watchdog's
	-- threshold is the same evidence sync_status = 'syncing' carries. This
	-- column is what makes duration measurable at all: completed_at - started_at
	-- over real runs is the data the threshold re-derivation needs, and until
	-- now nothing recorded a finish time next to its own start.
	"completed_at" timestamp with time zone,
	-- HOW IT ENDED, because completed_at alone conflates two facts. A run that
	-- finished cleanly and a run the watchdog gave up on both have an end time,
	-- and they are opposite events: one produced a ledger, the other abandoned
	-- one. NULL while open.
	"outcome" text,
	-- What the run did. The same counts the readout already reports, kept here
	-- so a finished run can be read without re-deriving anything from the
	-- ledger. COUNTS ONLY: no amounts, no balances, no merchant names.
	"transactions_added" integer,
	"transactions_modified" integer,
	"transactions_removed" integer,
	-- Accounts whose balance was READ this run. Amendment 14's population, and
	-- deliberately not the same number as the one below.
	"accounts_refreshed" integer,
	-- Accounts whose balance actually MOVED. Two facts, two columns: an account
	-- read and unchanged is still reconciled and does not signal.
	"balances_changed" integer,
	"liabilities_changed" integer,
	"pages" integer,
	"restarts" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- The threshold re-derivation reads finished runs per Item, newest first.
ALTER TABLE "sync_runs"
	ADD CONSTRAINT "sync_runs_outcome_values"
	CHECK ("outcome" IS NULL OR "outcome" IN ('completed', 'swept'));--> statement-breakpoint

CREATE INDEX "sync_runs_item_started" ON "sync_runs" USING btree ("plaid_item_id", "started_at" DESC);--> statement-breakpoint
-- Open runs, for the agreement check and for anything asking what is in flight.
CREATE INDEX "sync_runs_open" ON "sync_runs" USING btree ("plaid_item_id") WHERE "completed_at" IS NULL;--> statement-breakpoint

ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "sync_runs"
	ADD CONSTRAINT "sync_runs_household_id_fk"
	FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sync_runs"
	ADD CONSTRAINT "sync_runs_plaid_item_id_fk"
	FOREIGN KEY ("plaid_item_id") REFERENCES "plaid_items"("id") ON DELETE CASCADE;--> statement-breakpoint

-- Same split as 0026: the read is permissive because the sweep and the readout
-- cross households by design; every write names its own household, so the
-- statement is correct even where the policy is not.
CREATE POLICY "household_isolation" ON "sync_runs" FOR ALL TO marginsheet_app
	USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid)
	WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "sync_runs" FOR SELECT TO marginsheet_sync
	USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "sync_runs" FOR ALL TO marginsheet_sync
	USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid)
	WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint

-- The thirteenth table on this role, per 0023's process: enumerated, never
-- granted-and-subtracted, so a fourteenth added later is excluded by default.
GRANT SELECT, INSERT, UPDATE ON "sync_runs" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT ON "sync_runs" TO marginsheet_app;--> statement-breakpoint

COMMENT ON TABLE "sync_runs" IS
	'One row per sync run, opened in the marker transaction that commits BEFORE the work and closed when the work commits. It exists because household_state_signals.source_sync_run_id was NOT NULL, commented as traceability, and fed gen_random_uuid(): a value that joins to nothing while looking exactly like a foreign key. SEPARATE FROM plaid_items.sync_status BY DESIGN: that pair is the Item current state, one row, overwritten, read by the watchdog on a timer; this is history, one row per run, never overwritten. started_at duplicates plaid_items.sync_started_at, which is why both are written in one transaction and sync-run-agrees-with-the-marker reconciles them.';--> statement-breakpoint

COMMENT ON COLUMN "sync_runs"."completed_at" IS
	'NULL while the run is open. It is also the first thing in this system able to answer how long a sync actually takes: STALE_AFTER_MS was derived from a single observation of 1,560 rows in 47 seconds, and re-deriving it needs completed_at - started_at over real runs.';--> statement-breakpoint

COMMENT ON COLUMN "sync_runs"."accounts_refreshed" IS
	'Accounts whose balance was READ. Amendment 14 scopes reconciliation to this population: an account Plaid did not return has no new observation to make. DELIBERATELY NOT balances_changed, because an account read and unchanged is still reconciled and is exactly where drift would be most suspicious.';--> statement-breakpoint

COMMENT ON COLUMN "sync_runs"."balances_changed" IS
	'Accounts whose balance actually MOVED, detected with IS DISTINCT FROM so a nullable column that stayed null does not read as a change. This is the signal population. Keying balances_updated on accounts_refreshed instead would fire on every sync, since Plaid returns balances on every page, which deletes the gate rather than widening the input.';


-- =========================================================================
-- AND THE SIGNAL'S RUN REFERENCE BECOMES HONEST ABOUT ABSENCE.
--
-- source_sync_run_id was NOT NULL and fed gen_random_uuid(), so "no run" was
-- expressed as a fabricated run. Now that real run ids exist, the column can
-- say what is true: a signal from a sync carries its run, and a signal with no
-- recorded run carries NULL.
--
-- IT IS NOT THE SAME AS THE OLD BEHAVIOUR WITH A DIFFERENT SPELLING. A random
-- uuid asserts a run that never existed and joins to nothing while looking like
-- a foreign key; NULL asserts nothing and is visible as absence. The cases that
-- need it are real: an Item marked syncing before this table existed has no
-- open run for the watchdog to attribute its sweep to.
-- =========================================================================

ALTER TABLE "household_state_signals" ALTER COLUMN "source_sync_run_id" DROP NOT NULL;--> statement-breakpoint

-- THE ROWS WRITTEN UNDER THE OLD MEANING, AND WHAT BECOMES OF THEM.
--
-- Every household_state_signals row that existed before this migration carries
-- a source_sync_run_id produced by gen_random_uuid(): a value invented at insert
-- time, naming a run that never existed, and pointing at nothing. The foreign
-- key below refuses exactly those rows, which is the constraint doing its job.
--
-- SO THEY ARE NULLED, NOT DELETED. NULL says truthfully "no run was recorded",
-- which is why the column became nullable one statement above. Deleting them
-- would erase real events -- signals about transactions that genuinely arrived
-- -- to comfort a traceability column, which is the wrong thing to protect.
--
-- IT IS A NO-OP ON ANY DATABASE WITHOUT SUCH ROWS. The predicate matches only
-- ids absent from sync_runs, and a database whose signals table is empty, or
-- whose signals all carry real run ids, updates nothing. That is why the three
-- environments converge on identical schema and identical semantics.
--
-- THIS STATEMENT WAS ADDED AFTER 0045 MERGED, WHICH IS AN AUTHORIZED EDIT TO A
-- MERGED MIGRATION. See config/migration-edit-authorizations.json for the
-- authorization, the reasoning and the date. Production refused 0045 on its
-- first run because it holds real signal rows; dev and staging applied it
-- because they do not. There is no forward-only repair: each migration runs in
-- one transaction, so 0045 rolled back whole, and nothing numbered after it can
-- execute until it succeeds.
UPDATE "household_state_signals" SET "source_sync_run_id" = NULL
	WHERE "source_sync_run_id" IS NOT NULL
	  AND NOT EXISTS (
	    SELECT 1 FROM "sync_runs" r WHERE r.id = "household_state_signals"."source_sync_run_id"
	  );--> statement-breakpoint

ALTER TABLE "household_state_signals"
	ADD CONSTRAINT "household_state_signals_source_sync_run_id_fk"
	FOREIGN KEY ("source_sync_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL;--> statement-breakpoint

COMMENT ON COLUMN "household_state_signals"."source_sync_run_id" IS
	'The sync run that produced this signal, or NULL when no run was recorded. It carried gen_random_uuid() from 4.4 until 22 Aug 2026: NOT NULL, commented as traceability, and joining to nothing. A consumer grouping signals by run got one group per signal and no error. The foreign key is what makes the claim checkable rather than merely intended.';
