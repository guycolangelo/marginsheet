-- Reverses 0007_artifacts_llm_billing.sql.
DROP TABLE IF EXISTS "stripe_subscriptions";
DROP TABLE IF EXISTS "global_merchant_facts";
DROP TABLE IF EXISTS "llm_cache";
DROP TABLE IF EXISTS "llm_call_logs";
DROP TABLE IF EXISTS "exports";
DROP TABLE IF EXISTS "artifacts";

DROP TYPE IF EXISTS "public"."subscription_plan";
DROP TYPE IF EXISTS "public"."llm_cache_status";
DROP TYPE IF EXISTS "public"."llm_cache_type";
DROP TYPE IF EXISTS "public"."llm_call_status";
DROP TYPE IF EXISTS "public"."export_kind";
DROP TYPE IF EXISTS "public"."artifact_kind";
