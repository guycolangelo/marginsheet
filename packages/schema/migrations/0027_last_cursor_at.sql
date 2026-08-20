-- last_cursor_at: the column the watchdog measures progress by, which has
-- never existed.
--
-- HOW IT WAS MISSED, because the shape matters more than the column.
-- sweepReason() takes an ItemSyncState with a lastCursorAt field, and every
-- watchdog test constructs that object BY HAND. No test ever read the value
-- from a database, so the code and the fixtures agreed with each other and
-- both disagreed with the schema. 4.4 shipped a watchdog that measures
-- progress by a column that was never created, and its whole suite passed.
--
-- It surfaced on the first real sync, on the first statement that tried to
-- WRITE it: "column last_cursor_at of relation plaid_items does not exist".
-- Nothing before that point had cause to touch it, because nothing had ever
-- completed a page against a real Plaid Item.
--
-- WHY IT MATTERS RATHER THAN BEING A TYPO. The watchdog exists to distinguish
-- a stuck sync from a slow backfill, and it does that by asking WHEN A CURSOR
-- WAS LAST WRITTEN rather than how long a sync has been running. Measured from
-- start, a first backfill of 20,000 transactions reads as stuck. Without this
-- column the progress branch can never fire, so every sweep would fall through
-- to the elapsed-time branch, and the watchdog would sweep exactly the healthy
-- backfills it was designed not to touch.
--
-- Enforced by columns-the-code-writes-exist.test.ts, which fails when the
-- Worker writes a column no migration creates, and by the ADD COLUMN below.
ALTER TABLE "plaid_items"
	ADD COLUMN "last_cursor_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON COLUMN "plaid_items"."last_cursor_at" IS
	'When a sync cursor was last persisted for this Item. The watchdog measures PROGRESS by this rather than elapsed time, because a long backfill is not a stuck sync. NULL means no cursor has ever been written for the current run, which is the one case where elapsed time is the right question.';
