-- Restores a grant that grants nothing, because marginsheet_sync holds
-- plaid_items at table level either way. The down exists to be replayable, not
-- because reverting changes any privilege.
GRANT SELECT (last_completed_cursor), UPDATE (last_completed_cursor)
	ON "plaid_items" TO marginsheet_sync;
