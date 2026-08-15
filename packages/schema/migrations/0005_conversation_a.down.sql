-- Reverses 0005_conversation_a.sql.
DROP TABLE IF EXISTS "question_dispatches";
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "threads";

DROP TYPE IF EXISTS "public"."dispatch_state";
DROP TYPE IF EXISTS "public"."message_status";
DROP TYPE IF EXISTS "public"."channel";
DROP TYPE IF EXISTS "public"."message_direction";
DROP TYPE IF EXISTS "public"."brain";
