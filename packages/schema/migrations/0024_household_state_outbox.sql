-- The household-state-changed outbox (M4 task 4.4.1).
--
-- THE CONTRACT IS RULED (18 Aug 2026, plaid-pipeline-spec section 4) AND THIS
-- TABLE ENFORCES ITS SHAPE. A thin signal: no amounts, no balances, no merchant
-- names, no dates of household activity, no category names, no transaction
-- detail. Counts are permitted because a count is metadata; an amount is not.
--
-- WHY THE COLUMNS ARE ENUMERATED AND NOT A JSONB PAYLOAD. A jsonb column would
-- accept an amount without complaint, and the pressure to widen this will come
-- from a real place: some future rule will be cheaper to evaluate with the
-- delta already in hand, and that will read as an optimisation rather than as
-- moving household figures outside the RLS boundary. Named columns make the
-- widening a migration somebody has to write and review.
--
-- THE BOUNDARY ARGUMENT, recorded here because it is the one that cannot be
-- defeated by a particular rule: every column privilege, every policy, the sync
-- role's enumerated grant, household_isolation itself, NONE OF IT TRAVELS WITH
-- A MESSAGE. The signal stays in the database and the queue notification
-- carries only signal_id, so a consumer must read the row as marginsheet_app
-- with the household GUC set, subject to every policy.
--
-- A TENTH TABLE FOR marginsheet_sync, granted deliberately. The sync worker
-- must write the signal inside the same transaction as the data change it
-- describes; a write by anything else could commit separately, which is the
-- atomicity this table exists to provide. sync-grant-enumeration went red on
-- the declaration commit that preceded this one, which is the control working.

CREATE TABLE "household_state_signals" (
	"signal_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Traceability: which Item and which sync run produced this.
	"source_plaid_item_id" uuid,
	"source_sync_run_id" uuid NOT NULL,
	-- Change KINDS, specific enough to route and carrying no detail.
	"changed" text[] NOT NULL,
	-- Counts per kind. Metadata, never amounts.
	"counts" jsonb,
	-- SET AFTER THE DATA COMMITS, and that ordering is the entire point.
	--
	-- enqueued_at NULL means NO NOTIFICATION WAS EVER ANNOUNCED for this row.
	-- The repair sweep is structurally blind to those rows, which is what makes
	-- it a repair path rather than a poller:
	--
	--   a poller would ask:  WHERE claimed_at IS NULL
	--   the sweep asks:      WHERE enqueued_at IS NOT NULL AND claimed_at IS NULL
	--
	-- A comment claiming "this is not polling" is the section 514 shape: a
	-- sentence that reads as a constraint and enforces nothing. This column makes
	-- the difference CHECKABLE. A sweep that can pick up work no notification
	-- announced IS a poller regardless of what any comment says.
	"enqueued_at" timestamp with time zone,
	-- Claimed by the consumer. Unclaimed AND announced is the repair case.
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- A sync that changed nothing does not fire, so an empty set is refused rather
-- than stored. A watcher waking for nothing is how a watcher becomes noise.
ALTER TABLE "household_state_signals"
	ADD CONSTRAINT "household_state_signals_changed_not_empty"
	CHECK (array_length("changed", 1) >= 1);--> statement-breakpoint

-- Every kind the contract names, and nothing else. An unrecognised kind is a
-- routing failure at the consumer, so it is refused at the writer.
ALTER TABLE "household_state_signals"
	ADD CONSTRAINT "household_state_signals_changed_kinds"
	CHECK ("changed" <@ ARRAY[
		'transactions_added', 'transactions_modified', 'transactions_removed',
		'balances_updated', 'item_status_changed', 'recurring_updated',
		'liabilities_updated'
	]::text[]);--> statement-breakpoint

ALTER TABLE "household_state_signals"
	ADD CONSTRAINT "household_state_signals_household_id_fk"
	FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "household_state_signals"
	ADD CONSTRAINT "household_state_signals_item_fk"
	FOREIGN KEY ("source_plaid_item_id") REFERENCES "plaid_items"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Idempotency by unique index rather than by convention, the same reasoning as
-- provider_events: one signal per sync run per Item, so a re-fired emit
-- collides instead of producing a second wake-up.
CREATE UNIQUE INDEX "household_state_signals_run_item_unique"
	ON "household_state_signals" ("source_sync_run_id", "source_plaid_item_id");--> statement-breakpoint

-- THE SWEEP'S INDEX: announced, unclaimed, oldest first. The predicate matches
-- the sweep's query exactly, so an index scan cannot reach a row the sweep is
-- meant to be blind to.
CREATE INDEX "household_state_signals_repairable"
	ON "household_state_signals" ("occurred_at")
	WHERE "claimed_at" IS NULL AND "enqueued_at" IS NOT NULL;--> statement-breakpoint

-- THE COUNTER'S INDEX, pointing the opposite way at the same column.
--
-- A row with enqueued_at NULL and created_at old is NOT WORK TO BE DONE. It is
-- EVIDENCE OF A CRASH in the commit-to-enqueue window. A separate check counts
-- these and raises an internal item: it does not deliver them, does not claim
-- them, and is not the sweep.
--
-- That keeps the loss observable without making the sweep a poller. If the
-- window is truly a millisecond this counter reads zero forever AND ITS SILENCE
-- MEANS SOMETHING. If it ever reads non-zero we learn the window is wider than
-- we think, which is the only way we would ever learn it.
CREATE INDEX "household_state_signals_never_announced"
	ON "household_state_signals" ("created_at")
	WHERE "enqueued_at" IS NULL;--> statement-breakpoint

ALTER TABLE "household_state_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- FORCE as well as ENABLE. Without FORCE the table OWNER bypasses every policy,
-- so the isolation would hold for marginsheet_app and evaporate for whoever runs
-- migrations. Caught by an M1 invariant asserting FORCE is set on all 37 policied
-- tables or none: it reported 36 of 37, which is the whole value of an assertion
-- that counts rather than spot-checks.
ALTER TABLE "household_state_signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "household_isolation" ON "household_state_signals"
	USING ("household_id" = current_setting('marginsheet.household_id', true)::uuid);--> statement-breakpoint

-- The tenth table. INSERT and SELECT only: the sync worker writes signals and
-- reads them for the repair sweep, and has no reason to update or delete one.
GRANT SELECT, INSERT ON "household_state_signals" TO marginsheet_sync;--> statement-breakpoint
-- The consumer claims signals, which is the only UPDATE anyone needs.
GRANT SELECT, UPDATE ON "household_state_signals" TO marginsheet_app;--> statement-breakpoint

COMMENT ON TABLE "household_state_signals" IS
	'The household-state-changed outbox. Contract ruled 18 Aug 2026: a THIN signal carrying no financial data. Never add a column for an amount, a balance, a merchant name, a household activity date, a category name, or any transaction detail. The reason is a boundary rather than a preference: no column privilege, no policy and no role grant travels with a message, so a payload carrying household figures would be the one place in this system where they exist unprotected. The queue notification carries signal_id alone; the consumer reads this row as marginsheet_app with the household GUC set. enqueued_at is set AFTER the data commits, so NULL means no notification was ever announced: the repair sweep is structurally blind to those rows, which is what makes it a repair path rather than a poller, and a separate counter sees them as evidence of a crash in the commit-to-enqueue window. Two controls, opposite directions, same column.';--> statement-breakpoint
