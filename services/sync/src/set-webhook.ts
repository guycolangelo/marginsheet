// Pointing an existing Item at the receiver.
//
// The production Item was created deliberately without a webhook, because the
// receiver did not exist and an Item calling a URL nobody answers is worse than
// one that calls nothing. This is the other half of that decision.
//
// IT IS THE SWITCH THAT TURNS ON UNATTENDED OPERATION. After this call, syncs
// fire without anybody watching, which is why it takes a confirm and reports
// what it will do first, exactly like the purge and the disconnect.

import postgres from "postgres";
import { callPlaid, type PlaidCredentials } from "./plaid-client.js";
import { decryptToken } from "./token-crypto.js";

export interface SetWebhookResult {
  itemId: string;
  dryRun: boolean;
  webhookUrl: string;
  willDo?: string[];
  requestId?: string | null;
  refused?: string;
}

export async function setItemWebhook(
  householdId: string,
  itemId: string,
  webhookUrl: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string,
  apply: boolean
): Promise<SetWebhookResult> {
  // HTTPS ONLY, AND REFUSED RATHER THAN COERCED. A webhook URL is where a
  // provider will send household-shaped events; accepting a plain http one
  // because it looked like a typo is a decision nobody took.
  if (!webhookUrl.startsWith("https://")) {
    return { itemId, dryRun: !apply, webhookUrl, refused: "the webhook URL is not https" };
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [item] = await sql<{ ciphertext: string | null }[]>`
      select access_token_ciphertext as ciphertext
        from plaid_items where item_id = ${itemId} and household_id = ${householdId}
    `;
    if (!item) return { itemId, dryRun: !apply, webhookUrl, refused: "no such item for this household" };
    if (!item.ciphertext) return { itemId, dryRun: !apply, webhookUrl, refused: "no token held" };

    if (!apply) {
      return {
        itemId,
        dryRun: true,
        webhookUrl,
        willDo: [
          `point this Item's webhook at ${webhookUrl}, with no relink and no Link update mode`,
          "cause Plaid to fire WEBHOOK_UPDATE_ACKNOWLEDGED at that URL, which is this task's acceptance criterion",
          "make every later Plaid notification arrive without anybody watching, which is the actual change",
        ],
      };
    }

    const token = await decryptToken(item.ciphertext, encryptionKey);
    const body = await callPlaid<{ request_id?: string }>("/item/webhook/update", credentials, {
      access_token: token,
      webhook: webhookUrl,
    });
    return { itemId, dryRun: false, webhookUrl, requestId: body.request_id ?? null };
  } finally {
    await sql.end();
  }
}
