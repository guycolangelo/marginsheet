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

/** What products an Item actually carries, asked of Plaid.
 *
 *  WHY THIS EXISTS RATHER THAN AN INFERENCE. `additional_consented_products`
 *  is documented as an UPDATE MODE field, and we send it on an initial link
 *  token. Plaid does not reject that, so a successful connection proves
 *  nothing: honored and silently ignored produce the identical result.
 *
 *  A LINK TOKEN PROBE CANNOT DISTINGUISH THE TWO CASES, which is why one was
 *  proposed and withdrawn. Neither can a failed Liabilities call afterwards:
 *  that is ambiguous between consent not taking, the institution not
 *  supporting the product, and something else. `consented_products` answers
 *  the question directly rather than by inference from a failure.
 *
 *  RETURNS THE THREE ARRAYS AND NOTHING ELSE. `/item/get` also returns the
 *  institution id, webhook, error state and consent expiry, and none of that
 *  is what this is for. Enumerating is the same discipline as PlaidError's
 *  toJSON: name what may be published so a field added later is excluded by
 *  default. */
export async function itemProducts(
  householdId: string,
  itemRowId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string
): Promise<{ products: string[]; billedProducts: string[]; consentedProducts: string[] }> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [row] = await sql<{ access_token_ciphertext: string | null }[]>`
      select access_token_ciphertext from plaid_items
       where id = ${itemRowId} and household_id = ${householdId}
    `;
    if (!row) throw new Error(`no plaid_item ${itemRowId} for this household`);
    if (!row.access_token_ciphertext) throw new Error(`plaid_item ${itemRowId} holds no token`);

    const accessToken = await decryptToken(row.access_token_ciphertext, encryptionKey);
    const item = await callPlaid<{
      item: { products?: string[]; billed_products?: string[]; consented_products?: string[] };
    }>("/item/get", credentials, { access_token: accessToken });

    return {
      products: item.item.products ?? [],
      billedProducts: item.item.billed_products ?? [],
      consentedProducts: item.item.consented_products ?? [],
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Mints a link token for a NEW connection (4.5b prime).
 *
 *  THE SAME CALL AS UPDATE MODE, MINUS access_token. Its presence is what makes
 *  a link token repair an existing Item; its absence is what makes Link create
 *  a new one. That single field is the whole difference, which is why both live
 *  in this file rather than in two that drift.
 *
 *  redirect_uri IS REQUIRED FOR OAUTH INSTITUTIONS and must match the Plaid
 *  dashboard allowlist exactly: HTTPS, no fragment, no query string, no
 *  wildcard. Without it, desktop web still works and MOBILE WEBVIEW BREAKS,
 *  which is a failure nobody testing on a laptop would see.
 *
 *  NO webhook FIELD, DELIBERATELY (Guy, 19 Aug 2026). The receiver is 4.5's
 *  other half and does not exist, so setting one would have Plaid retrying into
 *  nothing and generating failures we cannot see. Syncs are manual until the
 *  provider_events path lands, and that is a stated limitation rather than
 *  something to be discovered when a household wonders why nothing updates. */
export async function createLinkToken(
  householdId: string,
  credentials: PlaidCredentials,
  redirectUri: string,
  /** REQUIRED, NOT OPTIONAL, AND THE OMISSION COST TWO LIVE ITEMS.
   *
   *  An Item created without a webhook receives NOTHING from Plaid. Not just no
   *  completion signal: no SYNC_UPDATES_AVAILABLE, no reauth notice, nothing.
   *  It syncs when a person clicks and at no other time, and the ledger goes
   *  stale silently between clicks while every check agrees with it.
   *
   *  On 21 Aug 2026 the readout showed ONE Item with completion flags, SoFi,
   *  which had had its webhook set BY HAND through /plaid/set-webhook. Chase
   *  and Amex had none, because this key was absent here and set-webhook is a
   *  manual repair route rather than part of the connect flow.
   *
   *  IT LOOKED LIKE AN INSTITUTION DIFFERENCE AND IT WAS A FIELD WE NEVER SENT,
   *  which is exactly `days_requested` five days earlier: a uniform absence on
   *  our side, read as a property of the providers. The tell both times was
   *  several institutions agreeing, and CLAUDE.md already says agreement is
   *  evidence about US when one of our parameters reached all of them. */
  webhookUrl: string
): Promise<{ linkToken: string; expiration: string | null }> {
  const link = await callPlaid<{ link_token: string; expiration?: string }>(
    "/link/token/create",
    credentials,
    {
      // client_user_id is the household rather than the member: an Item belongs
      // to a household, and a second member of the same household reconnecting
      // must reach the same Plaid user.
      user: { client_user_id: householdId },
      client_name: "MarginSheet",
      products: ["transactions"],
      webhook: webhookUrl,
      // HOW MUCH HISTORY PLAID PULLS, AND IT IS A FIELD WE NEVER SENT.
      //
      // The default is 90 days and the maximum is 730. Every Item created
      // before 20 Aug 2026 therefore holds 90 days, on every institution,
      // because of an omission rather than an institution limit. SoFi's first
      // sync returned 201 transactions with an oldest date 88 days back, and
      // /transactions/get asked for 24 months returned 202: PLAID ITSELF HOLDS
      // ONLY 90 DAYS FOR THAT ITEM.
      //
      // A projection-spec finding blaming two institutions for a uniform
      // backfill window was about to be written when the window was uniform
      // because we asked all of them the same question.
      //
      // IT CANNOT BE CHANGED LATER. Plaid's reference: "Once Transactions has
      // been added to an Item, this value cannot be updated." Link update mode
      // does not help; extending history on an initialised Item requires
      // /item/remove and a NEW Item. Confirmed against the docs 20 Aug 2026
      // rather than recalled.
      //
      // 730 rather than a smaller number because the year-end projection and
      // the census read SEASONAL SHAPE, which needs two cycles to see one.
      transactions: { days_requested: 730 },
      // CONSENT NOW, BILLED ON FIRST USE. A product cannot be added to an Item
      // after it is created: adding Liabilities later means taking the Item
      // through update mode again. additional_consented_products collects the
      // consent at link time and bills nothing until the endpoint is called,
      // so the credit-card Items connected at 4.5b prime can serve the
      // Liabilities cases without a second trip through Link.
      //
      // Confirmed against Plaid's docs 19 Aug 2026 rather than recalled.
      additional_consented_products: ["liabilities"],
      country_codes: ["US"],
      language: "en",
      redirect_uri: redirectUri,
    }
  );
  return { linkToken: link.link_token, expiration: link.expiration ?? null };
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
