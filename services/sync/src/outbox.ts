// The outbox: writing signals, announcing them, and the two readers that point
// opposite ways at the same column (M4 task 4.4.5).
//
// enqueued_at IS SET AFTER THE DATA COMMITS. That ordering is what gives the
// column its meaning: NULL means NO NOTIFICATION WAS EVER ANNOUNCED for this
// row.
//
//   a poller would ask:  where claimed_at is null
//   THE SWEEP asks:      where enqueued_at is not null and claimed_at is null
//   THE COUNTER asks:    where enqueued_at is null and created_at < threshold
//
// THE SWEEP IS A REPAIR PATH, NOT A POLLER, and that is checkable rather than
// merely asserted in a comment. A comment claiming "this is not polling" is the
// section 514 shape: a sentence that reads as a constraint and enforces nothing.
// A sweep that can pick up work no notification announced IS a poller whatever
// any comment says.
//
// THE COUNTER EXISTS SO THE SWEEP'S BLINDNESS IS DELIBERATE RATHER THAN
// ACCIDENTAL. A row with enqueued_at NULL and created_at old is not work to be
// done, it is EVIDENCE OF A CRASH in the commit-to-enqueue window. The counter
// does not deliver those rows, does not claim them, and is not the sweep. If
// the window is truly a millisecond it reads zero forever AND ITS SILENCE MEANS
// SOMETHING; if it ever reads non-zero we learn the window is wider than we
// think, which is the only way we would ever learn it.
//
// A blindness with nothing watching it is a loss nobody can observe, and a
// counter without a blind sweep is just a poller in two parts.

export type Tx = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/** How long a notification may go unacknowledged before the sweep repairs it. */
export const REPAIR_AFTER_MS = 5 * 60 * 1000;
/** How old an unannounced row must be before it counts as crash evidence. */
export const UNANNOUNCED_AFTER_MS = 10 * 60 * 1000;

export interface SignalRow {
  signal_id: string;
}

/** Rows whose notification was announced and never acknowledged.
 *
 * THE enqueued_at CLAUSE IS THE CONTROL. Without it this returns rows no
 * notification ever announced, which is polling. */
export async function findRepairable(tx: Tx, now: Date): Promise<SignalRow[]> {
  const cutoff = new Date(now.getTime() - REPAIR_AFTER_MS);
  return (await tx`
    select signal_id
      from household_state_signals
     where enqueued_at is not null
       and claimed_at is null
       and occurred_at < ${cutoff}
     order by occurred_at
     limit 100
  `) as SignalRow[];
}

/** Rows that were NEVER announced. Evidence of a crash between commit and
 *  enqueue, counted and reported, never delivered and never claimed. */
export async function countNeverAnnounced(tx: Tx, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - UNANNOUNCED_AFTER_MS);
  const rows = (await tx`
    select count(*)::int as n
      from household_state_signals
     where enqueued_at is null
       and created_at < ${cutoff}
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Marks a signal announced. Called AFTER the data transaction commits, which
 *  is what makes enqueued_at NULL mean "never announced" rather than "not yet
 *  recorded".
 *
 *  THE HOUSEHOLD IS NAMED EVEN THOUGH signal_id ALONE IS SUFFICIENT TODAY, and
 *  the reason is the policy rather than this statement. `signal_id` is a
 *  uuidv7 this system mints, so it cannot collide across households the way a
 *  Plaid id can, and by the provider-key rule this statement was never a
 *  finding. But 4c narrows sync_worker_access to a predicate on the declared
 *  household, and a write that names no household is REFUSED under it.
 *
 *  So this is declared now, on its own, while it changes nothing: the policy is
 *  still USING (true), so adding the predicate is a no-op today and the only
 *  variable when 4c lands is the policy itself. Verified by
 *  every-write-declares-a-household.test.ts, which found this statement as the
 *  one write in the Worker that named no household. */
export async function markEnqueued(tx: Tx, householdId: string, signalId: string): Promise<void> {
  await tx`
    update household_state_signals
       set enqueued_at = now()
     where household_id = ${householdId}
       and signal_id = ${signalId}
  `;
}
