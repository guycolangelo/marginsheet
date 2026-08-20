-- 0025's column grant to marginsheet_sync was inert from the moment it was
-- written, and its stated reason was false.
--
-- WHAT 0025 SAID: "Column-level grants, enumerated as everywhere else: a column
-- added later is not silently writable by a role that was granted the table
-- long ago." Then:
--
--   GRANT SELECT (last_completed_cursor), UPDATE (last_completed_cursor)
--     ON "plaid_items" TO marginsheet_sync;
--
-- WHY IT WAS FALSE. A TABLE-LEVEL GRANT COVERS THE TABLE AS A WHOLE, INCLUDING
-- COLUMNS ADDED LATER. Migration 0023 grants SELECT, INSERT and UPDATE on
-- plaid_items to marginsheet_sync at table level, deliberately, because
-- plaid_items is the pipeline's own table. So marginsheet_sync could read and
-- write last_completed_cursor the instant 0025 created it, the column grant
-- added nothing, and the sentence described a protection that never existed.
--
-- THE SAME SENTENCE WAS TRUE OF THE OTHER ROLE IN THE SAME MIGRATION, which is
-- how it came to be written. marginsheet_app holds NO table-level SELECT on
-- plaid_items: 0002 enumerated eleven columns for it, precisely so a column
-- added later is not silently readable. 0025's grant to marginsheet_app extends
-- that enumerated list and is correct and necessary. One statement, two roles,
-- one of them holding the table, and the reasoning that fits one was applied to
-- both.
--
-- NO EXPOSURE, AND THAT IS THE POINT OF RECORDING IT. Nothing widened. The
-- role's reach over plaid_items is exactly what 0023 ruled. What was wrong was
-- a comment claiming a narrowing that was not there, and a role's documentation
-- is a security claim.
--
-- The revoke is bookkeeping rather than protection: it removes a grant that
-- grants nothing, so the catalog stops showing a column-scoped privilege on a
-- table nobody scoped. Whether plaid_items should ACTUALLY be narrowed to the
-- 14 columns the Worker touches is a live question and is deliberately not
-- answered here: it is the same ruling as the 22 columns of transactions, and
-- half-answering it inside a pull request about households would blur the
-- record (Guy, 20 Aug 2026).
REVOKE SELECT (last_completed_cursor), UPDATE (last_completed_cursor)
	ON "plaid_items" FROM marginsheet_sync;--> statement-breakpoint

COMMENT ON COLUMN "plaid_items"."last_completed_cursor" IS
	'The cursor from the last sync that FINISHED. The only cursor guaranteed to survive a mutation during pagination, and the fallback TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION points at. Added in 0025 after spike 1c proved a mid-pagination cursor can be refused; before that the pipeline persisted one cursor and would have resumed from the position most likely to be rejected. CORRECTION, 20 Aug 2026 (migration 0030): 0025 also granted marginsheet_sync SELECT and UPDATE on this column, saying "a column added later is not silently writable by a role that was granted the table long ago". THAT WAS FALSE FOR THAT ROLE AND THE GRANT WAS INERT FROM THE MOMENT IT WAS WRITTEN. A table-level grant covers the table as a whole, including columns added later, and 0023 grants marginsheet_sync this table. The same sentence was TRUE of marginsheet_app in the same migration, which holds no table-level SELECT here and only the eleven columns 0002 enumerated, so its grant on this column is correct and stands. Nothing was ever widened; what was wrong was a comment describing a narrowing that did not exist. Found by the reach scan, which asks the catalog rather than reading the grant.';
