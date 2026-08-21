// Is this Item still live at Plaid? Asked before anything of ours is deleted.
//
// WHY IT EXISTS. Deleting our rows for an Item that is STILL CONNECTED would
// leave a household linked at Plaid, billed monthly, and invisible to us: no
// row, no sync, no way to find it except by reading Plaid's dashboard. That is
// worse than the duplicate ledger the deletion exists to prevent, because a
// duplicate is visible and this is not (Guy, 20 Aug 2026).
//
// IT LIVES IN THE SYNC WORKER because the access token does. api asks over the
// service binding and never holds a token, which is the same division as the
// readout and the link token.
//
// IT FAILS CLOSED. Only two answers permit a deletion, and both are positive
// evidence that the Item is gone rather than an absence of evidence that it is
// live. Anything else, including a network failure or an unrecognised error
// code, returns "unknown" and the caller refuses.

import postgres from "postgres";
import { callPlaid, PlaidError, type PlaidCredentials } from "./plaid-client.js";
import { decryptToken } from "./token-crypto.js";

export type ItemLiveness = "live" | "gone" | "unknown";

export interface ItemStatus {
  itemId: string;
  liveness: ItemLiveness;
  /** Plaid's raw answer, so a reader can disagree with the interpretation
   *  rather than having to trust it. */
  detail: unknown;
}

/** ITEM_NOT_FOUND is Plaid's answer for an Item that has been removed.
 *  INVALID_ACCESS_TOKEN is what a token for a removed Item becomes. Both are
 *  positive evidence of absence; nothing else is treated as such. */
const GONE = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

/** Classifies a failed /item/get. PURE, so it can be tested without a database.
 *
 *  IT READS THE TYPED FIELD RATHER THAN A CAST OBJECT, and that is the fix
 *  rather than the spelling. The first version did
 *  `error.toJSON() as { error_code?: string }` and read `error_code`, while
 *  toJSON emits `errorCode`. The property was always undefined, so this could
 *  NEVER return "gone": the repair branch could not fire and the purge's gate
 *  could not permit a purge. A CAST IS NOT A CHECK. It asserts a shape
 *  TypeScript then stops verifying, which is the same lesson as a cast not
 *  being a filter, one step further on.
 *
 *  Reading `error.errorCode` puts the obligation back in the type system, where
 *  a wrong name fails to compile instead of failing at midnight. */
export function livenessFromError(error: unknown): ItemLiveness {
  if (error instanceof PlaidError) {
    return error.errorCode && GONE.has(error.errorCode) ? "gone" : "unknown";
  }
  return "unknown";
}

export async function itemStatus(
  householdId: string,
  itemId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string
): Promise<ItemStatus> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [item] = await sql<{ item_id: string; ciphertext: string | null }[]>`
      select item_id, access_token_ciphertext as ciphertext
        from plaid_items
       where item_id = ${itemId} and household_id = ${householdId}
    `;
    if (!item) return { itemId, liveness: "unknown", detail: { error: "no such item for this household" } };
    if (!item.ciphertext) {
      // No token means we cannot ask, which is not the same as gone.
      return { itemId, liveness: "unknown", detail: { error: "no token held, so Plaid cannot be asked" } };
    }

    const token = await decryptToken(item.ciphertext, encryptionKey);
    try {
      const body = await callPlaid<{ item: { item_id: string; institution_id?: string } }>(
        "/item/get",
        credentials,
        { access_token: token }
      );
      return { itemId, liveness: "live", detail: { item_id: body.item?.item_id } };
    } catch (error) {
      if (error instanceof PlaidError) {
        // THE INTERPRETATION TRAVELS WITH ITS EVIDENCE, and that is what made
        // the bug above findable in one look: the reply said "unknown" while
        // the detail beside it said ITEM_NOT_FOUND, and a reader could see the
        // contradiction without knowing anything about this file.
        return { itemId, liveness: livenessFromError(error), detail: error.toJSON() };
      }
      const e = error as { message?: string };
      return { itemId, liveness: "unknown", detail: { message: e.message ?? "unknown" } };
    }
  } finally {
    await sql.end();
  }
}
