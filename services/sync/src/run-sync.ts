// The sync runner: one household, one Item, one transaction (M4 task 4.5b').
//
// WHAT DID NOT EXIST BEFORE THIS. runTransactionsSync paged through Plaid and
// COUNTED rows, discarding them; applyAddedAndModified now writes them; and
// nothing joined the two. This is the caller the whole pipeline was built
// around and which was never written, so a connected Item produced accounts and
// balances and an empty ledger.
//
// ONE TRANSACTION FOR THE WHOLE RUN, and the ordering inside it is load-bearing:
//
//   1. declare the household, because migration 0026 refuses a write that does
//      not, and because the GUC is what scopes every policy on this path
//   2. read both cursors before anything is written
//   3. page, writing the in-flight cursor after every page so a crash resumes
//   4. apply the streams
//   5. close the state machine and record the signal
//
// THE SIGNAL IS RECORDED INSIDE THE TRANSACTION AND ANNOUNCED OUTSIDE IT. That
// ordering is the outbox's whole point: `enqueued_at` NULL means never
// announced rather than not yet recorded, so a crash between the two leaves a
// row the sweep can find rather than a notification nobody sent.

import postgres from "postgres";
import { decryptToken } from "./token-crypto.js";
import { runTransactionsSync, type SyncOutcome, type SyncPage } from "./transactions-sync.js";
import type { PlaidCredentials } from "./plaid-client.js";
import { applyAddedAndModified, applyRemoved, markFirstSyncCompleted, type Tx } from "./apply-streams.js";
import { applyBalances } from "./apply-balances.js";
import { reconcileBalances } from "./reconcile-balances.js";
import { fetchLiabilities, type LiabilitiesOutcome } from "./fetch-liabilities.js";
import { onSyncComplete, type SyncStatus } from "./sync-state.js";
import { openSyncRun, closeSyncRun } from "./sync-runs.js";
import { writeStateSignal } from "./state-signal.js";

export interface RunResult {
  itemId: string;
  added: number;
  modified: number;
  removed: number;
  written: number;
  flagged: number;
  pages: number;
  restarts: number;
  firstSync: boolean;
  /** Balance rows ACTUALLY touched, not accounts handed in. They differ exactly
   *  when an account belongs to another household, which is the case the
   *  household predicate exists to prevent, so reporting the input would hide
   *  the only failure worth seeing. */
  /** WRITES ISSUED, NOT ACCOUNTS TOUCHED, AND THE OLD NAMES SAID THE SECOND.
   *
   *  Amex reported 28 and 28 across SIX accounts, which read as a defect and
   *  was not one. applyBalances runs PER PAGE, deliberately: Plaid resends the
   *  same current balances with every page so the last one wins, and a
   *  pagination that dies midway leaves balances fresher than it found them.
   *  Plaid also returns only accounts that HAVE TRANSACTIONS on a given page,
   *  so the per-page count varies and sums to 28 over 11 pages rather than to 6
   *  or to 66. The snapshot upsert then collapses those writes onto 6 rows.
   *
   *  Renamed on 21 Aug 2026 after somebody reasoned from the number and reached
   *  a wrong conclusion, which is the fifth field this week whose name promised
   *  a different quantity than it carried. The behaviour was correct in every
   *  one of them; the name was the defect. */
  balanceWritesIssued: number;
  /** DISTINCT accounts whose balance was read this sync. balanceWritesIssued
   *  counts writes and this counts accounts, and they differ whenever an
   *  account appears on more than one page. This is the set reconciliation
   *  draws from, so a reader can check the two against each other. */
  accountsRefreshed: number;
  snapshotUpsertsIssued: number;
  signalId: string | null;
  /** The run's identity, which household_state_signals.source_sync_run_id now
   *  carries. It used to be gen_random_uuid(), joining to nothing. */
  syncRunId: string;
  /** Accounts whose balance MOVED. accountsRefreshed counts accounts READ, and
   *  the two differ on every sync where an account reported the same figure
   *  twice, which is most of them. */
  balancesChanged: number;
}

/** Runs one sync for one Item. The caller holds the household's chain lock. */
export async function runSyncForItem(
  householdId: string,
  itemRowId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string
): Promise<RunResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // THE MARKER COMMITS IN ITS OWN TRANSACTION, BEFORE THE MAIN ONE, AND THAT
    // IS THE WHOLE POINT OF IT.
    //
    // Written inside the main transaction it would ROLL BACK ON EXACTLY THE
    // CRASH IT EXISTS TO RECORD: the Worker dies, Postgres discards the
    // transaction, the row reads 'idle', and the watchdog has nothing to find.
    // A marker that disappears with the failure it marks is not a marker.
    //
    // The status and the timestamp are ONE statement. A marker without a moment
    // is a fact the sweep cannot judge, and its whole judgement is elapsed time.
    // THE RUN ROW IS OPENED HERE TOO, IN THE SAME TRANSACTION, and that is
    // deliberate rather than convenient. sync_runs.started_at and
    // plaid_items.sync_started_at are two statements of one fact and would
    // drift by default; written together they cannot disagree at the moment of
    // writing, and sync-run-agrees-with-the-marker asserts they still do not.
    //
    // It also inherits the marker's whole reason: a record of an attempt that
    // lives inside the transaction whose failure it records is rolled back by
    // that failure, which is the one circumstance it exists for.
    const syncRunId = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;
      await tx`
        update plaid_items
           set sync_status = 'syncing', sync_started_at = now(), updated_at = now()
         where id = ${itemRowId} and household_id = ${householdId}
      `;
      return await openSyncRun(tx as unknown as Tx, householdId, itemRowId);
    });

    return await sql.begin(async (tx) => {
      // Migration 0026 refuses a write from a transaction that declares no
      // household. This is also what every policy on this path reads.
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;

      // THE LOOKUP IS SCOPED, not merely keyed on the row id. The id is ours
      // and cannot collide, so this is defence in depth rather than a fix, and
      // it costs nothing to be correct without relying on the policy.
      const [item] = await tx<
        { item_id: string; access_token_ciphertext: string | null; sync_cursor: string | null; last_completed_cursor: string | null; sync_status: SyncStatus; liabilities_enabled_at: string | null }[]
      >`
        select item_id, access_token_ciphertext, sync_cursor, last_completed_cursor, sync_status,
               (liabilities_enabled_at)::text as liabilities_enabled_at
          from plaid_items
         where id = ${itemRowId}
           and household_id = ${householdId}
      `;
      if (!item) throw new Error(`no plaid_item ${itemRowId} for this household`);
      if (!item.access_token_ciphertext) throw new Error(`plaid_item ${itemRowId} holds no token`);

      let balanceWritesIssued = 0;
      let snapshotUpsertsIssued = 0;
      // DISTINCT ACCOUNTS, WHICH IS A DIFFERENT NUMBER FROM THE WRITES ISSUED
      // and is the set reconciliation is allowed to judge. applyBalances runs
      // per page and Plaid resends balances on every page, so writes issued
      // exceeds accounts refreshed whenever an account appears on more than one.
      const refreshedAccountIds = new Set<string>();
      // ACCOUNTS WHOSE BALANCE MOVED, which is a second set and must stay one.
      // Reconciliation reads the set above (amendment 14: an account read and
      // unchanged still has a fresh observation, and is exactly where drift
      // would be most suspicious). The signal reads this one, because Plaid
      // returns balances on every page of every sync and a signal keyed on the
      // set above would fire always.
      const changedAccountIds = new Set<string>();

      const accessToken = await decryptToken(item.access_token_ciphertext, encryptionKey);

      // BOTH CURSORS, because the mutation branch resumes from the LAST
      // COMPLETED one rather than the in-flight one: a webhook landing
      // mid-pagination is exactly what invalidates the in-flight position.
      const outcome: SyncOutcome = await runTransactionsSync(
        accessToken,
        { inFlight: item.sync_cursor, lastCompleted: item.last_completed_cursor },
        credentials,
        async (cursor) => {
          await tx`
            update plaid_items set sync_cursor = ${cursor}, last_cursor_at = now(), updated_at = now()
             where id = ${itemRowId} and household_id = ${householdId}
          `;
        },
        // The streams, handed over per page rather than accumulated, so a long
        // backfill does not hold every transaction in memory before writing one.
        async (page: SyncPage) => {
          const written = await applyAddedAndModified(tx as unknown as Tx, householdId, [...page.added, ...page.modified]);
          const flagged = await applyRemoved(tx as unknown as Tx, householdId, page.removed.map((r) => r.transaction_id));
          // PER PAGE, WHICH IS IDEMPOTENT AND DELIBERATE. Plaid sends the same
          // current balances with every page, so the last page wins and lands
          // on the same figure. Writing per page also means a pagination that
          // fails midway still leaves balances fresher than it found them,
          // which is the right direction for a value that describes NOW rather
          // than a ledger entry that describes an event.
          const balances = await applyBalances(tx as unknown as Tx, householdId, page.accounts ?? []);
          balanceWritesIssued += balances.accounts;
          snapshotUpsertsIssued += balances.snapshots;
          for (const id of balances.accountIds) refreshedAccountIds.add(id);
          for (const id of balances.changedAccountIds) changedAccountIds.add(id);
          return { written, flagged };
        }
      );

      // AFTER THE STREAMS AND THE BALANCES, INSIDE THE SAME TRANSACTION, so
      // the reported balance and the transactions it is checked against come
      // from one sync rather than from two moments. Reconciling outside the
      // transaction would compare a balance to a ledger that had moved.
      // THIS ITEM'S ACCOUNTS, not the household's. The balances just refreshed
      // belong to this Item, and an account whose balance was not read has no
      // new observation to make.
      const reconciliation = await reconcileBalances(
        tx as unknown as Tx, householdId, itemRowId, [...refreshedAccountIds]
      );

      // CASH FLOW'S COMMITTED OUTFLOW, and NOTHING CALLED THIS UNTIL NOW.
      //
      // fetch-liabilities.ts shipped on 21 Aug with its gate, its migration,
      // its coverage states, its grant, its declared consent and five passing
      // database tests. ITS ONLY CALLER WAS ITS OWN TEST. Every check around it
      // was green because every check around it was about the parts that
      // existed.
      //
      // IT IS THE SHAPE THAT PR NAMED IN ITS OWN DESCRIPTION: a column with a
      // consumer and no writer reads as finished. The writer was then written
      // and never called, which is the same sentence one level out, and the
      // test being a caller is what made it look wired.
      //
      // The gate is read here rather than inside, so a disabled Item costs one
      // column on a query already being run rather than a function call that
      // returns "not enabled".
      const liabilities = await fetchLiabilities(
        tx as unknown as Tx, householdId,
        { id: itemRowId, itemId: item.item_id, accessToken, enabledAt: item.liabilities_enabled_at },
        credentials
      );

      const firstSync = await markFirstSyncCompleted(tx as unknown as Tx, householdId);

      // BOTH VALUES ARE IN HAND HERE, which is the whole reason
      // item_status_changed is cheap on this path: the transition is computed
      // for the write anyway, so detecting it costs a comparison.
      const nextStatus = onSyncComplete(item.sync_status);
      const itemStatusChanged = nextStatus !== item.sync_status;

      await tx`
        update plaid_items
           set sync_cursor = ${outcome.cursor},
               last_completed_cursor = ${outcome.cursor},
               sync_status = ${nextStatus},
               last_successful_sync = now(),
               last_synced_at = now(),
               updated_at = now()
         where id = ${itemRowId} and household_id = ${householdId}
      `;

      // A SYNC THAT CHANGED NOTHING DOES NOT FIRE. A watcher waking for nothing
      // is how a watcher becomes noise (plaid-pipeline-spec section 4).
      //
      // THE GATE READS WHAT THE SYNC DID, not what one stream did. It used to
      // be didChange(outcome), a pure function of the transaction counts, so a
      // sync that refreshed balances, wrote snapshots, fetched liabilities and
      // moved this Item's status FIRED NOTHING when no transaction arrived.
      //
      // Each input is a CHANGED population rather than a touched one. Keying
      // balances on refreshedAccountIds would fire on every sync, because
      // Plaid returns balances on every page: that deletes the gate rather
      // than widening its input, which is the opposite of the repair.
      const signalId = await writeStateSignal(
        tx as unknown as Tx, householdId, itemRowId, syncRunId,
        {
          transactionsAdded: outcome.added,
          transactionsModified: outcome.modified,
          transactionsRemoved: outcome.removed,
          balancesChanged: changedAccountIds.size,
          liabilitiesChanged: liabilities.accountsChanged,
          itemStatusChanged,
        }
      );

      // THE RUN IS CLOSED LAST, INSIDE THE MAIN TRANSACTION, and that is the
      // mirror of the marker rather than an inconsistency with it. Opening
      // records an attempt and must survive the attempt failing. Closing
      // records that the work COMMITTED, so it belongs to the commit: a run
      // marked complete by a transaction that then rolled back would be the
      // more dangerous lie, since a reader would take it as finished work.
      await closeSyncRun(tx as unknown as Tx, householdId, syncRunId, {
        transactionsAdded: outcome.added,
        transactionsModified: outcome.modified,
        transactionsRemoved: outcome.removed,
        accountsRefreshed: refreshedAccountIds.size,
        balancesChanged: changedAccountIds.size,
        liabilitiesChanged: liabilities.accountsChanged,
        pages: outcome.pages,
        restarts: outcome.restarts,
      });

      return {
        itemId: item.item_id,
        added: outcome.added,
        modified: outcome.modified,
        removed: outcome.removed,
        written: outcome.written,
        flagged: outcome.flagged,
        pages: outcome.pages,
        restarts: outcome.restarts,
        firstSync,
        balanceWritesIssued,
        accountsRefreshed: refreshedAccountIds.size,
        reconciliation,
        liabilities,
        snapshotUpsertsIssued,
        signalId,
        syncRunId,
        balancesChanged: changedAccountIds.size,
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
