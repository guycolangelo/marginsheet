-- =========================================================================
-- The watchdog's own trace, so silence has two meanings and only one shape.
--
-- A CRON THAT STOPPED FIRING AND A CRON WITH NOTHING TO DO PRODUCE THE SAME
-- OBSERVABLE: no Item swept. Those are opposite facts with opposite remedies,
-- which is the one-value-two-facts class applied to silence rather than to a
-- column. So every run writes a row, INCLUDING RUNS THAT SWEEP NOTHING, and the
-- absence of a recent row means the watchdog stopped rather than that the
-- system is healthy.
--
-- A WATCHDOG NEEDS ITS OWN WATCHDOG EXACTLY ONCE. The trace plus an assertion on
-- its age is that once, and nothing watches the assertion.
--
-- HONEST ABOUT WHEN IT FIRES, WHICH IS NOT CONTINUOUSLY. verify-deploy asserts
-- the trace's age on every production deploy, and the ledger readout reports it
-- when somebody looks. NOTHING IN THIS SYSTEM RUNS CONTINUOUSLY EXCEPT THE CRON
-- ITSELF, so a stopped cron is detected the next time either of those happens
-- rather than the moment it stops. That is a real limit and it is stated rather
-- than papered over: closing it needs monitoring outside this stack.
--
-- NO household_id, DELIBERATELY. The sweep runs across every household and this
-- row holds two counts and a timestamp, so there is no household dimension to
-- scope by. RLS is enabled and FORCED anyway, with a permissive policy, so the
-- table cannot become the one place a household boundary is silently absent:
-- the policy says `true` because there is nothing to compare, not because
-- nobody thought about it.
-- =========================================================================

CREATE TABLE "sweep_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Items found in 'syncing', whether or not any were stale.
	"items_examined" integer NOT NULL,
	-- Items actually returned to a re-syncable state. ZERO IS THE NORMAL CASE
	-- and is exactly why the row is written at all.
	"items_swept" integer NOT NULL
);--> statement-breakpoint

CREATE INDEX "sweep_runs_ran_at" ON "sweep_runs" USING btree ("ran_at" DESC);--> statement-breakpoint

ALTER TABLE "sweep_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sweep_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "sweep_runs_readable" ON "sweep_runs" FOR SELECT TO marginsheet_app, marginsheet_sync
	USING (true);--> statement-breakpoint
CREATE POLICY "sweep_runs_writable" ON "sweep_runs" FOR INSERT TO marginsheet_sync
	WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, INSERT ON "sweep_runs" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT ON "sweep_runs" TO marginsheet_app;--> statement-breakpoint

COMMENT ON TABLE "sweep_runs" IS
	'One row per watchdog sweep, INCLUDING SWEEPS THAT FOUND NOTHING. That is the whole point: a cron that stopped firing and a cron with nothing to do produce the same observable, no Item swept, and they are opposite facts with opposite remedies. The row makes the second visible so the first is the only thing that leaves no trace. NO household_id: the sweep runs across every household and this holds two counts and a timestamp, so there is no household dimension. The permissive policy says true because there is nothing to compare rather than because the boundary was forgotten. ITS AGE IS THE SIGNAL rather than its contents: verify-deploy asserts it on every production deploy and the ledger readout reports it on demand. Neither is continuous, so a stopped cron is found the next time one of those runs, which is a stated limit rather than an oversight.';--> statement-breakpoint

COMMENT ON COLUMN "sweep_runs"."items_swept" IS
	'Almost always zero, and a run that writes zero is not a wasted row. The count distinguishes a healthy quiet system from a dead scheduler only in combination with ran_at, which is why both are written together and neither is useful alone.';
