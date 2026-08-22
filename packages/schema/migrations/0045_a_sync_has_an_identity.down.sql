-- Reverting drops the only real sync identity and puts household_state_signals
-- back to asserting a run that never existed.
--
-- THE ORDER IS FORCED BY THE FOREIGN KEY, and that is the constraint doing its
-- job: sync_runs cannot be dropped while a signal still references it, so the
-- reference is removed first. The first version of this file dropped the table
-- alone and CI refused it, which is the append-only rule's cousin -- a down
-- migration is code, and an untested one is a claim.
--
-- THE UPDATE IS DELIBERATE AND UGLY. source_sync_run_id was NOT NULL before
-- this migration, so restoring that constraint means every NULL needs a value,
-- and the only value available is the fabricated one this migration existed to
-- remove. Reverting restores the previous behaviour including the part that was
-- wrong; a down migration that quietly kept the improvement would be lying
-- about what it reverts.

ALTER TABLE "household_state_signals"
	DROP CONSTRAINT IF EXISTS "household_state_signals_source_sync_run_id_fk";--> statement-breakpoint

UPDATE "household_state_signals"
	SET "source_sync_run_id" = gen_random_uuid()
	WHERE "source_sync_run_id" IS NULL;--> statement-breakpoint

ALTER TABLE "household_state_signals"
	ALTER COLUMN "source_sync_run_id" SET NOT NULL;--> statement-breakpoint

DROP TABLE IF EXISTS "sync_runs";
