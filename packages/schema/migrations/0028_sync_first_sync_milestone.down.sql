REVOKE UPDATE (enqueued_at) ON "household_state_signals" FROM marginsheet_sync;--> statement-breakpoint
-- Reverting refuses markFirstSyncCompleted, so a household completes its first
-- sync and is never greeted: the M13 intro trigger reads this column.
REVOKE UPDATE (first_sync_completed_at, updated_at) ON "households" FROM marginsheet_sync;--> statement-breakpoint
REVOKE SELECT (id, first_sync_completed_at) ON "households" FROM marginsheet_sync;
