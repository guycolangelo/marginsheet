-- Reverting refuses markEnqueued, so a signal is announced and never marked as
-- announced: enqueued_at stays NULL, the repair sweep is structurally blind to
-- such rows by design, and the never-announced counter reads them as evidence
-- of a crash. The correction to the table comment goes with it, which is the
-- honest direction: a down that keeps the correction would claim a grant the
-- database no longer holds.
REVOKE UPDATE (enqueued_at) ON "household_state_signals" FROM marginsheet_sync;
