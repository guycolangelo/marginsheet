-- Reverting removes the household-scoped arbiters and leaves the global indexes
-- as the only uniqueness, which is the state in which one household's upsert
-- reaches another household's row. The code must be reverted with it: a
-- deployed `on conflict (household_id, item_id)` with no matching index raises
-- on every write rather than falling back to the global one.
DROP INDEX IF EXISTS "transactions_household_transaction_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "financial_accounts_household_account_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "plaid_items_household_item_unique";
