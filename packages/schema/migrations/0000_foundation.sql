CREATE TYPE "public"."pl_line" AS ENUM('income', 'fixed_obligations', 'variable_operating', 'discretionary', 'interest_fees', 'transfer', 'deployment');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pl_line" "pl_line" NOT NULL,
	"icon" text,
	"color" text,
	"parent_id" uuid,
	"is_archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"plaid_pfc_mappings" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "categories_household_idx" ON "categories" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "categories_household_pl_line_idx" ON "categories" USING btree ("household_id","pl_line");--> statement-breakpoint
-- updated_at is maintained by trigger, not by application code, so a write
-- path that forgets it cannot produce a stale value (data-model-spec §0).
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER categories_touch_updated_at
  BEFORE UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
-- Rulings carried into the database itself. A COMMENT ON survives every
-- future reader: psql, an introspection, an analyst who never opens the
-- repo, the M9 migration author reconciling Base44 rows at 2am. A TypeScript
-- comment is visible only to someone reading that one file.
COMMENT ON TYPE "public"."pl_line" IS
  'Closed enum, seven values. Taxes is NOT a line (ruled 14 Aug 2026): it is a category named "Taxes After Takehome" filed under fixed_obligations. Migration remaps every legacy taxes category to fixed_obligations and moves the four tax subcategories with the renamed parent. Adding a value here requires a ruling from Guy, not a migration.';--> statement-breakpoint
COMMENT ON TABLE "categories" IS
  'Household category tree (data-model-spec §3). Seeded system rows carry is_system. "Gifts received" (pl_line = income) is filled by the question machinery and never by detection (ruled 14 Aug 2026).';--> statement-breakpoint
COMMENT ON COLUMN "categories"."plaid_pfc_mappings" IS
  'Plaid personal finance category strings this category absorbs. Text, not jsonb: a fixed-shape list, and data-model-spec §0 reserves jsonb for genuinely polymorphic payloads.';
