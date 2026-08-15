-- Reverses 0000_foundation.sql. Order matters: trigger, then table, then the
-- function and type that the table depended on.
DROP TRIGGER IF EXISTS categories_touch_updated_at ON "categories";
DROP TABLE IF EXISTS "categories";
DROP FUNCTION IF EXISTS touch_updated_at();
DROP TYPE IF EXISTS "public"."pl_line";
