// Finishing a reconnect, which until now had no path at all.
//
// reconnectItem mints a link token in UPDATE mode and markReconnected sets the
// Item healthy again. NEITHER HAD A CALLER. So an Item in needs_reauth could be
// offered a repair and could never accept one: the only recovery was disconnect
// and relink, which is a household-visible re-consent AND loses the Item's
// history window, because Plaid issues new ids and days_requested cannot be
// changed on an existing Item.
//
// IT ASKS PLAID BEFORE IT MARKS ANYTHING, and that is the whole of this file.
// Link update mode reuses the existing access token, so nothing is exchanged
// and there is no return value proving the repair worked. A completion route
// that simply marked the Item healthy would be CLAIMING A REPAIR IT HAD NOT
// VERIFIED, and the household would see a healthy account that is not syncing,
// which markReconnected's own comment already names as worse than leaving the
// status set.
//
// SO THE PLAID CALL IS THE EVIDENCE. /item/get answers whether the credential
// works right now, and only "live" marks the row.

import { itemStatus } from "./item-status.js";
import { markReconnected } from "./reconnect.js";
import type { PlaidCredentials } from "./plaid-client.js";

export interface ReconnectCompletion {
  itemId: string;
  liveness: "live" | "gone" | "unknown";
  marked: number;
  repaired: boolean;
  note: string;
  detail?: unknown;
}

export async function completeReconnect(
  householdId: string,
  itemRowId: string,
  plaidItemId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string
): Promise<ReconnectCompletion> {
  const status = await itemStatus(householdId, plaidItemId, credentials, encryptionKey, databaseUrl);

  if (status.liveness !== "live") {
    // NOT AN ERROR, AND THE DISTINCTION MATTERS TO WHOEVER IS LOOKING AT LINK.
    // A household can close update mode without finishing, or finish against
    // an institution that still refuses. Both leave the Item exactly as it
    // was, which is the correct outcome: needs_reauth is still true.
    return {
      itemId: plaidItemId,
      liveness: status.liveness,
      marked: 0,
      repaired: false,
      detail: status.detail,
      note:
        status.liveness === "gone"
          ? "Plaid reports this Item is gone, so there is nothing to repair. It needs a fresh connection rather than an update."
          : "Plaid does not report this Item as live, so the reconnect did not take. The Item is left in needs_reauth, which is what it still is.",
    };
  }

  const { marked } = await markReconnected(itemRowId, householdId, databaseUrl);

  // ROWS ACTUALLY MARKED. Zero with a live Item means the row belongs to
  // another household or the GUC did not survive, and reporting "repaired"
  // from a live Plaid answer alone would be the disconnect's defect inverted:
  // there, the Item was removed and the row was never marked.
  return {
    itemId: plaidItemId,
    liveness: "live",
    marked,
    repaired: marked === 1,
    note:
      marked === 1
        ? "Plaid reports the Item live and the row is marked healthy. Its next sync resumes from last_completed_cursor."
        : "Plaid reports the Item live and NO ROW WAS MARKED. The Item is not this household's, or the household setting did not reach the statement.",
  };
}
