-- Reverting removes the column the watchdog measures progress by, which makes
-- every sweep fall through to the elapsed-time branch and sweep healthy
-- backfills.
ALTER TABLE "plaid_items" DROP COLUMN IF EXISTS "last_cursor_at";
