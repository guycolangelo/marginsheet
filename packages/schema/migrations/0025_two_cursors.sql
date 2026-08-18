-- The second cursor (M4 task 4.4.2).
--
-- WHY TWO. Spike 1c, 17 Aug 2026, found that a mid-pagination cursor CAN BE
-- REFUSED. If the underlying data changes while a pagination is in flight,
-- Plaid answers:
--
--   400 TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION
--   Underlying transaction data changed since last page was fetched.
--   Please restart pagination from last update.
--
-- That is exactly what a webhook landing mid-sync does, which section 3's own
-- state machine already describes, so it is a NORMAL CONTROL-FLOW BRANCH and
-- not an exception.
--
--   sync_cursor            the IN-FLIGHT cursor, persisted after every page.
--                          Resumes a crash. Can be refused after a mutation.
--   last_completed_cursor  the cursor from the last sync that finished, which
--                          is the only one guaranteed to survive a mutation and
--                          the fallback the error message points at.
--
-- WHY THIS IS NOT AN ERROR PATH, recorded here because the wrong shape is a
-- specific bug somebody writes later while believing they are fixing something.
-- Classified as an error, the Item parks, the watchdog sweeps it back, it fails
-- identically, and the obvious remedy for a sync that keeps failing is A RETRY.
-- A RETRY OF THE IN-FLIGHT CURSOR REPLAYS: duplicate transactions in a
-- household's ledger, arriving through a change that looked like reliability
-- work and had a green suite behind it.

ALTER TABLE "plaid_items"
	ADD COLUMN "last_completed_cursor" text;--> statement-breakpoint

COMMENT ON COLUMN "plaid_items"."sync_cursor" IS
	'The IN-FLIGHT cursor, persisted after every page so a crash resumes rather than replaying from zero. It can be REFUSED with TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION if the underlying data changed during pagination. On that error the sync restarts from last_completed_cursor. Never retry this cursor after that error: a retry replays.';--> statement-breakpoint

COMMENT ON COLUMN "plaid_items"."last_completed_cursor" IS
	'The cursor from the last sync that FINISHED. The only cursor guaranteed to survive a mutation during pagination, and the fallback TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION points at. Added in 0025 after spike 1c proved a mid-pagination cursor can be refused; before that the pipeline persisted one cursor and would have resumed from the position most likely to be rejected.';--> statement-breakpoint

-- Column-level grants, enumerated as everywhere else: a column added later is
-- not silently writable by a role that was granted the table long ago.
GRANT SELECT (last_completed_cursor), UPDATE (last_completed_cursor)
	ON "plaid_items" TO marginsheet_sync;--> statement-breakpoint
GRANT SELECT (last_completed_cursor) ON "plaid_items" TO marginsheet_app;--> statement-breakpoint
