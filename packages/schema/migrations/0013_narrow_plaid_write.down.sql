-- Reverses 0013_narrow_plaid_write.sql, restoring 0002's table-level grants.
-- Note what reversing costs: marginsheet_app regains the ability to overwrite
-- access_token_ciphertext, because a table-level grant covers every column.
REVOKE INSERT, UPDATE ON TABLE "plaid_items" FROM marginsheet_app;
GRANT INSERT, UPDATE ON TABLE "plaid_items" TO marginsheet_app;
