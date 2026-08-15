-- =========================================================================
-- 0002_banking_sync: DATABASE ROLES ARE CREATED HERE, NOT IN 1.7.
--
-- This is the first migration in M1 that touches objects outside the schema
-- namespace. Two roles are created:
--
--   marginsheet_app   The API and app role. Member-scoped. Reads household
--                     data. It has NO privilege on
--                     plaid_items.access_token_ciphertext, by column GRANT,
--                     so it cannot read the Plaid token on any row.
--   marginsheet_sync  The Plaid sync worker. The ONLY role granted the
--                     ciphertext column, and the only place decryption
--                     happens.
--
-- WHY HERE AND NOT IN 1.7: 1.7 adds row-level security, which filters ROWS.
-- The token needs a COLUMN privilege, which is a different Postgres feature
-- and independent of RLS. Waiting for 1.7 would leave the column readable in
-- the meantime.
--
-- FOR THE AUTHOR OF 1.7: attach your row policies to THESE roles. Do not
-- create parallel roles; two overlapping role sets is how a policy ends up
-- protecting a role nothing connects as.
--
-- SCOPE, verified empirically 15 Aug 2026: roles created by SQL on a Neon
-- branch are branch-local. A probe branch's role was absent from both its
-- parent (staging) and production, and left no residue after the branch was
-- deleted. So a CI branch torn down without running the down migration
-- leaks nothing at the project level. Neon's control plane does list these
-- roles per branch, which makes them auditable.
-- =========================================================================

CREATE TYPE "public"."card_state" AS ENUM('paid_in_full', 'revolving', 'overdue', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."plaid_item_status" AS ENUM('healthy', 'needs_reauth', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."provider_source" AS ENUM('stripe', 'plaid', 'twilio', 'postmark');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('idle', 'syncing', 'queued', 'error');--> statement-breakpoint
CREATE TABLE "account_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"current_balance" numeric(14, 2),
	"available_balance" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"plaid_account_id" text NOT NULL,
	"name" text,
	"official_name" text,
	"mask" text,
	"type" text,
	"subtype" text,
	"current_balance" numeric(14, 2),
	"available_balance" numeric(14, 2),
	"credit_limit" numeric(14, 2),
	"iso_currency" text,
	"in_payoff_pool" boolean DEFAULT false NOT NULL,
	"classification_confirmed_at" timestamp with time zone,
	"card_state" "card_state",
	"carried_balance" numeric(14, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plaid_institution_id" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liability_details" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"last_statement_balance" numeric(14, 2),
	"last_statement_date" date,
	"minimum_payment" numeric(14, 2),
	"next_payment_due_date" date,
	"last_payment_date" date,
	"last_payment_amount" numeric(14, 2),
	"purchase_apr" numeric(6, 3),
	"cash_apr" numeric(6, 3),
	"balance_transfer_apr" numeric(6, 3),
	"special_apr" numeric(6, 3),
	"special_apr_expiry" date,
	"is_overdue" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"institution_id" uuid,
	"item_id" text NOT NULL,
	"access_token_ciphertext" text,
	"status" "plaid_item_status" DEFAULT 'healthy' NOT NULL,
	"last_successful_sync" timestamp with time zone,
	"sync_cursor" text,
	"sync_status" "sync_status" DEFAULT 'idle' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid,
	"source" "provider_source" NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"payload" jsonb,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liability_details" ADD CONSTRAINT "liability_details_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_balance_snapshots_account_date_unique" ON "account_balance_snapshots" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "account_balance_snapshots_household_date_idx" ON "account_balance_snapshots" USING btree ("household_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_plaid_account_id_unique" ON "financial_accounts" USING btree ("plaid_account_id");--> statement-breakpoint
CREATE INDEX "financial_accounts_household_idx" ON "financial_accounts" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "financial_accounts_item_idx" ON "financial_accounts" USING btree ("plaid_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_plaid_id_unique" ON "institutions" USING btree ("plaid_institution_id");--> statement-breakpoint
CREATE INDEX "liability_details_account_idx" ON "liability_details" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "liability_details_household_idx" ON "liability_details" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plaid_items_item_id_unique" ON "plaid_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "plaid_items_household_idx" ON "plaid_items" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_source_event_id_unique" ON "provider_events" USING btree ("source","event_id");--> statement-breakpoint
CREATE INDEX "provider_events_source_type_idx" ON "provider_events" USING btree ("source","event_type");--> statement-breakpoint
CREATE TRIGGER institutions_touch_updated_at BEFORE UPDATE ON "institutions"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER plaid_items_touch_updated_at BEFORE UPDATE ON "plaid_items"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER financial_accounts_touch_updated_at BEFORE UPDATE ON "financial_accounts"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER account_balance_snapshots_touch_updated_at BEFORE UPDATE ON "account_balance_snapshots"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER liability_details_touch_updated_at BEFORE UPDATE ON "liability_details"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER provider_events_touch_updated_at BEFORE UPDATE ON "provider_events"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- === Roles and column privileges (invariant 2) =============================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marginsheet_app') THEN
    CREATE ROLE marginsheet_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marginsheet_sync') THEN
    CREATE ROLE marginsheet_sync NOLOGIN;
  END IF;
END $$;--> statement-breakpoint

-- The migrating role must be a member of both roles to SET ROLE into them.
-- Neon's neondb_owner is not a superuser, so without this the invariant-2
-- test cannot assume the app role's identity and would pass vacuously as the
-- table owner, which bypasses column privileges entirely.
GRANT marginsheet_app, marginsheet_sync TO CURRENT_USER;--> statement-breakpoint

COMMENT ON ROLE marginsheet_app IS
  'The API and app role, member-scoped. Created in migration 0002, not in the RLS migration: it needs a COLUMN privilege on plaid_items, which is independent of row-level security. Row policies attach to THIS role in 1.7; do not create a parallel app role.';--> statement-breakpoint
COMMENT ON ROLE marginsheet_sync IS
  'The Plaid sync worker role. The only role granted plaid_items.access_token_ciphertext, and the only place the token is decrypted (invariant 2). Created in migration 0002 alongside marginsheet_app.';--> statement-breakpoint

-- The app role gets every plaid_items column EXCEPT the ciphertext. Columns
-- are enumerated rather than granted as ALL-minus, so a column added later is
-- not silently readable by this role.
GRANT SELECT (id, household_id, institution_id, item_id, status,
              last_successful_sync, sync_cursor, sync_status, last_synced_at,
              created_at, updated_at)
  ON "plaid_items" TO marginsheet_app;--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON "plaid_items" TO marginsheet_app;--> statement-breakpoint

-- The sync worker gets the ciphertext, and it is the only role that does.
GRANT SELECT ON "plaid_items" TO marginsheet_sync;--> statement-breakpoint
GRANT UPDATE ON "plaid_items" TO marginsheet_sync;--> statement-breakpoint

-- Both roles work normally everywhere else in this section.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "institutions", "financial_accounts", "account_balance_snapshots",
  "liability_details", "provider_events"
  TO marginsheet_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  "institutions", "financial_accounts", "account_balance_snapshots",
  "liability_details", "provider_events"
  TO marginsheet_sync;--> statement-breakpoint

-- === Doctrine =============================================================
COMMENT ON COLUMN "plaid_items"."access_token_ciphertext" IS
  'INVARIANT 2. The Plaid access token, encrypted app-layer with AES-GCM. Neon disk encryption is NOT sufficient for this column and does not satisfy this invariant. WHO CAN READ IT: marginsheet_sync only. That role holds the sole column GRANT, and decryption happens only inside the sync worker. WHO CANNOT: marginsheet_app. It has no SELECT privilege on this column at all, so a member-scoped query cannot read it on any row, and SELECT * from that role errors rather than returning the value. This is a COLUMN privilege, not an RLS policy: RLS filters rows, and rows are the wrong unit for a secret that no row should ever expose. THE KEY: TOKEN_ENCRYPTION_KEY, a Wrangler secret, distinct per environment, never in the repo and never in a log; custody and rotation posture are in docs/secrets-custody.md (Task 0.3). NEVER: returned to any client, written to a log, included in a Sentry event (the scrubber redacts it by pattern as a second layer), or selected by any role other than marginsheet_sync.';--> statement-breakpoint

COMMENT ON TABLE "provider_events" IS
  'INVARIANT 5. The single idempotency ledger for every inbound provider callback, across all four providers: stripe, plaid, twilio, postmark. EVERY WEBHOOK HANDLER CHECKS AND INSERTS HERE FIRST, BEFORE ANY PROCESSING. Not after validating, not after parsing, not alongside the work: first. The unique constraint on (source, event_id) then makes a re-delivered event a constraint violation rather than a double-processed payment, a double-sent message, or a duplicated transaction. This is what makes idempotency STRUCTURAL rather than something each handler remembers to do. A handler that processes first and records second is not idempotent no matter how careful its author was, because the crash window between the two is exactly where providers retry. Providers retry aggressively and legitimately; a re-delivery is normal traffic, not an error condition.';--> statement-breakpoint
COMMENT ON COLUMN "provider_events"."household_id" IS
  'Nullable on purpose, unlike every other household-scoped table. Some callbacks arrive before the household is known: a Stripe event for an unrecognized customer, a Plaid webhook ahead of item attribution. The ledger must record them anyway, because recording is what makes the retry safe.';--> statement-breakpoint

COMMENT ON TABLE "institutions" IS
  'GLOBAL: no household_id, deliberately. A Plaid institution is shared across every household. This is the second convention exception after households (which omits the column because its own id IS the scope). 1.7 must treat both as intentional, not as missing scope.';--> statement-breakpoint
COMMENT ON COLUMN "plaid_items"."sync_cursor" IS
  'Plaid opaque pagination cursor. Never reset casually: clearing it replays the item entire transaction history, which re-delivers every transaction to the pipeline. Reset is a deliberate recovery action, not a retry step.';--> statement-breakpoint
COMMENT ON COLUMN "account_balance_snapshots"."date" IS
  'A BANK DAY, not an instant (data-model-spec §0). One snapshot per account per day, enforced by account_balance_snapshots_account_date_unique. Storing an instant would make two syncs on the same day look like two snapshots and corrupt the Cash Flow engine as_of and reconciliation.';--> statement-breakpoint
COMMENT ON COLUMN "liability_details"."purchase_apr" IS
  'An APR, stored with percentage() as numeric(6,3) rather than money(). Rates are ratios, not dollar amounts; see the percentage() comment in conventions.ts for why the two are deliberately different types.';
