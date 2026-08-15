CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');
--> statement-breakpoint
CREATE TYPE "public"."correction_source" AS ENUM('user', 'llm', 'global');
--> statement-breakpoint
CREATE TYPE "public"."queue_reason" AS ENUM('possible_transfer', 'possible_deployment', 'low_confidence', 'first_seen_merchant', 'anomaly', 'unclassified_inflow', 'ambiguous');
--> statement-breakpoint
CREATE TYPE "public"."reimbursement_status" AS ENUM('pending', 'matched', 'written_off');
--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('auto_filed', 'needs_review', 'user_reviewed');
--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('manual', 'learned');
--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('income', 'expense', 'transfer');
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text,
	"conditions" jsonb,
	"actions" jsonb,
	"account_scope" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"source" "rule_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"normalized_merchant_key" text NOT NULL,
	"direction" "transaction_direction",
	"account_type" text,
	"category_id" uuid,
	"subcategory_id" uuid,
	"pl_line" "pl_line",
	"is_transfer" boolean DEFAULT false NOT NULL,
	"band_min" numeric(14, 2),
	"band_max" numeric(14, 2),
	"correction_count" integer DEFAULT 1 NOT NULL,
	"last_corrected_at" timestamp with time zone,
	"source" "correction_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_renames" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"merchant_key" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"plaid_transaction_id" text,
	"date" date NOT NULL,
	"authorized_date" date,
	"amount" numeric(14, 2) NOT NULL,
	"iso_currency" text,
	"merchant_name" text,
	"display_merchant_name" text,
	"normalized_merchant_key" text,
	"original_description" text,
	"direction" "transaction_direction" NOT NULL,
	"category_id" uuid,
	"pl_line" "pl_line",
	"account_type" text,
	"plaid_pfc_primary" text,
	"plaid_pfc_detailed" text,
	"payment_meta" jsonb,
	"counterparties" jsonb,
	"destination" jsonb,
	"pending" boolean DEFAULT false NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"review_state" "review_state" DEFAULT 'auto_filed' NOT NULL,
	"queue_reason" "queue_reason",
	"confidence" "confidence_level",
	"is_transfer" boolean DEFAULT false NOT NULL,
	"transfer_pair_id" uuid,
	"is_reimbursable" boolean DEFAULT false NOT NULL,
	"reimbursement_status" "reimbursement_status",
	"reimbursement_pair_id" uuid,
	"refund_pair_id" uuid,
	"possible_deployment" boolean DEFAULT false NOT NULL,
	"split_parent_id" uuid,
	"is_provisional" boolean DEFAULT false NOT NULL,
	"notes" text,
	"chat_transcript" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "category_rules_household_idx" ON "category_rules" USING btree ("household_id");
--> statement-breakpoint
CREATE INDEX "merchant_corrections_key_idx" ON "merchant_corrections" USING btree ("household_id","normalized_merchant_key","direction","account_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "source_renames_household_key_unique" ON "source_renames" USING btree ("household_id","merchant_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_plaid_transaction_id_unique" ON "transactions" USING btree ("plaid_transaction_id");
--> statement-breakpoint
CREATE INDEX "transactions_household_date_idx" ON "transactions" USING btree ("household_id","date");
--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","date");
--> statement-breakpoint
CREATE INDEX "transactions_needs_review_idx" ON "transactions" USING btree ("household_id","review_state") WHERE "transactions"."review_state" = 'needs_review';
--> statement-breakpoint
CREATE INDEX "transactions_merchant_key_idx" ON "transactions" USING btree ("household_id","normalized_merchant_key","direction");
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_household_id_key" UNIQUE("household_id","id");
--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_household_id_key" UNIQUE("household_id","id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_same_household_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "public"."financial_accounts"("household_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_item_same_household_fk" FOREIGN KEY ("household_id","plaid_item_id") REFERENCES "public"."plaid_items"("household_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER transactions_touch_updated_at BEFORE UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER merchant_corrections_touch_updated_at BEFORE UPDATE ON "merchant_corrections"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER category_rules_touch_updated_at BEFORE UPDATE ON "category_rules"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER source_renames_touch_updated_at BEFORE UPDATE ON "source_renames"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- === The single canonical merchant key ====================================
COMMENT ON COLUMN "transactions"."normalized_merchant_key" IS
  'THE SINGLE CANONICAL MERCHANT KEY. Three separate operations key on this one stored column: correction matching, recurrence inheritance, and refund matching. Computed at WRITE time and stored; never recomputed at read time by a caller. THE BUG THIS FIXES (categorization-spec §11): Base44 had TWO normalizations. Correction keying used a conservative normalize; history keying used a plain lowercase of the display name. The two silently disagreed, so recurrence inheritance and refund matching could miss what correction matching hit. Nothing errored and no test failed; learned records simply stopped applying, invisibly. THE CANONICAL NORMALIZATION, and the only one: (1) lowercase, (2) strip business suffixes (inc, llc, corp, co, ltd, llp, pllc, pc, pa, dba, corporation, company, limited), (3) strip punctuation, (4) collapse whitespace. Deliberately conservative, so learning survives naming drift without absorbing unrelated merchants; anything looser risks one merchant inheriting another classification, so it stays a question instead. The one implementation is normalizeMerchantKey in packages/shared/src/merchant.ts. CHANGING THIS NORMALIZATION BREAKS LEARNED RECORDS RETROACTIVELY: every merchant_correction, commitment, and refund pair was keyed with the rule as it stood when the row was written, so improving it silently orphans a household learned history. That is a migration with a backfill and a ruling, never a refactor. DISPLAY CLEANING IS A DIFFERENT OPERATION and is more aggressive (processor prefixes, phone numbers, store numbers, trailing city and state, title-casing). Never use display output as a key.';--> statement-breakpoint

-- === Direction, and the inclusion doctrine ================================
COMMENT ON TYPE "public"."transaction_direction" IS
  'Three values. "unclassified" is deliberately ABSENT: it existed in Base44 as a legacy value that was never set, and the M9 migration rewrites any survivor through resolveDirection (invariant 9). resolveDirection IS THE SINGLE SOURCE OF TRUTH for the stored value, applied last in the per-transaction pipeline (categorization-spec §8): transfer if is_transfer; income if the category line is income; expense for all other categorized transactions; income for UNCATEGORIZED INFLOWS; expense for uncategorized outflows. THE INCLUSION DOCTRINE, the rule a reader will most want to argue with: an unconfirmed inflow counts as INCOME while it awaits review. It is labeled, and the MarginSheet shows the transparency counterfactual (what Kept and Margin would be if every uncategorized inflow turned out to be a transfer). Holding inflows out until confirmed would understate income and make the household total wrong in the direction that flatters. Right in total, pending in breakdown. ONE DELIBERATE CARVE-OUT: unresolved inflows count on the MarginSheet but are excluded from the materiality floor, which requires review_state != needs_review. A floor inflated by unresolved deposits would suppress the very questions that resolve them.';--> statement-breakpoint

-- === Review state ==========================================================
COMMENT ON TYPE "public"."review_state" IS
  'Three real states in the pipeline. auto_filed is the DEFAULT OUTCOME: the transaction was filed by the pipeline without a question. needs_review is THE QUEUE: the question machinery reads this state with queue_reason. user_reviewed is AUTHORITATIVE AND UNTOUCHABLE: no automated pass may modify a user_reviewed transaction, ever (categorization-spec invariant 1). That invariant depends on the distinction between auto_filed and user_reviewed being real, which is why auto_filed is a state rather than the absence of one.';--> statement-breakpoint

-- === Queue reason, and a resolved spec conflict ============================
COMMENT ON TYPE "public"."queue_reason" IS
  'Seven values. A SPEC CONFLICT WAS RESOLVED HERE, recorded so nobody re-litigates it: ledger-spec §9 flagged that the code CATEGORICAL_REASONS contained only "ambiguous", which was absent from the older schema enum, and said to verify against production data before porting. data-model-spec §3 ruled that the enum now includes ambiguous and that the stale schema enum loses. Under the 15 Aug ruling that no legacy specs survive, data-model-spec is authoritative, so ambiguous ships as a real value. Categorical grouping (queue_reason = ambiguous) groups by merchant and direction only, ignoring amount.';--> statement-breakpoint

COMMENT ON COLUMN "transactions"."account_type" IS
  'Denormalized from the account on purpose. Base44 computed it at runtime for correction keying, which made the key depend on the account current state; a learned record must key on what was true when it was written. Stored here so merchant_corrections can match on normalizedMerchant|direction|accountType stably.';--> statement-breakpoint
COMMENT ON COLUMN "transactions"."refund_pair_id" IS
  'The matched prior purchase for a refund, mirroring reimbursement_pair_id. Lets a drill-down say "refund of the June 3 purchase" rather than showing an unexplained negative. A refund nets against spending in the month the refund lands.';--> statement-breakpoint
COMMENT ON CONSTRAINT "transactions_account_same_household_fk" ON "transactions" IS
  'INVARIANT 1, second link. Carries household_id into the reference so a transaction cannot point at another household account. With financial_accounts_item_same_household_fk this holds transitively across transaction, account, and item: the invariant is UNREPRESENTABLE rather than merely detectable.';--> statement-breakpoint
COMMENT ON CONSTRAINT "financial_accounts_item_same_household_fk" ON "financial_accounts" IS
  'INVARIANT 1, first link. An account cannot sit under another household item. The simple plaid_item_id foreign key carries the RESTRICT-on-delete semantics; this one carries household agreement. Both are kept because they express different constraints.';--> statement-breakpoint

COMMENT ON COLUMN "merchant_corrections"."band_min" IS
  'Lower bound of a banded correction for opaque deposit merchants (brain spec). A correction with a band applies only inside it; the deposit-cluster machinery mints the band from the cluster it asked about. NULL band means all amounts, which is the pre-band behavior.';--> statement-breakpoint
COMMENT ON TYPE "public"."correction_source" IS
  'user and llm are live. "global" is DEFINED BUT UNUSED at launch: the column is ready for the Keepers guild, whose graduation path requires k-anonymity across households (data-model-spec §7). No launch code path writes global. Same posture as member_role.contributor.';
