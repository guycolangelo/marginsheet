-- =========================================================================
-- 0013_narrow_plaid_write: the app role's write path on plaid_items becomes
-- as narrow as its read path already was.
--
-- RULED BY GUY, 15 August 2026.
--
-- THE FINDING. 0002 granted marginsheet_app table-level INSERT and UPDATE on
-- plaid_items (`awd`) while enumerating SELECT column by column to withhold
-- access_token_ciphertext. A TABLE-level grant covers EVERY column, so the
-- app role could not read the token but could overwrite it.
--
-- WHY THAT MATTERS EVEN THOUGH IT IS NOT A DISCLOSURE. An app role that can
-- overwrite a token ciphertext can break every household's bank sync by
-- writing garbage. It cannot forge a valid token without TOKEN_ENCRYPTION_KEY,
-- so this is tampering rather than theft, and tampering is a real failure mode
-- even when disclosure is not on the table.
--
-- THE MORE IMPORTANT REASON. 0002 got the read right BY LUCK RATHER THAN BY
-- DESIGN. It granted `awd` and enumerated SELECT separately. Had it granted
-- `arwd`, the read control would have been silently void from the day it was
-- written, and the migration would have looked exactly as careful in review.
-- A control that holds by accident is one that stops holding the next time
-- somebody edits the grant.
--
-- (The invariant-2 test would still have caught the read case, because it
-- attempts the read and requires failure rather than inspecting the grant.
-- That is the difference between a test and a description.)
--
-- WHY THE REVOKE IS SAFE HERE, unlike the session columns in 0012.
-- 0012's header sets the test: does the write need to succeed? For
-- session.ip_address it did, so the revoke would have removed authentication
-- and a trigger was correct instead. Here it does not:
-- access_token_ciphertext is NULLABLE, so the app creates a plaid_items row
-- without naming the column and the insert succeeds. marginsheet_sync holds
-- UPDATE and mints or rotates the token afterwards. Verified on dev before
-- this migration was written.
--
-- This also lands before M4 exists, which is the point: the constraint shapes
-- the Plaid pipeline's code rather than being retrofitted against it.
-- =========================================================================

-- The masking grants. Everything the app legitimately writes is enumerated
-- below; DELETE stays at table level because it operates on whole rows.
REVOKE INSERT, UPDATE ON TABLE "plaid_items" FROM marginsheet_app;

-- INSERT: every column except the token. Enumerated rather than
-- all-minus-one, so a column added by a later migration is not silently
-- writable. Same shape as 0011's account grant.
GRANT INSERT (
  "id", "household_id", "institution_id", "item_id", "status",
  "last_successful_sync", "sync_cursor", "sync_status", "last_synced_at",
  "created_at", "updated_at"
) ON TABLE "plaid_items" TO marginsheet_app;

-- UPDATE: the operational columns only. id, household_id and created_at are
-- identity and are not the app's to change after creation.
GRANT UPDATE (
  "institution_id", "item_id", "status", "last_successful_sync",
  "sync_cursor", "sync_status", "last_synced_at", "updated_at"
) ON TABLE "plaid_items" TO marginsheet_app;

COMMENT ON COLUMN "plaid_items"."access_token_ciphertext" IS
  'Decryptable by marginsheet_sync only, using TOKEN_ENCRYPTION_KEY, which lives in that worker''s secret store and nowhere else. The block on marginsheet_app is a COLUMN privilege, not an RLS policy: RLS filters which ROWS a role sees, and this has to be unreadable on every row including the household''s own. Since 0013 the app role also holds no INSERT or UPDATE here, so it can neither read the token nor overwrite it; only the sync worker mints or rotates one. The column is nullable precisely so the app can create an item row without ever naming it. Never grant the app role a table-level INSERT or UPDATE on this table: a table grant covers every column and silently voids this control, which is exactly how the write stayed open from 0002 until 0013.';
