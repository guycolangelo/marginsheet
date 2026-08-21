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
import { applyAddedAndModified, applyRemoved, markFirstSyncCompleted, didChange, type Tx } from "./apply-streams.js";
import { applyBalances } from "./apply-balances.js";
import { reconcileBalances } from "./reconcile-balances.js";
import { onSyncComplete, type SyncStatus } from "./sync-state.js";

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
  snapshotUpsertsIssued: number;
  signalId: string | null;
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
    return await sql.begin(async (tx) => {
      // Migration 0026 refuses a write from a transaction that declares no
      // household. This is also what every policy on this path reads.
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;

      // THE LOOKUP IS SCOPED, not merely keyed on the row id. The id is ours
      // and cannot collide, so this is defence in depth rather than a fix, and
      // it costs nothing to be correct without relying on the policy.
      const [item] = await tx<
        { item_id: string; access_token_ciphertext: string | null; sync_cursor: string | null; last_completed_cursor: string | null; sync_status: SyncStatus }[]
      >`
        select item_id, access_token_ciphertext, sync_cursor, last_completed_cursor, sync_status
          from plaid_items
         where id = ${itemRowId}
           and household_id = ${householdId}
      `;
      if (!item) throw new Error(`no plaid_item ${itemRowId} for this household`);
      if (!item.access_token_ciphertext) throw new Error(`plaid_item ${itemRowId} holds no token`);

      let balanceWritesIssued = 0;
      let snapshotUpsertsIssued = 0;

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
          return { written, flagged };
        }
      );

      // AFTER THE STREAMS AND THE BALANCES, INSIDE THE SAME TRANSACTION, so
      // the reported balance and the transactions it is checked against come
      // from one sync rather than from two moments. Reconciling outside the
      // transaction would compare a balance to a ledger that had moved.
      const reconciliation = await reconcileBalances(tx as unknown as Tx, householdId);

      const firstSync = await markFirstSyncCompleted(tx as unknown as Tx, householdId);

      await tx`
        update plaid_items
           set sync_cursor = ${outcome.cursor},
               last_completed_cursor = ${outcome.cursor},
               sync_status = ${onSyncComplete(item.sync_status)},
               last_successful_sync = now(),
               last_synced_at = now(),
               updated_at = now()
         where id = ${itemRowId} and household_id = ${householdId}
      `;

      // A SYNC THAT CHANGED NOTHING DOES NOT FIRE. A watcher waking for nothing
      // is how a watcher becomes noise (plaid-pipeline-spec section 4).
      let signalId: string | null = null;
      if (didChange(outcome)) {
        const changed: string[] = [];
        if (outcome.added > 0) changed.push("transactions_added");
        if (outcome.modified > 0) changed.push("transactions_modified");
        if (outcome.removed > 0) changed.push("transactions_removed");
        // COUNTS ONLY. A count is metadata; an amount is not, and a payload
        // carrying household figures would put them outside the RLS boundary.
        const [signal] = await tx<{ signal_id: string }[]>`
          insert into household_state_signals
            (household_id, source_plaid_item_id, source_sync_run_id, changed, counts)
          values (
            ${householdId}, ${itemRowId}, gen_random_uuid(), ${changed},
            ${JSON.stringify({ added: outcome.added, modified: outcome.modified, removed: outcome.removed })}::jsonb
          )
          returning signal_id
        `;
        signalId = signal.signal_id;
      }

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
        reconciliation,
        snapshotUpsertsIssued,
        signalId,
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
