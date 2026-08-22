-- =========================================================================
-- The write half of the sync state machine (4.8, ruled by Guy 22 Aug 2026).
--
-- 4.4 SHIPPED A READ SIDE WHOSE WRITE SIDE NEVER EXISTED. sweepReason is
-- correct, last_cursor_at is written, STALE_AFTER_MS is reasoned, and twelve
-- tests exercise real logic. NOTHING EVER SET sync_status TO 'syncing', so
-- sweepReason returned null on its first line for every Item that has ever
-- existed. A cron added on its own would have run on schedule, examined every
-- Item, swept nothing forever, and reported healthy.
--
-- LANDED AS NEW WORK UNDER 4.8 RATHER THAN A REOPEN OF 4.4 (Guy). 4.4's
-- artifacts are correct as built; what was missing is the half they serve.
-- Reopening would say the shipped half was wrong. It was not. It was half.
--
-- THE MARKER AND THE SWEEP ARE ONE DESIGN AND THE CRASH IS THE SPEC. Setting
-- 'syncing' at the start means a crashed Worker leaves it set, and that is not
-- a hazard to design around: THE MARKER EXISTS TO MAKE A CRASH VISIBLE AND THE
-- SWEEP EXISTS TO END WHAT THE MARKER MAKES VISIBLE.
--
-- THE LOCK DECIDES ADMISSION, THE MARKER RECORDS HISTORY, AND NEITHER
-- SUBSTITUTES FOR THE OTHER. The Durable Object's promise chain is keyed on the
-- HOUSEHOLD and is in memory: authoritative for "is a sync running right now",
-- and lost if the object is evicted. This marker is per ITEM and durable:
-- authoritative for "a sync started and did not finish", which is exactly what
-- survives an eviction or a crash. They answer different questions.
--
-- SO THE MARKER MUST NEVER GATE A START, and nothing reads it to decide one
-- today. If it did, a stale 'syncing' would refuse every future sync for that
-- Item, which is the recorded failure of a guard that refuses a repeat when a
-- repeat is exactly what is needed. The chain is what prevents concurrency.
--
-- 'swept' IS A DISTINCT STATE AND NOT 'idle', per #172's class. Idle after a
-- sweep and idle after a clean finish are TWO FACTS, and giving them one value
-- is the defect that entry was named for, in the table it was named in. A swept
-- Item is fully re-syncable and carries what happened to it.
-- =========================================================================

ALTER TYPE "public"."sync_status" ADD VALUE IF NOT EXISTS 'swept';--> statement-breakpoint

ALTER TABLE "plaid_items" ADD COLUMN "sync_started_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON COLUMN "plaid_items"."sync_started_at" IS
  'When the CURRENT sync began, written in the same statement that sets sync_status to ''syncing'' and before the first Plaid call. A MARKER WITHOUT A TIMESTAMP IS A FACT WITHOUT A MOMENT, and the sweep''s whole judgement is elapsed time, so the two are one write or neither. NOT last_synced_at, which is written at COMPLETION and answers a different question. Read by sweepReason only for the case where no cursor has ever been persisted for this run, which is a sync that died before its first page.';--> statement-breakpoint

COMMENT ON TYPE "public"."sync_status" IS
  'idle: no sync running, last one finished cleanly. syncing: a sync started and has not finished, WHICH INCLUDES A SYNC WHOSE WORKER DIED. queued: a webhook arrived mid-sync, so a follow-up is owed when the current run ends. error: the sync failed in a way it reported. swept: the watchdog found this Item marked syncing with no recent progress and returned it to a re-syncable state. SWEPT IS DELIBERATELY NOT idle. Idle after a clean finish and idle after a sweep are two facts with different meanings for anyone reading the row, and collapsing them is the one-value-two-facts class. A swept Item is fully re-syncable; the value records what happened rather than restricting what may happen next. THE MARKER NEVER GATES A START: admission is the Durable Object chain, keyed on the household, and a durable marker used as a lock would refuse every future sync for an Item whose worker crashed.';
