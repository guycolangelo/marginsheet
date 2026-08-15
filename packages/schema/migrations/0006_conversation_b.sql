CREATE TYPE "public"."calibration_state" AS ENUM('asking', 'silent');--> statement-breakpoint
CREATE TYPE "public"."condition_state_value" AS ENUM('fired', 'acknowledged', 'resolved', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('adopted', 'passed', 'undecided');--> statement-breakpoint
CREATE TYPE "public"."demotion_reason" AS ENUM('accuracy', 'double_fault');--> statement-breakpoint
CREATE TYPE "public"."handoff_state" AS ENUM('open', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."insight_route" AS ENUM('fact_package', 'watcher', 'elicitation', 'wait');--> statement-breakpoint
CREATE TYPE "public"."insight_source" AS ENUM('census', 'monthly_maintenance');--> statement-breakpoint
CREATE TYPE "public"."instruction_type" AS ENUM('threshold', 'timing', 'routing', 'watch_tag');--> statement-breakpoint
CREATE TYPE "public"."known_context_state" AS ENUM('active', 'dormant', 'expired');--> statement-breakpoint
CREATE TYPE "public"."known_context_type" AS ENUM('goal', 'plan', 'fact', 'worry', 'preference', 'decision');--> statement-breakpoint
CREATE TYPE "public"."receivable_state" AS ENUM('open', 'matched', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."tag_certainty" AS ENUM('confirmed', 'maybe');--> statement-breakpoint
CREATE TABLE "calibration_bands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"band_label" text NOT NULL,
	"guesses" integer DEFAULT 0 NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"trailing_window" jsonb,
	"state" "calibration_state" DEFAULT 'asking' NOT NULL,
	"graduated_at" timestamp with time zone,
	"demoted_at" timestamp with time zone,
	"demotion_reason" "demotion_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "condition_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"subject" jsonb NOT NULL,
	"subject_hash" text GENERATED ALWAYS AS (md5(subject::text)) STORED,
	"state" "condition_state_value" DEFAULT 'fired' NOT NULL,
	"first_fired_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"followup_sent" boolean DEFAULT false NOT NULL,
	"fire_ahead_window" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condition_states_subject_unique" UNIQUE("household_id","rule_id","subject_hash")
);
--> statement-breakpoint
CREATE TABLE "decision_journal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"question_as_asked" text,
	"arithmetic_shown" jsonb,
	"decision" "decision_outcome" DEFAULT 'undecided' NOT NULL,
	"decided_at" timestamp with time zone,
	"related_commitment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"from_brain" "brain" NOT NULL,
	"to_brain" "brain" NOT NULL,
	"question_summary" text,
	"source_message_id" uuid,
	"state" "handoff_state" DEFAULT 'open' NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"finding_type" text NOT NULL,
	"payload" jsonb,
	"route" "insight_route",
	"surfaced_at" timestamp with time zone,
	"source" "insight_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "known_context" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"type" "known_context_type" NOT NULL,
	"text" text NOT NULL,
	"said_by_member_id" uuid,
	"said_at" timestamp with time zone,
	"source_message_id" uuid,
	"state" "known_context_state" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"teeth" jsonb,
	"household_goals_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"expected_amount" numeric(14, 2),
	"source_transaction_id" uuid,
	"description" text,
	"expected_by" date,
	"state" "receivable_state" DEFAULT 'open' NOT NULL,
	"matched_deposit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_instructions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type" "instruction_type" NOT NULL,
	"parameters" jsonb,
	"stated_in_message_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"merchant_key" text,
	"transaction_id" uuid,
	"certainty" "tag_certainty" DEFAULT 'confirmed' NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_member_id" uuid,
	"watch" boolean DEFAULT false NOT NULL,
	"watch_instruction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tombstones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"deleted_by_member_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_bands_household_label_unique" ON "calibration_bands" USING btree ("household_id","band_label");--> statement-breakpoint
CREATE INDEX "condition_states_household_state_idx" ON "condition_states" USING btree ("household_id","state");--> statement-breakpoint
CREATE INDEX "decision_journal_household_idx" ON "decision_journal" USING btree ("household_id","decided_at");--> statement-breakpoint
CREATE INDEX "handoffs_household_state_idx" ON "handoffs" USING btree ("household_id","state");--> statement-breakpoint
CREATE INDEX "insight_ledger_household_route_idx" ON "insight_ledger" USING btree ("household_id","route");--> statement-breakpoint
CREATE INDEX "known_context_household_state_idx" ON "known_context" USING btree ("household_id","state");--> statement-breakpoint
CREATE INDEX "known_context_household_type_idx" ON "known_context" USING btree ("household_id","type");--> statement-breakpoint
CREATE INDEX "receivables_household_state_idx" ON "receivables" USING btree ("household_id","state");--> statement-breakpoint
CREATE INDEX "standing_instructions_member_idx" ON "standing_instructions" USING btree ("member_id","active");--> statement-breakpoint
CREATE INDEX "tag_members_tag_idx" ON "tag_members" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_household_name_unique" ON "tags" USING btree ("household_id","name");--> statement-breakpoint
CREATE INDEX "tombstones_entity_idx" ON "tombstones" USING btree ("entity_table","entity_id");--> statement-breakpoint
CREATE TRIGGER known_context_touch_updated_at BEFORE UPDATE ON "known_context" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER tombstones_touch_updated_at BEFORE UPDATE ON "tombstones" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER standing_instructions_touch_updated_at BEFORE UPDATE ON "standing_instructions" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER tags_touch_updated_at BEFORE UPDATE ON "tags" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER tag_members_touch_updated_at BEFORE UPDATE ON "tag_members" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER decision_journal_touch_updated_at BEFORE UPDATE ON "decision_journal" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER handoffs_touch_updated_at BEFORE UPDATE ON "handoffs" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER condition_states_touch_updated_at BEFORE UPDATE ON "condition_states" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER calibration_bands_touch_updated_at BEFORE UPDATE ON "calibration_bands" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER insight_ledger_touch_updated_at BEFORE UPDATE ON "insight_ledger" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER receivables_touch_updated_at BEFORE UPDATE ON "receivables" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- === known_context: what the household said, nothing else =================
COMMENT ON TABLE "known_context" IS
  'What the household said. NOTHING ELSE.

   NO CONFIDENCE FIELD, EVER (invariant 3), and the absence IS the enforcement. A confidence score on a household stated fact is the tool having an opinion about whether they meant it. They said the trip is in November; scoring that 0.82 is not humility, it is the instrument second-guessing a person about their own life. If it is in this table, a human stated it, which is exactly why prose cites it flatly and without hedging. Patterns live in calibration_bands. Meanings live in question_dispatches. The inference ladder stays outside this table entirely. Anyone reaching for a confidence column here has a fact that belongs in one of those two places instead.

   LIFECYCLE, three states. active: cited normally. dormant: STOP VOLUNTEERING, NEVER STOP KNOWING, so a dormant entry is still answerable ("what did the trip end up costing?") and simply is not raised unprompted. expired: PLANS SELF-EXPIRE ON THEIR OWN CALENDAR, so the October trip goes dormant on November 1 with nobody saying anything and the attribution rule stops citing it, which kills the confidently-stale-cause failure STRUCTURALLY rather than by vigilance. GOALS NEVER SELF-EXPIRE: they get one revisit at the Annual Planning Session, never a nag, never unprompted mid-year commentary.

   CONTRADICTION SUPERSEDES, NEVER ACCUMULATES. "The trip moved to November" makes the old entry dormant with a superseded_by_id link. The household is never cited a belief they already corrected, which would be a tier three mistake wearing a memory costume.';--> statement-breakpoint

COMMENT ON COLUMN "known_context"."deleted_at" IS
  'INVARIANT 4. A deleted entry NEVER appears in any fact-package query. DELETION IS SOFT PRECISELY SO THE EXCLUSION IS PROVABLE: a hard delete leaves nothing to assert against, because the row is gone, every query trivially omits it, and the invariant becomes untestable rather than satisfied. Keeping the row with a deleted_at, plus a tombstones entry for the audit trail, makes the exclusion a claim a test can falsify. DELETED MEANS THE STAFF NEVER BRINGS IT UP, NOT THAT THE RECORD NEVER EXISTED: the household asked to be forgotten about a thing, not to have history rewritten. Hard deletion exists only through the retention and privacy path (M20).';--> statement-breakpoint

COMMENT ON COLUMN "known_context"."teeth" IS
  'Machine consequences of a stated fact: routing flags, watch windows, expected amounts, commitment_id links, household_goals_id links. Nullable, because most context has no teeth. Teeth are what turn "the trip is in November" into a dated commitment; the text stays the household words and the teeth stay the machine reading of them, deliberately separate so neither rewrites the other.';--> statement-breakpoint

-- === The composable view, and the test M2 inherits =========================
CREATE VIEW "known_context_composable" AS
  SELECT * FROM "known_context"
   WHERE "deleted_at" IS NULL
     AND "state" <> 'expired';--> statement-breakpoint

COMMENT ON VIEW "known_context_composable" IS
  'THE ONLY SURFACE A FACT PACKAGE MAY READ. Invariant 4 lives here rather than in every caller: a query against the base table can forget the deleted_at clause, and a fact package built from the base table would silently re-raise something the household asked to be forgotten. Reading known_context directly in composition is the bug this view exists to make unnecessary.

   REQUIREMENT M2 INHERITS (ruled 15 Aug 2026): fact-package assembly must carry a test asserting that NO fact-package query path reads known_context directly. A view nobody is required to use is a suggestion, not a control. Whoever builds M2 owns that test, and it belongs beside the traceability checks rather than in the schema package, because the thing being asserted is the assembler behavior rather than the shape of this object.

   The base table stays available for the app own management surfaces (a household editing what they told the staff) and for M20 retention work. Composition is the one caller that must not touch it.';--> statement-breakpoint

-- === The watcher dedup memory =============================================
COMMENT ON TABLE "condition_states" IS
  'THE WATCHER DEDUP MEMORY. A condition persisting across many syncs produces ONE message, and a second only on material worsening.

   THE UNIQUE KEY (household_id, rule_id, subject_hash) IS WHAT MAKES THAT STRUCTURAL rather than each rule remembering. Without it every rule author would implement their own "have I already said this" check, and a household would hear about one low balance six times because one rule got it wrong. Six syncs, one message, by construction.

   States: fired, acknowledged, resolved, escalated. The one exception to silence is silence with money at stake: an UNACKNOWLEDGED material alert gets EXACTLY ONE follow-up as the fire-ahead window closes, recorded in followup_sent, then the condition rides to resolution and appears in the close. One follow-up, never a drumbeat.';--> statement-breakpoint

COMMENT ON COLUMN "condition_states"."subject_hash" IS
  'GENERATED ALWAYS from subject. Not writable, deliberately: two writers hashing the same subject differently would defeat the unique key and produce exactly the duplicate messages it exists to prevent. Same class of guarantee as the composite household foreign keys, except the database can enforce this one entirely by itself.';--> statement-breakpoint
COMMENT ON COLUMN "condition_states"."fire_ahead_window" IS
  'Snapshotted per row because each rule carries its own: a cannot-cover warning is actionable at three to five days out and merely alarming at twelve hours. The window in force when the condition fired is what the follow-up timing must honor, so it is stored rather than re-read from current rule config.';--> statement-breakpoint

-- === Remaining doctrine ===================================================
COMMENT ON TABLE "standing_instructions" IS
  'Per-member, no exceptions: preferences belong to a person, not a household. THE BROADCAST FLOOR IS CONFIG, NOT A ROW HERE: no standing instruction can silence a message class on the floor list. A household member may tune what they hear; they cannot turn off the things that exist to prevent a surprise.';--> statement-breakpoint
COMMENT ON COLUMN "tag_members"."excluded" IS
  'An exclusion is a membership row, not a missing one. The household said this merchant is NOT part of the tag, and that answer is remembered forever so the question is never asked twice. A deleted row would lose the answer and re-ask.';--> statement-breakpoint
COMMENT ON TABLE "decision_journal" IS
  'MEMORY, NEVER SCORECARD. Records the question as asked, the arithmetic shown, and what the household decided. It exists so a later conversation can reference a decision the household already made, not so the system can tally their record. Surfacing rules are composition-side; nothing here ranks or grades a decision, and "you passed on that last time" is not a sentence this table exists to enable.';--> statement-breakpoint
COMMENT ON TABLE "handoffs" IS
  'The 3-minute handoff budget is measured between created_at and fulfilled_at. Two timestamps, no timer: the budget is an observable property of the record rather than a countdown something has to maintain.';--> statement-breakpoint
COMMENT ON TABLE "receivables" IS
  'Household AR beyond the transaction flags. SCHEMA SHIPS NOW, deliberately: at launch rows are created only from reimbursable transactions, and elicitation-created rows arrive post-launch with NO MIGRATION. Same lesson as members.role: a column that ships early is a flag, a column that ships late is a migration.';--> statement-breakpoint
COMMENT ON TABLE "calibration_bands" IS
  'The graduation loop ledger, per (household, band). Graduation to silent filing is never one-way BY CONSTRUCTION: graduated bands keep a correction surface through the digest spot-check sampling, so demotion has a signal to run on. demotion_reason distinguishes accuracy drift from a double fault.';--> statement-breakpoint
COMMENT ON TABLE "insight_ledger" IS
  'Census and close-maintenance findings, DECOUPLED FROM DELIVERY. surfaced_at stays null until a finding is actually used, so a finding that is never surfaced is visible as such rather than lost. route records where it was meant to go; wait is a legitimate route.';
