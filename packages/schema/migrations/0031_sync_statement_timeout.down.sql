-- Reverting removes the only bound on a database operation inside a locked
-- sync. The Plaid deadline continues to bound outbound calls; nothing then
-- bounds a query.
ALTER ROLE marginsheet_sync RESET statement_timeout;
