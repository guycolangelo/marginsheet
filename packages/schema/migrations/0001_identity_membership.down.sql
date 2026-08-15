-- Reverses 0001_identity_membership.sql. Triggers fall with their tables;
-- enums must be dropped after the tables that reference them.
DROP TABLE IF EXISTS "consent_records";
DROP TABLE IF EXISTS "trial_records";
DROP TABLE IF EXISTS "invitations";
DROP TABLE IF EXISTS "members";
DROP TABLE IF EXISTS "households";
DROP TYPE IF EXISTS "public"."consent_source";
DROP TYPE IF EXISTS "public"."consent_kind";
DROP TYPE IF EXISTS "public"."invitation_status";
DROP TYPE IF EXISTS "public"."member_status";
DROP TYPE IF EXISTS "public"."member_role";
DROP TYPE IF EXISTS "public"."entitlement_state";
