-- POSTGRES CANNOT REMOVE AN ENUM LABEL, so the type is rebuilt without it.
--
-- THE DEPENDENT COLUMNS ARE CAPTURED BEFORE THE DROP AND RESTORED FROM THAT
-- CAPTURE. Two earlier versions of this file got it wrong and both are worth
-- recording, because the second is the more interesting failure.
--
-- FIRST: it listed the two columns found by reading 0003, and the down
-- migration failed with "cannot drop type transaction_direction because other
-- objects depend on it". THERE WAS A THIRD, global_merchant_facts from 0007. A
-- hand-written list cannot know about a column added four migrations later.
--
-- SECOND: it derived the list for the detour and then RESTORED FROM A LITERAL
-- LIST OF THREE, guarded by an assertion that the catalog still showed three
-- dependents. THAT ASSERTION COULD NOT FAIL IN THE CASE IT EXISTED TO CATCH. A
-- fourth column would be detoured to text by the loop, skipped by the literal
-- list, and therefore NOT COUNTED as a dependent, so the count would read
-- exactly 3 and pass. It was a check reading its expectation from the thing it
-- was checking, and the comment above it claimed the opposite.
--
-- The capture fixes both. The restore reads the same rows the detour read, so
-- there is no second list to disagree with the first.
--
-- IT FAILS LOUDLY IF ANY ROW HOLDS 'undetermined', because the cast back has
-- nowhere to put that value. That is correct: a down migration that silently
-- discarded a filing state would be worse than one that refuses.
CREATE TEMP TABLE _direction_dependents ON COMMIT DROP AS
  SELECT c.relname::text AS tbl, a.attname::text AS col, a.attnotnull AS notnull
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE a.atttypid = 'public.transaction_direction'::regtype
     AND n.nspname = 'public' AND c.relkind = 'r'
     AND a.attnum > 0 AND NOT a.attisdropped;--> statement-breakpoint

DO $$
DECLARE
  d record;
  captured int;
BEGIN
  SELECT count(*) INTO captured FROM _direction_dependents;
  IF captured = 0 THEN
    RAISE EXCEPTION 'no columns use transaction_direction, so this down migration is operating on something other than it expects';
  END IF;

  FOR d IN SELECT * FROM _direction_dependents LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE text', d.tbl, d.col);
  END LOOP;
END $$;--> statement-breakpoint

DROP TYPE "public"."transaction_direction";--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint

DO $$
DECLARE
  d record;
  restored int;
  expected int;
BEGIN
  FOR d IN SELECT * FROM _direction_dependents LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE public.transaction_direction USING %I::public.transaction_direction',
      d.tbl, d.col, d.col);
  END LOOP;

  -- THE EXPECTATION COMES FROM THE CAPTURE, NOT FROM THE CATALOG IT IS
  -- CHECKING. Every column detoured is a column restored, and a mismatch means
  -- one was left as text rather than meaning the count happened to agree.
  SELECT count(*) INTO expected FROM _direction_dependents;
  SELECT count(*) INTO restored
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE a.atttypid = 'public.transaction_direction'::regtype
     AND n.nspname = 'public' AND c.relkind = 'r'
     AND a.attnum > 0 AND NOT a.attisdropped;

  IF restored <> expected THEN
    RAISE EXCEPTION 'detoured % columns through text and restored %; one is still text', expected, restored;
  END IF;
END $$;--> statement-breakpoint

COMMENT ON TYPE "public"."transaction_direction" IS
  'Three values. "unclassified" is deliberately ABSENT: it existed in Base44 as a legacy value that was never set, and the M9 migration rewrites any survivor through resolveDirection (invariant 9). NOTE: this is NOT commitment_direction, which is inflow or outflow. resolveDirection IS THE SINGLE SOURCE OF TRUTH for the stored value, applied last in the per-transaction pipeline (categorization-spec §8): transfer if is_transfer; income if the category line is income; expense for all other categorized transactions; income for UNCATEGORIZED INFLOWS; expense for uncategorized outflows. THE INCLUSION DOCTRINE, the rule a reader will most want to argue with: an unconfirmed inflow counts as INCOME while it awaits review. It is labeled, and the MarginSheet shows the transparency counterfactual (what Kept and Margin would be if every uncategorized inflow turned out to be a transfer). Holding inflows out until confirmed would understate income and make the household total wrong in the direction that flatters. Right in total, pending in breakdown. ONE DELIBERATE CARVE-OUT: unresolved inflows count on the MarginSheet but are excluded from the materiality floor, which requires review_state != needs_review. A floor inflated by unresolved deposits would suppress the very questions that resolve them.';
