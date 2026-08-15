-- Reverses 0002_banking_sync.sql, including the roles. A clean down leaves no
-- trace even though a destroyed Neon branch would take the roles with it
-- anyway (verified 15 Aug 2026): the down is the contract, not the fallback.
--
-- Privileges are revoked before the roles drop, because a role owning
-- outstanding grants cannot be dropped and would wedge the branch.
DROP TABLE IF EXISTS "provider_events";
DROP TABLE IF EXISTS "liability_details";
DROP TABLE IF EXISTS "account_balance_snapshots";
DROP TABLE IF EXISTS "financial_accounts";
DROP TABLE IF EXISTS "plaid_items";
DROP TABLE IF EXISTS "institutions";

DROP TYPE IF EXISTS "public"."provider_source";
DROP TYPE IF EXISTS "public"."card_state";
DROP TYPE IF EXISTS "public"."sync_status";
DROP TYPE IF EXISTS "public"."plaid_item_status";

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marginsheet_app') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM marginsheet_app';
    DROP ROLE marginsheet_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marginsheet_sync') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM marginsheet_sync';
    DROP ROLE marginsheet_sync;
  END IF;
END $$;
