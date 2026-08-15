CREATE TYPE "public"."cadence" AS ENUM('weekly', 'biweekly', 'semimonthly', 'monthly', 'every_other_month', 'quarterly', 'semiannual', 'annual', 'irregular');--> statement-breakpoint
CREATE TYPE "public"."commitment_direction" AS ENUM('inflow', 'outflow');--> statement-breakpoint
CREATE TYPE "public"."commitment_source" AS ENUM('plaid_recurring', 'census', 'liability_detail', 'household_stated');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."goal_set_with" AS ENUM('onboarding', 'conversation', 'annual_session');--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"merchant_key" text NOT NULL,
	"direction" "commitment_direction" NOT NULL,
	"account_id" uuid,
	"cadence" "cadence" NOT NULL,
	"expected_amount" jsonb,
	"next_expected_date" date,
	"window_days" integer,
	"category_id" uuid,
	"pl_line" "pl_line",
	"source" "commitment_source" NOT NULL,
	"status" "commitment_status" DEFAULT 'active' NOT NULL,
	"last_matched_transaction_id" uuid,
	"consecutive_misses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commitments_stream_unique" UNIQUE NULLS NOT DISTINCT("household_id","merchant_key","direction","cadence","account_id")
);
--> statement-breakpoint
CREATE TABLE "household_goals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"margin_target_pct" numeric(6, 3),
	"life_happens_target" jsonb,
	"annual_plan" jsonb,
	"set_with" "goal_set_with",
	"updated_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "commitments_household_status_idx" ON "commitments" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "commitments_next_expected_idx" ON "commitments" USING btree ("household_id","next_expected_date");--> statement-breakpoint
CREATE UNIQUE INDEX "household_goals_household_unique" ON "household_goals" USING btree ("household_id");--> statement-breakpoint
CREATE TRIGGER commitments_touch_updated_at BEFORE UPDATE ON "commitments"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER household_goals_touch_updated_at BEFORE UPDATE ON "household_goals"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- === Source authority ======================================================
COMMENT ON TYPE "public"."commitment_source" IS
  'ASCENDING AUTHORITY. Higher overrides lower PER STREAM. (1) plaid_recurring: day-one bootstrap, a commitments list exists at first sync before the census runs. (2) census (M15): the long cadences Plaid misses, every-other-month insurance, quarterly estimateds, annual renewals; reconciles against Recurring rather than duplicating and may correct a stream cadence. (3) liability_detail: exact statement balances and due dates for card autopays, where the statement is fact and the average is inference. (4) household_stated: a known_context plan with teeth ("the trip is in November") entering as a dated commitment; ALWAYS WINS, matching the filing hierarchy local-always-wins rule. "Per stream" is the load-bearing phrase: authority is compared within one upsert key, never across the table, because a census correction to the electric bill says nothing about the mortgage. The ordering has ONE implementation, COMMITMENT_SOURCE_AUTHORITY in packages/shared/src/commitments.ts; comparing sources by inlining a different order somewhere is how two writers end up disagreeing about which fact wins.';--> statement-breakpoint

-- === The upsert key, and why NULLS NOT DISTINCT ============================
COMMENT ON CONSTRAINT "commitments_stream_unique" ON "commitments" IS
  'THE UPSERT KEY: (household_id, merchant_key, direction, cadence, account_id). A household moving an autopay between accounts RE-ATTRIBUTES the existing commitment rather than creating a duplicate: the match runs on the stream, and account is confirmed by matched history. An account change within the amount band is re-attribution, not a miss (projection-spec §6).

   NULLS NOT DISTINCT IS DELIBERATE. Postgres default behavior is the surprising one: NULLs in a unique constraint are treated as DISTINCT, so without this clause two commitments for the same merchant, direction, and cadence with an unknown account would BOTH be permitted. That is exactly the duplicate this key exists to prevent, and it would appear on day one, when accounts are least known: Plaid Recurring streams arrive before their account is learned, so a first sync would mint duplicate commitments for every stream it could not yet attribute.

   WHAT BREAKS IF THIS IS CHANGED: removing NULLS NOT DISTINCT silently re-enables day-one duplicate commitments. They would not error; the household would simply see the same obligation projected twice, and the watcher would fire twice for one missed payment. The alternative considered and rejected was a sentinel UUID for "unknown account", which pollutes the data model permanently to route around index semantics. If you are reading this constraint and it looks unusual, it is unusual on purpose.';--> statement-breakpoint

COMMENT ON TYPE "public"."commitment_direction" IS
  'inflow or outflow. THIS IS NOT transaction_direction, which is income, expense, or transfer. Two adjacent columns both named "direction" with different value sets is a real trap; a join or a copied filter across the two is silently wrong rather than an error.';--> statement-breakpoint
COMMENT ON TYPE "public"."transaction_direction" IS
  'Three values. "unclassified" is deliberately ABSENT: it existed in Base44 as a legacy value that was never set, and the M9 migration rewrites any survivor through resolveDirection (invariant 9). NOTE: this is NOT commitment_direction, which is inflow or outflow. resolveDirection IS THE SINGLE SOURCE OF TRUTH for the stored value, applied last in the per-transaction pipeline (categorization-spec §8): transfer if is_transfer; income if the category line is income; expense for all other categorized transactions; income for UNCATEGORIZED INFLOWS; expense for uncategorized outflows. THE INCLUSION DOCTRINE, the rule a reader will most want to argue with: an unconfirmed inflow counts as INCOME while it awaits review. It is labeled, and the MarginSheet shows the transparency counterfactual (what Kept and Margin would be if every uncategorized inflow turned out to be a transfer). Holding inflows out until confirmed would understate income and make the household total wrong in the direction that flatters. Right in total, pending in breakdown. ONE DELIBERATE CARVE-OUT: unresolved inflows count on the MarginSheet but are excluded from the materiality floor, which requires review_state != needs_review. A floor inflated by unresolved deposits would suppress the very questions that resolve them.';--> statement-breakpoint

COMMENT ON COLUMN "commitments"."merchant_key" IS
  'The same canonical key as transactions.normalized_merchant_key, produced by normalizeMerchantKey in packages/shared. A commitment keyed by any other normalization will not match the transactions it is supposed to track.';--> statement-breakpoint
COMMENT ON TABLE "commitments" IS
  'Projected obligations and expected inflows (projection-spec §6). THE MATERIALITY GATE DOES NOT APPLY HERE: it gates questions, not math. A $12 subscription belongs in the projection and never earns a text. Lifecycle: a posting transaction inside the window matches, rolls next_expected_date forward, and confirms account; a missed window increments consecutive_misses; two consecutive misses pause the commitment, and paused commitments leave projections but stay visible.';--> statement-breakpoint
COMMENT ON COLUMN "commitments"."expected_amount" IS
  'jsonb because it is genuinely polymorphic: {kind: "fixed", amount} or {kind: "banded", band_min, band_max}. A price change is a match outside the band; an account change within the band is re-attribution, not a miss.';--> statement-breakpoint

-- === The Margin target, and why its nullability is a gate input ============
COMMENT ON COLUMN "household_goals"."margin_target_pct" IS
  'NULLABLE, AND THE NULL IS LOAD-BEARING. NULL means the household has not stated a Margin target. It does NOT mean 20 percent, and it does not mean "use the default". When null, the Method 20 percent floor is CITED AS THE METHOD ("The Method states 20% as the floor"), never imposed as theirs. When set, the household own number governs and the Method figure is not the measure.

   THIS IS AN ADVICE-GATE CONCERN, NOT A DISPLAY PREFERENCE. The distinction is what makes the difference computable at compose time. FAILS the gate: "You should hit 20%." PASSES the gate: "The Method states 20% as the floor." The first names an action with money and asserts a target the household never adopted; the second states a fact about the Method. A composer cannot tell those apart without knowing whether this column is null, so the nullability is the input to a compliance decision rather than a rendering choice.

   On track means the projection measured against Household Goals. A household with no stated goals is measured against the Method published floor, cited as the Method per the carve-out (projection-spec §2).';--> statement-breakpoint
COMMENT ON TABLE "household_goals" IS
  'What the household has committed to (projection-spec §2). A first-class entity, not a scattering of known_context flags: known_context goal entries link here. Set with MyCFO at onboarding, in conversation, or definitively at the Annual Planning Session. One row per household. Goals never self-expire; one revisit at the Annual Planning Session.';--> statement-breakpoint
COMMENT ON COLUMN "household_goals"."annual_plan" IS
  'The Annual Plan (2027). Shape deliberately unmodeled: it lands with Module 11, and inventing its structure now would be a guess that a later migration has to undo.';--> statement-breakpoint
COMMENT ON COLUMN "household_goals"."life_happens_target" IS
  'jsonb: {months_chosen, dollar_target, computed_at}. Months are chosen by the household; the dollar target is computed by MyCFO per the resilience-number doctrine. Storing both plus the computation time keeps the stated input and the derived figure distinguishable.';
