-- 4c-ii: the sync role reads across households and writes within one.
--
-- WHAT WAS TRUE BEFORE THIS. `sync_worker_access` was
-- `USING (true) WITH CHECK (true)` for marginsheet_sync on all 36 tables, so
-- row-level security constrained that role NOWHERE. The household GUC that
-- exchange.ts and reconnect.ts set was read by policies attached to
-- marginsheet_app and by nothing on the sync path. It was decorative there.
--
-- CONFIRMED, NOT SUSPECTED. On 19 Aug 2026 four cross-household writes were
-- reproduced against a real database, each issued as household A with A's GUC
-- set and read back inside the transaction, each succeeding with no error:
-- plaid_items.item_id, financial_accounts.plaid_account_id,
-- transactions.plaid_transaction_id, and applyRemoved's removed-stream update.
--
-- WHY SPLIT BY COMMAND RATHER THAN REPLACE. The sync Worker must READ across
-- households, because the watchdog sweep and the outbox drain look for work
-- they cannot name in advance. It must WRITE within one, because every write
-- belongs to exactly one household and all four findings were writes. So reads
-- keep `USING (true)` under their own policy and writes get a predicate.
--
-- Permissive policies are OR'd, and `sync_worker_read` is FOR SELECT ONLY, so
-- it cannot widen an UPDATE or a DELETE. INSERT is governed by the write
-- policy's WITH CHECK alone.
--
-- NARROWED ON ALL 36 TABLES, NOT ONLY THE TEN THE ROLE CAN REACH. Migrations
-- 0023 and 0024 grant marginsheet_sync ten tables, so the policy is irrelevant
-- on the other 26 TODAY. It is written anyway, because the grant is currently
-- the only boundary on this path, and a future widening should land on a narrow
-- policy rather than on USING (true).


-- The 34 ordinary tables: household_id is the scope.
DROP POLICY "sync_worker_access" ON "members";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "members" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "members" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "invitations";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "invitations" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "invitations" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "trial_records";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "trial_records" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "trial_records" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "consent_records";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "consent_records" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "consent_records" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "plaid_items";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "plaid_items" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "plaid_items" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "financial_accounts";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "financial_accounts" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "financial_accounts" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "account_balance_snapshots";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "account_balance_snapshots" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "account_balance_snapshots" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "liability_details";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "liability_details" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "liability_details" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "categories";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "categories" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "categories" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "transactions";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "transactions" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "transactions" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "merchant_corrections";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "merchant_corrections" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "merchant_corrections" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "category_rules";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "category_rules" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "category_rules" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "source_renames";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "source_renames" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "source_renames" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "commitments";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "commitments" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "commitments" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "household_goals";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "household_goals" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "household_goals" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "threads";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "threads" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "threads" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "messages";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "messages" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "messages" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "question_dispatches";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "question_dispatches" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "question_dispatches" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "known_context";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "known_context" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "known_context" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "tombstones";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "tombstones" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "tombstones" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "standing_instructions";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "standing_instructions" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "standing_instructions" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "tags";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "tags" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "tags" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "tag_members";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "tag_members" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "tag_members" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "decision_journal";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "decision_journal" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "decision_journal" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "handoffs";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "handoffs" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "handoffs" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "condition_states";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "condition_states" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "condition_states" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "calibration_bands";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "calibration_bands" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "calibration_bands" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "insight_ledger";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "insight_ledger" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "insight_ledger" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "receivables";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "receivables" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "receivables" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "artifacts";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "artifacts" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "artifacts" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "exports";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "exports" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "exports" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "llm_call_logs";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "llm_call_logs" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "llm_call_logs" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "llm_cache";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "llm_cache" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "llm_cache" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint
DROP POLICY "sync_worker_access" ON "stripe_subscriptions";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "stripe_subscriptions" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "stripe_subscriptions" FOR ALL TO marginsheet_sync
  USING (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid) WITH CHECK (household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint

-- ===================================================================
-- THREE EXCEPTIONS, WRITTEN OUT SEPARATELY RATHER THAN AS CARVE-OUTS
-- INSIDE A SHARED BODY.
--
-- "Why is this one different" is the question a future reader asks, and a
-- carve-out answers it worst: it reads as an irregularity in a pattern rather
-- than as a decision. Each reason below says WHAT BREAKS IF THE EXCEPTION IS
-- REMOVED, not how the table differs, because a description of the schema does
-- not stop anyone tidying the exception away.
-- ===================================================================


-- EXCEPTION 1: households.
--
-- IF THIS EXCEPTION IS REMOVED and the ordinary predicate is applied,
-- `household_id = ...` references a column that does not exist on this table
-- and THE MIGRATION FAILS TO APPLY. If it were somehow forced, every write here
-- would be refused: markFirstSyncCompleted sets first_sync_completed_at, which
-- the intro trigger and the day-3-to-5 census scheduling both read, so a
-- household would complete its first sync and never be greeted.
--
-- The table is keyed `id`. The scope is the same idea spelled with the column
-- this table actually has.
DROP POLICY "sync_worker_access" ON "households";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "households" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "households" FOR ALL TO marginsheet_sync
  USING (id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid)
  WITH CHECK (id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid);--> statement-breakpoint


-- EXCEPTION 2: provider_events.
--
-- IF THIS EXCEPTION IS REMOVED, WEBHOOKS STOP BEING PROCESSED. A webhook
-- arrives before we know which household it concerns: spec section 4 requires
-- every inbound event to land in provider_events BEFORE any processing, and the
-- household is resolved afterwards by looking up the Plaid item_id. A predicate
-- requiring `household_id = <declared>` refuses the very insert whose purpose is
-- to record an event we cannot yet attribute, so Plaid's retries would be the
-- only trace and the pipeline would go quiet with nothing failing loudly.
--
-- So an unattributed row is writable, and an attributed one is scoped. NULL is
-- permitted deliberately and narrowly: it admits the insert that identifies the
-- household and nothing else.
DROP POLICY "sync_worker_access" ON "provider_events";--> statement-breakpoint
CREATE POLICY "sync_worker_read" ON "provider_events" FOR SELECT TO marginsheet_sync
  USING (true);--> statement-breakpoint
CREATE POLICY "sync_worker_write" ON "provider_events" FOR ALL TO marginsheet_sync
  USING (
    household_id IS NULL
    OR household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid
  )
  WITH CHECK (
    household_id IS NULL
    OR household_id = nullif(btrim(current_setting('marginsheet.household_id', true)), '')::uuid
  );--> statement-breakpoint


-- EXCEPTION 3: institutions. NO POLICY IS WRITTEN, AND THAT IS THE DECISION.
--
-- institutions carries no household_id and no row-level security at all: it is
-- absent from migration 0008 entirely. It is a shared catalogue of banks keyed
-- on plaid_institution_id, and every household referencing Chase references the
-- same row.
--
-- IF A HOUSEHOLD PREDICATE WERE ADDED HERE, THE FIRST EXCHANGE OF EVERY
-- INSTITUTION WOULD FAIL. exchange.ts upserts the institution before it writes
-- the Item, so connecting any bank nobody has connected before would be refused,
-- and the household would see a connect flow that fails on exactly the
-- institutions we have never seen.
--
-- Recorded here rather than left silent, because a reader auditing this
-- migration will notice institutions is missing and needs to find a reason
-- rather than an omission. What guards this table is the GRANT: 0024 gives
-- marginsheet_sync SELECT, INSERT and UPDATE and nothing else, and the table
-- holds no household data to isolate.
