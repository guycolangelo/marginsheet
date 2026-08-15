CREATE TYPE "public"."brain" AS ENUM('mykeeper', 'mycfo');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."dispatch_state" AS ENUM('pending', 'answered', 'clarifying', 'returned_to_app', 'conflicted');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('composed', 'held_shadow', 'sent', 'failed', 'suppressed_no_gate');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"brain" "brain" NOT NULL,
	"direction" "message_direction" NOT NULL,
	"channel" "channel" NOT NULL,
	"provider_message_id" text,
	"message_class" text,
	"body" text,
	"fact_package" jsonb,
	"fact_package_version" text,
	"gate_result" jsonb,
	"model_used" text,
	"fallback_flag" boolean DEFAULT false NOT NULL,
	"status" "message_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sent_requires_gate" CHECK ("messages"."status" is distinct from 'sent' or "messages"."gate_result" is not null)
);
--> statement-breakpoint
CREATE TABLE "question_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"group_key" text,
	"transaction_ids" uuid[],
	"question_text" text,
	"best_guess" jsonb,
	"answer_space" jsonb,
	"sent_to" jsonb,
	"state" "dispatch_state" DEFAULT 'pending' NOT NULL,
	"answered_by_member_id" uuid,
	"answer" jsonb,
	"resolved_at" timestamp with time zone,
	"clarification_count" integer DEFAULT 0 NOT NULL,
	"conflict" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"brain" "brain" NOT NULL,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_message_id_unique" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "messages_household_created_idx" ON "messages" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_member_brain_created_idx" ON "messages" USING btree ("member_id","brain","created_at");--> statement-breakpoint
CREATE INDEX "question_dispatches_household_state_idx" ON "question_dispatches" USING btree ("household_id","state");--> statement-breakpoint
CREATE INDEX "question_dispatches_group_key_idx" ON "question_dispatches" USING btree ("household_id","group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_member_brain_unique" ON "threads" USING btree ("member_id","brain");--> statement-breakpoint
CREATE INDEX "threads_household_idx" ON "threads" USING btree ("household_id");--> statement-breakpoint
CREATE TRIGGER threads_touch_updated_at BEFORE UPDATE ON "threads"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER messages_touch_updated_at BEFORE UPDATE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER question_dispatches_touch_updated_at BEFORE UPDATE ON "question_dispatches"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- === Invariant 7: no gate, no send ========================================
COMMENT ON CONSTRAINT "messages_sent_requires_gate" ON "messages" IS
  'INVARIANT 7. THE ADVICE GATE NEVER FAILS OPEN, and this constraint is what makes that structural rather than remembered. A row cannot reach status = sent with a null gate_result. Not by a code path that forgot, not by a retry that skipped the check, not by a migration backfill, not by a support tool. The database refuses the write. "No pass, no send, ever" is the locked rule, and a CHECK constraint is the only version of it that survives an author who has not read the spec. DEGRADE-TO-FIXTURE STILL PRODUCES A GATE_RESULT: a canonical fixture is a GATED OUTCOME, not a bypass. Fixtures are pre-cleared by definition, so the gate ran, reached its retry cap of two recompositions, and chose the safe version; the row records that with degraded_to_fixture true and the attempt count. A fixture send with a null gate_result is a bug in the send path, and this constraint catches it rather than shipping it. Statuses other than sent are deliberately unconstrained: composed and held_shadow may precede the gate, and suppressed_no_gate is the terminal state when the judge chain itself was unavailable (the advice_gate_judge chain no_send behavior, Task 0.5). That status exists so the absence of a gate is recorded as a decision rather than inferred from a missing row.';--> statement-breakpoint
COMMENT ON COLUMN "messages"."gate_result" IS
  'jsonb: {lint_pass, judge_pass, attempts, degraded_to_fixture}. Recorded BEFORE send, never after: a message written after the channel accepted it cannot prove the gate ran first. Both gate layers are mandatory and both are recorded, because a message that passed the deterministic lint and was never judged is not a gated message.';--> statement-breakpoint
COMMENT ON TYPE "public"."message_status" IS
  'suppressed_no_gate is the terminal state when the advice-gate judge chain was unavailable (Sonnet then Haiku then no send, ever). It is a recorded decision, not an error: the message was composed and deliberately not sent because nothing could gate it. Distinguishing it from failed matters, because failed invites a retry and this does not.';--> statement-breakpoint

-- === The traceability pairing ==============================================
COMMENT ON COLUMN "messages"."fact_package" IS
  'THE AUDIT TRAIL FOR TRACEABILITY. The exact package the composer received, stored on the same row as the body it produced. THE PAIRING IS THE POINT: storing the package alone proves what was available, storing the body alone proves what was said, and storing both on one row makes the traceability invariant checkable AFTER THE FACT rather than only at compose time. Any number, date, or name in the body must trace to a source field in the package; one that cannot is a hard failure of the same severity as an advice-gate failure. This is what lets a question months later ("where did that $940 come from?") be answered from the record instead of from a re-run that may not reproduce, because the package that actually composed the message may not be reconstructible from current books: the books have moved. Model memory is banned as a source for any current figure, rate, limit, or deadline; a number enters prose only from the books, from known_context, or from a named reference source. A sourced estimate arrives here as a computed fact with its source label, and the check reads that label rather than trusting the prose.';--> statement-breakpoint
COMMENT ON COLUMN "messages"."fact_package_version" IS
  'The package shape this row was written under. A stored package is only interpretable against its own version: without this, a traceability check years later reads an old package with new field expectations and reports failures that are really schema drift.';--> statement-breakpoint

-- === First answer wins, with a receipt =====================================
COMMENT ON TABLE "question_dispatches" IS
  'The conversation ABOUT a queue item. The queue itself stays derived from transactions.review_state plus queue_reason: one source of truth.

   FIRST ANSWER WINS, WITH A RECEIPT. An open question goes to every full member as an individual text (same question, separate threads). The first answer resolves it; every other member gets a one-line closure ("Sarah answered, filed as the Hendersons gift").

   THE CLOSURE RECEIPT IS NOT OPTIONAL. The losing writer composes and sends it. Silence to the other member is a FAILURE, not a graceful no-op: a household where one spouse answers and the other never learns it was handled is the "no secrets between principals" rule breaking, and it breaks quietly, which is worse. A losing conditional update that returns zero rows is not the end of the work; it is the start of the receipt.

   TWO MEMBERS ANSWERING IN THE SAME SECOND MUST PRODUCE ONE RESOLUTION AND ONE CLOSURE RECEIPT, NEVER A DOUBLE-WRITE. The mechanism is a conditional update, not a read-then-write: UPDATE question_dispatches SET state = ..., answered_by_member_id = ..., answer = ..., resolved_at = now() WHERE id = ... AND state = pending RETURNING id. Exactly one concurrent writer gets a row back; the loser gets zero rows and composes the closure instead of a second resolution. A read-then-write, or an unconditional update, mints two corrections and two receipts for one question, and the household watches their books change twice.

   CONFLICTING ANSWERS ARE NEVER SILENTLY ADJUDICATED. Two different answers inside the window move the row to state = conflicted and record both in the conflict column with both names. MyKeeper replies to BOTH members, names both answers, and asks which to file. The system does not pick, does not average, and does not prefer the earlier one: a household disagreement about their own money is theirs to resolve, and hiding it would be the tool having an opinion about the people.';--> statement-breakpoint
COMMENT ON COLUMN "question_dispatches"."best_guess" IS
  'INTERNAL, NEVER COMPOSABLE. Carries the candidate category and the internal band label for routing and logging. The lint layer fails any message containing it: the household hired a bookkeeper, not a systems postmortem.';--> statement-breakpoint
COMMENT ON COLUMN "question_dispatches"."clarification_count" IS
  'Capped at 1 BY CODE, not by a constraint. Recorded here so a reader looking for the enforcement does not conclude the cap is missing. One clarification, then the item returns to the app rather than becoming a conversation.';--> statement-breakpoint
COMMENT ON COLUMN "question_dispatches"."conflict" IS
  'Both answers and both names, surfaced rather than adjudicated. Populated when state = conflicted. The presence of a row here is a signal to compose to BOTH members; an empty conflict on a conflicted row is a bug in the resolution path.';--> statement-breakpoint

-- === Threads =============================================================
COMMENT ON TABLE "threads" IS
  'One per (member, brain). THREAD STATE IS A TIMESTAMP, NOT A MACHINE: the 4-hour greeting window is computed from last_activity_at in code. Adding a state column here would reinvent something the spec deliberately declined, and would create a second place for conversation state to disagree with itself.';--> statement-breakpoint
COMMENT ON COLUMN "messages"."provider_message_id" IS
  'Unique per provider; the inbound dedup key. Works WITH provider_events from migration 0002 rather than duplicating it: provider_events deduplicates webhook deliveries, this deduplicates messages. A household is never asked the same question twice because a webhook retried.';
