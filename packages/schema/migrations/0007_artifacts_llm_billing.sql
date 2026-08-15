CREATE TYPE "public"."artifact_kind" AS ENUM('briefing', 'monthly_close', 'digest', 'herald', 'year_in_review', 'tax_package', 'correction');--> statement-breakpoint
CREATE TYPE "public"."export_kind" AS ENUM('exit_package', 'tax_package');--> statement-breakpoint
CREATE TYPE "public"."llm_cache_status" AS ENUM('pending', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."llm_cache_type" AS ENUM('adjudication', 'question', 'narrative');--> statement-breakpoint
CREATE TYPE "public"."llm_call_status" AS ENUM('ok', 'parse_failed', 'api_error');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"member_id" uuid,
	"fact_package" jsonb,
	"body" text,
	"sent_message_id" uuid,
	"corrects_artifact_id" uuid,
	"corrected_by_artifact_id" uuid,
	"period" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "export_kind" NOT NULL,
	"r2_key" text NOT NULL,
	"requested_by_member_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_merchant_facts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"merchant_key" text NOT NULL,
	"category_name" text,
	"direction" "transaction_direction",
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"distinct_households" integer DEFAULT 0 NOT NULL,
	"graduated_at" timestamp with time zone,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"cache_type" "llm_cache_type" NOT NULL,
	"pattern_key" text NOT NULL,
	"result" jsonb,
	"status" "llm_cache_status" DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"task" text NOT NULL,
	"merchant_key" text,
	"model" text,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"message_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"status" "llm_call_status" NOT NULL,
	"error_snippet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_price_id" text,
	"plan" "subscription_plan",
	"status" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "artifacts_household_kind_idx" ON "artifacts" USING btree ("household_id","kind");--> statement-breakpoint
CREATE INDEX "artifacts_period_idx" ON "artifacts" USING btree ("household_id","period");--> statement-breakpoint
CREATE INDEX "exports_household_idx" ON "exports" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "global_merchant_facts_key_unique" ON "global_merchant_facts" USING btree ("merchant_key","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_cache_pattern_unique" ON "llm_cache" USING btree ("household_id","cache_type","pattern_key");--> statement-breakpoint
CREATE INDEX "llm_cache_status_claimed_idx" ON "llm_cache" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "llm_call_logs_household_created_idx" ON "llm_call_logs" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_call_logs_task_idx" ON "llm_call_logs" USING btree ("task");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_subscriptions_subscription_unique" ON "stripe_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "stripe_subscriptions_household_idx" ON "stripe_subscriptions" USING btree ("household_id");--> statement-breakpoint
CREATE TRIGGER artifacts_touch_updated_at BEFORE UPDATE ON "artifacts" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER exports_touch_updated_at BEFORE UPDATE ON "exports" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER llm_call_logs_touch_updated_at BEFORE UPDATE ON "llm_call_logs" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER llm_cache_touch_updated_at BEFORE UPDATE ON "llm_cache" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER global_merchant_facts_touch_updated_at BEFORE UPDATE ON "global_merchant_facts" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER stripe_subscriptions_touch_updated_at BEFORE UPDATE ON "stripe_subscriptions" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- === Invariant 6: the safety property is absence ==========================
COMMENT ON TABLE "global_merchant_facts" IS
  'INVARIANT 6. THE SAFETY PROPERTY OF THIS TABLE IS WHAT IT DOES NOT HAVE.

   The Keepers guild substrate. It stores merchant-to-category facts and NOTHING ELSE: SQ TARTINE is a bakery, that ACH pattern is health insurance, this carrier bills semiannually.

   IT MUST NEVER STORE, and has no column for: amounts, balances, or any figure from a household ledger; transaction dates or any date describing household activity; account details (account ids, masks, types, institutions); household_id, member_id, or any household-identifying reference; person-name merchants or peer-to-peer counterparties, which the blocked heuristic flag keeps out.

   ADDING SUCH A COLUMN BREAKS THE INVARIANT; IT DOES NOT EXTEND THE TABLE. The trust sentence this protects is one line: your assistants know your books, what you have told them, and what the world merchants and markets look like. NEVER ANOTHER HOUSEHOLD LIFE. A column here carrying a household figure makes that sentence false for every household at once, which is why the enforcement is absence rather than a filter.

   THE ONLY DATES PERMITTED are record-lifecycle timestamps (created_at, updated_at, graduated_at). Those describe this fact, not a household. distinct_households is a COUNT, not a reference: it carries no identity and is the k-anonymity counter itself.

   SHIPS UNPOPULATED AND ATTORNEY-GATED (ruled 15 Aug 2026). No launch code path writes here, and NOTHING WIRES IT INTO THE FILING HIERARCHY until the attorney review clears. The rung exists in design (household-learned over global-learned over provider guess) and merchant_corrections.source already carries the unused global value, so turning it on later is a flag rather than a migration. For the record: the specs place an explicit attorney gate on the benchmarks network, and this ruling extends the same gate to the guild.

   k-anonymity: distinct_households counts INDEPENDENT households, and nothing graduates below five. graduated_at stays null until then.';--> statement-breakpoint
COMMENT ON COLUMN "global_merchant_facts"."distinct_households" IS
  'The k-anonymity counter. A COUNT, never a reference: it stores how many independent households evidenced this fact, and nothing that could identify any of them. Graduation at five or more.';--> statement-breakpoint
COMMENT ON COLUMN "global_merchant_facts"."blocked" IS
  'The person-name and peer-to-peer heuristic flag. A blocked fact never graduates: "Venmo to Sarah" is not a merchant fact, it is a household life detail wearing a merchant costume.';--> statement-breakpoint

-- === The claim protocol IS the port =======================================
COMMENT ON TABLE "llm_cache" IS
  'PORTED EXACTLY, INCLUDING THE CONCURRENCY PATTERN. The pattern is the point of this table; a port that keeps the columns and loses the protocol has not ported it.

   THE PROTOCOL: a worker claims a pattern_key by inserting or updating to status = pending with claimed_at = now(). Only one worker wins the unique key (household_id, cache_type, pattern_key). The winner makes the model call and writes status = complete with the result; every other worker sees pending and waits for that result rather than making the same call.

   THIS IS THE COST MODEL, NOT AN IMPLEMENTATION DETAIL. Without it, a sync surfacing the same unknown merchant across twenty transactions makes twenty identical adjudication calls. The cache is what keeps cost-per-household inside the margin model M21 measures.

   CLAIMS OLDER THAN 5 MINUTES ARE TREATED AS FAILED, and this half is not optional. A worker that crashes mid-call leaves a pending row nobody will ever complete, and without the timeout that merchant is WEDGED FOREVER for that household: every subsequent worker waits on a claim that is never coming. The timeout converts a crashed claim into a retryable one.

   A stale claim is RECLAIMED, NOT DELETED: the row keeps its key so the unique constraint still serializes the retry.';--> statement-breakpoint
COMMENT ON COLUMN "llm_cache"."claimed_at" IS
  'When the current claim was taken. The reclaim predicate is status = pending AND claimed_at < now() - interval 5 minutes. Null claimed_at on a pending row is itself a bug: a claim without a timestamp cannot expire, which is the wedge this column exists to prevent.';--> statement-breakpoint

-- === Corrections are composed and sent, never silent edits =================
COMMENT ON TABLE "artifacts" IS
  'Every composed deliverable, because A SENT ARTIFACT IS NEVER SILENTLY REVISED.

   A CORRECTION IS COMPOSED AND SENT, NEVER AN EDIT. The mistake doctrine tier-2 mechanics run on this table: correct the books first, then compose a correction artifact that references the original through corrects_artifact_id. The original row is IMMUTABLE. It does not carry a revised_at, and it is never updated in place, because updating it would be the silent revision the doctrine forbids.

   THE HOUSEHOLD-FACING CONSEQUENCE, stated plainly: a household who read a number on Tuesday must be able to find that same number in the record on Friday, even after it was corrected. If the original mutates, the household memory and the system record disagree, AND THE HOUSEHOLD IS RIGHT. A tool that quietly rewrites what it already said teaches a household to distrust their own recollection, which is the opposite of the product.

   The chain is bidirectional: corrects_artifact_id points back to what was wrong, corrected_by_artifact_id points forward to the fix, so either end of a correction can be found from the other without a scan.';--> statement-breakpoint
COMMENT ON COLUMN "artifacts"."corrects_artifact_id" IS
  'Set on a correction artifact, pointing at the original it corrects. Present only on kind = correction.';--> statement-breakpoint
COMMENT ON COLUMN "artifacts"."corrected_by_artifact_id" IS
  'Set on an ORIGINAL that has since been corrected. This is the one field on an original that is written after send, and it is deliberately metadata rather than content: it changes what the record points to, never what the household read.';--> statement-breakpoint

-- === Remaining ============================================================
COMMENT ON TABLE "llm_call_logs" IS
  'Every model call. model and fallback_used pair with the routing chains from Task 0.5: a fallback that nothing records is a cost discovered at the invoice. Feeds M21 cost-per-household measured AGAINST THE MARGIN MODEL, which is why the model actually served is recorded rather than the model requested.';--> statement-breakpoint
COMMENT ON TABLE "exports" IS
  'R2 pointers only. The object lives in R2; this table holds the key and the expiry, so retention work has exactly one place to look for what exists and when it lapses.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_subscriptions"."status" IS
  'TEXT, NOT AN ENUM, deliberately. Stripe owns this vocabulary and extends it; an enum here would turn a Stripe product change into a schema migration on our side. An enum is the house style everywhere else, so its absence would otherwise read as an oversight.';
