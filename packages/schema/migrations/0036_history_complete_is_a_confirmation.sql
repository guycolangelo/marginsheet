-- =========================================================================
-- first_sync_completed_at MEANS "WE HOLD THIS HOUSEHOLD'S HISTORY", NOT "A
-- SYNC SUCCEEDED" (Guy, 21 Aug 2026).
--
-- A sync succeeding is a fact about a CALL. Holding the history is the thing
-- the M13 intro and the day-3-to-5 census actually depend on. Same
-- fact-versus-filing distinction 0035 drew on transactions.direction, one
-- table over.
--
-- WHAT WENT WRONG. markFirstSyncCompleted fired on the first successful sync
-- of the first Item. Amex's first sync returned 161 rows and its second, with
-- no code change, returned 5,241: the institution backfills ASYNCHRONOUSLY and
-- the first sync correctly reported what existed at that moment. A new
-- household whose first institution behaves that way would have the milestone
-- set at roughly 3% of its ledger, AND THE FIELD IS SET ONCE BY DESIGN so that
-- the intro and the census do not re-arm, so NOTHING WOULD EVER CORRECT IT.
--
-- THE CONFIRMATION. Plaid's SYNC_UPDATES_AVAILABLE carries
-- initial_update_complete and historical_update_complete. This column records
-- the moment both were true for an Item.
--
-- IT IS NOT SUFFICIENT ON ITS OWN, which is why the milestone reads two things
-- rather than this one. Plaid saying the history is assembled does not mean we
-- have PULLED it, so the milestone also requires a successful sync AFTER this
-- timestamp. Confirmation then collection, in that order.
--
-- NO TIMEOUT PATH IS BUILT, DELIBERATELY (Guy, 21 Aug 2026). A household whose
-- institution never sends the flags would wait forever, and the obvious fix is
-- to fire on a timeout with a field recording that it was set by timeout rather
-- than by confirmation. That is not built because WE HAVE NEVER OBSERVED WHAT A
-- WEBHOOK-REGISTERED ITEM ACTUALLY SENDS: until 0035's sibling fix, the link
-- token carried no webhook at all, so two of three production Items received
-- nothing and the one that did send flags had its webhook set by hand.
--
-- A TIMEOUT PATH BUILT NOW WOULD BE A BRANCH THAT MAY NEVER RUN, WHICH IS THE
-- SHAPE THIS CODEBASE HAS A DOZEN FINDINGS ABOUT. If Plaid always provides the
-- flags, the timeout is unnecessary and is never built. If some institution
-- stays silent, we will have SEEN it and can pick a number against data instead
-- of against an instinct. Recorded in docs/open-items.json with that trigger.
-- =========================================================================

ALTER TABLE "plaid_items" ADD COLUMN "history_complete_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON COLUMN "plaid_items"."history_complete_at" IS
  'When Plaid confirmed this Item''s backfill was assembled: the moment a SYNC_UPDATES_AVAILABLE webhook arrived carrying initial_update_complete AND historical_update_complete both true. SET ONCE, by the webhook receiver, never by a sync. NULL MEANS UNCONFIRMED AND NOT MEANS INCOMPLETE: an Item whose webhook has never fired is indistinguishable here from one still backfilling, which is why the milestone waits for confirmation rather than inferring from silence. IT DOES NOT MEAN WE HOLD THE DATA. Plaid assembling a history and us having pulled it are two events, so households.first_sync_completed_at additionally requires a successful sync AFTER this timestamp. An Item created before 21 Aug 2026 may never receive this, because the link token carried no webhook until then.';--> statement-breakpoint

COMMENT ON COLUMN "households"."first_sync_completed_at" IS
  'WE HOLD THIS HOUSEHOLD''S HISTORY. Not "a sync succeeded", which is a fact about a call. Set once, when EVERY non-disconnected Item on the household has both a confirmed backfill (plaid_items.history_complete_at) and a successful sync recorded after that confirmation. Feeds the M13 intro trigger and the day-3-to-5 census scheduling, which is why it is immutable: moving it re-arms things that already fired and the household would meet MyKeeper twice. FROM 0028 TO 0036 IT MEANT THE FIRST SYNC OF THE FIRST ITEM RETURNED, which fires at whatever fraction of the ledger existed at that instant; Amex would have set it at roughly 3%. There is deliberately NO TIMEOUT: a household whose Items never confirm will not reach this state, and that is a known gap with an owner rather than an oversight.';
