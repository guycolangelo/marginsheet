// Reconnect, in Plaid's update mode (M4 task 4.3.4).
//
// KEYED ON THE ITEM, NEVER ON THE INSTITUTION (ruled 18 Aug 2026). An Item is a
// LOGIN. A household with a personal and a business login at one bank has two
// credential sets, two authorizations, and Plaid bills for two.
//
// institution_id is the field that LOOKS like identity: stable,
// human-meaningful, what a UI groups by, and one row per bank is what a
// household would draw on a whiteboard. Keying reconnect there finds the wrong
// Item, updates it, and ORPHANS THE OTHER, which then stops syncing while
// still appearing connected. No error. That is why the lookup below takes an
// item row id and nothing else, and why the test asserts on the Item that was
// NOT touched.

import postgres from "postgres";
import { callPlaid, type PlaidCredentials } from "./plaid-client.js";
import { decryptToken } from "./token-crypto.js";

export interface ReconnectResult {
  /** The Plaid link_token the household's browser opens in update mode. */
  linkToken: string;
  /** The Item being repaired. Returned so a caller cannot mistake which. */
  itemId: string;
}

/** Mints an update-mode link token for ONE Item, identified by its row id.
 *
 * Takes the item row id rather than a household plus an institution, because a
 * signature that cannot express the wrong lookup cannot perform it. */
export async function reconnectItem(
  itemRowId: string,
  householdId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string
): Promise<ReconnectResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [row] = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;
      // BY ID. Not by institution, not by "the household's item at this bank".
      return await tx<{ item_id: string; access_token_ciphertext: string | null }[]>`
        select item_id, access_token_ciphertext
          from plaid_items
         where id = ${itemRowId}
      `;
    });

    if (!row) throw new Error(`no plaid_item with id ${itemRowId} for this household`);
    if (!row.access_token_ciphertext) throw new Error(`plaid_item ${itemRowId} holds no token`);

    const accessToken = await decryptToken(row.access_token_ciphertext, encryptionKey);
    const link = await callPlaid<{ link_token: string }>("/link/token/create", credentials, {
      user: { client_user_id: householdId },
      client_name: "MarginSheet",
      country_codes: ["US"],
      language: "en",
      // The presence of access_token is what makes this UPDATE mode rather
      // than a new connection. Its absence would create a second Item, which
      // is the duplicate this task exists to prevent.
      access_token: accessToken,
    });

    return { linkToken: link.link_token, itemId: row.item_id };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Clears needs_reauth on ONE Item, after the household completes update mode. */
export async function markReconnected(
  itemRowId: string,
  householdId: string,
  databaseUrl: string
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;
      // WHERE id, again. A status update keyed on the institution would clear
      // needs_reauth on an Item nobody repaired, which is worse than leaving
      // it set: the household would see a healthy account that is not syncing.
      await tx`
        update plaid_items
           set status = 'healthy', updated_at = now()
         where id = ${itemRowId}
      `;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
