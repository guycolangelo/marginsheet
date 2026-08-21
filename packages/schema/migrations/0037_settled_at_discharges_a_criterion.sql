-- =========================================================================
-- WHEN A PENDING TRANSACTION BECAME POSTED.
--
-- WHY A COLUMN AND NOT A COUNTER IN A SYNC REPORT (Guy, 21 Aug 2026). Webhooks
-- went live on all three institutions today, so the next settle happens
-- UNATTENDED. A number in a routine sync result is easy to miss precisely
-- because the result is routine, and this particular transition is not routine:
-- it is an acceptance criterion that has been open since 17 Aug.
--
-- WHAT IT DISCHARGES. Invariant 8 listed five Sandbox error fixtures and four
-- could not be constructed. Pending-to-posted was one: 0 pending rows across 48
-- default-user transactions and across every user_custom shape tried. The
-- invariant was rewritten to claim only what Sandbox can prove, and this was
-- recorded as a GAP rather than tested against a fixture that cannot fail.
-- categorization-spec section 10 turns on this transition, and apply-streams
-- handles it with one upsert on the same conflict target, deliberately, so that
-- a settle lands on the SAME ROW rather than creating a second one.
--
-- Nine pending rows existed across the three institutions when this was written.
--
-- SET ONCE, ON THE TRANSITION ONLY. The CASE requires the stored row to be
-- pending and the incoming row not to be, and requires settled_at to still be
-- null. A row that arrives posted and was never seen pending gets NULL, which is
-- correct: we did not observe it settle, we only ever saw it posted. THAT
-- DISTINCTION IS THE POINT. A column set on every posted row would count rows
-- rather than transitions, and the criterion is about the transition.
--
-- IT IS ALSO REAL DATA. authorized_date to settled_at is settle latency per
-- institution, which nothing else in this schema records.
-- =========================================================================

ALTER TABLE "transactions" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON COLUMN "transactions"."settled_at" IS
  'When WE OBSERVED this row go from pending to posted, set once by apply-streams on that transition and never afterwards. NULL MEANS WE DID NOT SEE IT SETTLE, which includes every row that arrived already posted, and is not a gap: most rows are first seen posted and never had a transition to observe. It is deliberately NOT "the date it posted", which would be date or authorized_date. THE FIRST NON-NULL VALUE DISCHARGES AN ACCEPTANCE CRITERION open since 17 Aug 2026: Plaid Sandbox cannot construct a pending-to-posted transition (0 pending rows across 48 default-user transactions and every user_custom shape), so invariant 8 was rewritten to claim only what Sandbox proves and this was left as a gap awaiting production. Recorded as a column rather than as a counter in a sync report because syncs now run unattended and a number in a routine result is missed.';
