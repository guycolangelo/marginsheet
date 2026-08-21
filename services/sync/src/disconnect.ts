// Disconnecting an institution. THE FIRST PIECE OF M8's DISCONNECT FLOW, built
// here because a household disconnecting a bank and an operator removing an
// Item are the same Plaid call with a different caller (Guy, 20 Aug 2026).
//
// IT LIVES IN THE SYNC WORKER because /item/remove needs the access token, and
// the token exists only as ciphertext in our database plus a key this Worker
// holds. There is no legitimate way to make this call by hand: doing so means
// decrypting a token outside the one component designed to hold it.
//
// TWO PROPERTIES CARRIED FROM THE PURGE ROUTE, and both are about the shape of
// a destructive action rather than about this action in particular. The
// confirmation is a SEPARATE DELIBERATE CALL rather than a button that acts on
// first click. And it REPORTS WHAT IT WILL DO before doing it.
//
// WHAT IT DOES NOT DO: delete anything of ours. Removing the Item at Plaid and
// removing our rows are different decisions with different reversibility, and
// the purge route owns the second. This marks the Item disconnected so our data
// stops claiming an Item is healthy when Plaid no longer has it.

import postgres from "postgres";
import { callPlaid, type PlaidCredentials } from "./plaid-client.js";
import { decryptToken } from "./token-crypto.js";
import { itemStatus, type ItemLiveness } from "./item-status.js";

export interface DisconnectResult {
  itemId: string;
  dryRun: boolean;
  liveness: ItemLiveness;
  plaidDetail: unknown;
  /** Our row's status before anything was done. */
  statusWas: string | null;
  /** Present only on a confirmed run that proceeded. */
  removed?: boolean;
  requestId?: string | null;
  rowsMarked?: number;
  refused?: string;
  willDo?: string[];
  /** Set when the Item was already gone at Plaid and our row was brought into
   *  agreement with that, without any Plaid call and without deleting anything. */
  reconciled?: boolean;
}

export async function disconnectItem(
  householdId: string,
  itemId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string,
  apply: boolean
): Promise<DisconnectResult> {
  // LIVENESS IS CHECKED HERE, NOT TAKEN FROM THE DRY RUN. A dry run minutes
  // earlier is not evidence about now: an Item can be removed, expire, or lose
  // its credential in between, and a confirmation that trusts a stale reading is
  // acting on a state nobody has observed.
  const status = await itemStatus(householdId, itemId, credentials, encryptionKey, databaseUrl);

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [row] = await sql<{ status: string; ciphertext: string | null }[]>`
      select status, access_token_ciphertext as ciphertext
        from plaid_items where item_id = ${itemId} and household_id = ${householdId}
    `;
    if (!row) {
      return {
        itemId, dryRun: !apply, liveness: "unknown", plaidDetail: status.detail,
        statusWas: null, refused: "no such item for this household",
      };
    }

    if (!apply) {
      return {
        itemId,
        dryRun: true,
        liveness: status.liveness,
        plaidDetail: status.detail,
        statusWas: row.status,
        willDo:
          status.liveness === "live"
            ? [
                "call /item/remove at Plaid, which is irreversible and stops billing for this Item",
                "mark our plaid_items row disconnected",
                "leave every transaction, account and snapshot in place: the purge route owns those",
              ]
            : status.liveness === "gone" && row.status !== "disconnected"
              ? [
                  "call Plaid not at all: the Item is already gone",
                  `mark our plaid_items row disconnected, which currently says ${row.status}`,
                  "delete nothing",
                ]
              : [`nothing: a confirmed call is refused unless Plaid reports the Item live, and it reports ${status.liveness}`],
      };
    }

    // REFUSES UNLESS PLAID REPORTS IT LIVE. The mirror of the purge's gate, and
    // asymmetric for the same reason: removing an Item we cannot confirm is
    // live risks acting on the wrong subject, while refusing costs one retry.
    // THE REPAIR BRANCH, and it exists because the route could not fix its own
    // partial failure. On 20 Aug 2026 a confirmed disconnect removed the Item
    // at Plaid and then failed to mark our row, and re-running was refused,
    // correctly, because Plaid now reported the Item gone. The gate was right
    // and the operator was stuck: a dead Item wearing a healthy status, with
    // the only route that knows about it refusing to touch it.
    //
    // MARKING IS NOT REMOVING. This calls Plaid not at all and deletes nothing.
    // It reconciles our record with a state Plaid has already confirmed, which
    // is the one action that is safe precisely BECAUSE the Item is gone.
    if (status.liveness === "gone" && row.status !== "disconnected") {
      const fixed = await sql.begin(async (tx) => {
        await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;
        return tx`
          update plaid_items
             set status = 'disconnected', updated_at = now()
           where item_id = ${itemId} and household_id = ${householdId}
          returning id
        `;
      });
      return {
        itemId, dryRun: false, liveness: status.liveness, plaidDetail: status.detail,
        statusWas: row.status, reconciled: true, rowsMarked: fixed.length,
      };
    }

    if (status.liveness !== "live") {
      return {
        itemId, dryRun: false, liveness: status.liveness, plaidDetail: status.detail,
        statusWas: row.status,
        refused: `Plaid reports this Item as ${status.liveness}, not live`,
      };
    }
    if (!row.ciphertext) {
      return {
        itemId, dryRun: false, liveness: status.liveness, plaidDetail: status.detail,
        statusWas: row.status, refused: "no token held, so the Item cannot be removed from here",
      };
    }

    const token = await decryptToken(row.ciphertext, encryptionKey);
    const body = await callPlaid<{ request_id?: string }>("/item/remove", credentials, {
      access_token: token,
    });

    // THE PLAID CALL CANNOT SIT INSIDE A DATABASE TRANSACTION, so this is the
    // one place the two can disagree: the Item is gone and our row still says
    // healthy. It is recorded rather than papered over. The window is one
    // statement, the next status read reports the truth, and the repair is to
    // set the status by hand or let the purge remove the row entirely.
    // THE GUC, IN A TRANSACTION WITH THE WRITE IT SCOPES. Shipped without it on
    // 20 Aug 2026 and the Item was removed at Plaid while this UPDATE matched
    // NOTHING and raised nothing: migration 0026's sync_worker_read is
    // USING (true), so the SELECT above succeeded, and sync_worker_write
    // requires the household, so an unset setting made the predicate NULL.
    //
    // THE STATEMENT NAMING THE HOUSEHOLD IS NOT THE SAME REQUIREMENT AS THE
    // POLICY READING IT. This UPDATE already carried household_id in its WHERE
    // clause, which is what every-write-declares-a-household checks, and it was
    // still refused, because the policy reads a SETTING rather than the
    // statement. Two mechanisms, both required, and satisfying one says nothing
    // about the other.
    //
    // It was visible only because this returns rows ACTUALLY updated. Reporting
    // the id it was handed would have said rowsMarked 1 and been wrong.
    const marked = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;
      return tx`
        update plaid_items
           set status = 'disconnected', updated_at = now()
         where item_id = ${itemId} and household_id = ${householdId}
        returning id
      `;
    });

    return {
      itemId,
      dryRun: false,
      liveness: status.liveness,
      plaidDetail: status.detail,
      statusWas: row.status,
      removed: true,
      requestId: body.request_id ?? null,
      rowsMarked: marked.length,
    };
  } finally {
    await sql.end();
  }
}
