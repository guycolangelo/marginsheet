-- =========================================================================
-- 4.7's neighbour: the writer for Cash Flow's only committed-outflow input.
--
-- liability_details has existed since 0002, marginsheet_sync has held grants on
-- it since 0023, and `liabilities` is declared in config/plaid-consent.json as
-- an additionally-consented product. NOTHING HAS EVER CALLED /liabilities/get.
-- A column with a writer and no consumer reads as dead and gets noticed; A
-- COLUMN WITH A CONSUMER AND NO WRITER READS AS FINISHED, because every check
-- around it passes.
--
-- TWO THINGS THIS MIGRATION EXISTS FOR, AND NEITHER IS THE FETCH ITSELF.
--
-- ONE: LIABILITIES IS BILLED ON FIRST USE, PER ITEM, PER MONTH (Guy, 21 Aug
-- 2026). The first call starts a recurring charge on four Chase cards and six
-- Amex accounts. That is what the consent was for and it is fine, AND IT MUST
-- BE A DELIBERATE FIRST CALL RATHER THAN A SIDE EFFECT OF A SYNC. So the sync
-- does not fetch liabilities for an Item until liabilities_enabled_at is set,
-- which only the enable route sets, dry run first. The cost is declared in
-- config/provider-costs.json where the money model can find it.
--
-- TWO: CONSENT BEING PRESENT DOES NOT MEAN THE ENDPOINT RETURNS ANYTHING. An
-- institution may not support Liabilities at all, may support it and report
-- nothing for a particular card, or may report fully. THOSE ARE THREE STATES
-- AND AN EMPTY liability_details ROW EXPRESSES ALL OF THEM IDENTICALLY, which
-- is the failure this module has now found five times: an empty result reading
-- as a legitimate business answer.
--
-- A CARD WITH NO LIABILITY DETAIL AND A CARD THE INSTITUTION WILL NOT REPORT ON
-- ARE DIFFERENT STATES, AND CASH FLOW NEEDS TO KNOW WHICH. liability_coverage
-- says which, per account, so a surface can distinguish "this household has no
-- committed outflow" from "we cannot see this card's committed outflow", and
-- the second is a sentence a household should be told rather than a blank.
-- =========================================================================

-- ONE LIABILITY ROW PER ACCOUNT, WHICH 0002 INTENDED AND DID NOT ENFORCE. It
-- created a plain INDEX on account_id, so nothing stopped a second row and the
-- writer's upsert had no conflict target to name. Found by writing the first
-- statement that inserts into this table, which is the only thing that could
-- have found it: a table nothing writes cannot demonstrate a missing
-- constraint.
--
-- account_id ALONE IS THE RIGHT KEY AND NOT (household_id, account_id). It is
-- our own uuid rather than a provider value, so it cannot collide across
-- households, and the rule that a write must name the household applies to keys
-- in Plaid's namespace. The fetcher still names the household everywhere it
-- keys on plaid_account_id, which IS Plaid's.
ALTER TABLE "liability_details" ADD CONSTRAINT "liability_details_account_id_unique" UNIQUE ("account_id");--> statement-breakpoint

CREATE TYPE "public"."liability_coverage" AS ENUM('unknown', 'reported', 'not_reported', 'unsupported');--> statement-breakpoint

ALTER TABLE "financial_accounts" ADD COLUMN "liability_coverage" "liability_coverage" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "liabilities_enabled_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON TYPE "public"."liability_coverage" IS
  'Whether we can see an account''s committed outflow, and WHY NOT when we cannot. unknown: liabilities has never been fetched for this Item, which is every account until the enable route runs. reported: the last fetch returned a statement balance and due date for this account. not_reported: the fetch SUCCEEDED and this account was not in the response, so the institution supports Liabilities and says nothing about this card. unsupported: the fetch was refused for the whole Item, so the institution does not support Liabilities at all. THE LAST TWO ARE THE POINT. An empty liability_details row expresses all four states identically, and a household with no committed outflow and a household whose card we cannot see are different sentences.';--> statement-breakpoint

COMMENT ON COLUMN "financial_accounts"."liability_coverage" IS
  'Set by the liabilities fetch, never by the balance pipeline. Cash Flow reads it BEFORE reading last_statement_balance, because a null statement balance means something different under each value: under reported it is a card with nothing owed, under not_reported and unsupported it is a figure we do not have. Defaults to unknown, which is honest for every account until liabilities is deliberately enabled for its Item.';--> statement-breakpoint

COMMENT ON COLUMN "plaid_items"."liabilities_enabled_at" IS
  'When Liabilities was DELIBERATELY enabled for this Item, and null until then. THE SYNC DOES NOT FETCH LIABILITIES FOR A NULL ITEM, because Plaid bills Liabilities on first use, per Item, per month: the first call starts a recurring charge and a charge should not begin as a side effect of a sync somebody triggered for transactions. Set only by /internal/enable-liabilities, which is dry run by default and reports what it is about to start paying for. Clearing it stops future fetches and does not stop the billing, which is a property of Plaid rather than of this column.';
