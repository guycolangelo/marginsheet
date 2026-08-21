-- Correcting 0038's account of what the drift window is for.
--
-- IT GOES FORWARD BECAUSE 0038 IS MERGED AND FROZEN, and the sentence being
-- corrected is a COMMENT, which is exactly the kind of thing that would
-- otherwise be edited in place and reach only the databases that had not
-- applied it yet.
--
-- WHAT WAS WRONG. 0038 said the window absorbs transients, that three
-- observations give read skew two chances to clear, and that a settle is the
-- case it exists for. THE BASELINE MOVES WITH EVERY OBSERVATION, so a settle
-- disagrees exactly once and the following interval is clean. The window was
-- never what cleared it.
--
-- WHAT IT IS ACTUALLY FOR: a SYSTEMATIC fault, where every interval disagrees.
-- Both numbers survive and both guard something other than what 0038 said.
COMMENT ON TABLE "balance_reconciliations" IS
	'One row per account per sync, comparing the institution reported balance against our ledger. ZERO TOLERANCE: the only passing difference is exactly 0.00, because any threshold is a guess about an error nobody has observed. THE BASELINE MOVES WITH EVERY OBSERVATION, since each one records the reported balance, so an unexplained jump disagrees EXACTLY ONCE and the next interval is clean. A settle therefore clears in one observation and never reaches the window. THE WINDOW IS FOR A SYSTEMATIC FAULT, where every interval disagrees: transactions we never receive, a fee or interest applied outside the feed, a removed row mishandled, a sign wrong for an account type. A disagreement counts as DRIFT only across 3 consecutive comparable observations spanning at least 6 hours. THREE, because a settle clears in one, so a second consecutive non-zero means two INDEPENDENT transients, which on an account with six pending rows is unremarkable, and a third makes coincidence a poor explanation. SIX HOURS, because an institution FLAPPING between two values across rapid reads produces a non-zero difference every time as the baseline chases it, and three of those are one condition rather than three intervals of activity. 0038 GAVE DIFFERENT REASONS FOR THE SAME TWO NUMBERS and they were wrong: it described the window as absorbing transients. NEITHER NUMBER IS MEASURED. WHAT A CONFIRMED DRIFT MEANS: the ledger and the institution disagree about what happened in this account, and we do not know which is wrong, so EVERY figure derived from that account is under the same doubt rather than only the balance line.';
