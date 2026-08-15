-- Reverses 0006_conversation_b.sql. The view drops before its base table.
DROP VIEW IF EXISTS "known_context_composable";

DROP TABLE IF EXISTS "receivables";
DROP TABLE IF EXISTS "insight_ledger";
DROP TABLE IF EXISTS "calibration_bands";
DROP TABLE IF EXISTS "condition_states";
DROP TABLE IF EXISTS "handoffs";
DROP TABLE IF EXISTS "decision_journal";
DROP TABLE IF EXISTS "tag_members";
DROP TABLE IF EXISTS "tags";
DROP TABLE IF EXISTS "standing_instructions";
DROP TABLE IF EXISTS "tombstones";
DROP TABLE IF EXISTS "known_context";

DROP TYPE IF EXISTS "public"."receivable_state";
DROP TYPE IF EXISTS "public"."insight_source";
DROP TYPE IF EXISTS "public"."insight_route";
DROP TYPE IF EXISTS "public"."demotion_reason";
DROP TYPE IF EXISTS "public"."calibration_state";
DROP TYPE IF EXISTS "public"."condition_state_value";
DROP TYPE IF EXISTS "public"."handoff_state";
DROP TYPE IF EXISTS "public"."decision_outcome";
DROP TYPE IF EXISTS "public"."tag_certainty";
DROP TYPE IF EXISTS "public"."instruction_type";
DROP TYPE IF EXISTS "public"."known_context_state";
DROP TYPE IF EXISTS "public"."known_context_type";
