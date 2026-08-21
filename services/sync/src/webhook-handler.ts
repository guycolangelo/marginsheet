// What a verified Plaid webhook does. 4.5's remaining half.
//
// THE ORDER IS VERIFY, RECORD, DISPATCH, and each step exists because the one
// before it is not enough. Verification is done by the caller before this runs.
// Recording is check-and-insert on provider_events, so a retry storm produces
// ONE sync and zero duplicate transactions, which is invariant 1. Dispatch goes
// through the household's Durable Object, so two webhooks for one household
// never run concurrent syncs.
//
// THE LOCK NOW HAS A JOB. It has been built and tested since 4.5a and has never
// had two concurrent callers in production, because the only caller was a
// person clicking once. This is what gives it work, and it is also the first
// time this system does anything nobody is watching.

import postgres from "postgres";
import type { PlaidCredentials } from "./plaid-client.js";

export interface WebhookResult {
  webhookType: string | null;
  webhookCode: string | null;
  itemId: string | null;
  /** False when this exact event was already recorded, which is a retry. */
  firstTime: boolean;
  /** Null when the event needs no sync, or when no Item matched. */
  dispatched: unknown;
  note?: string;
}

/** THE IDEMPOTENCY KEY, AND ITS LIMITATION IS STATED RATHER THAN GLOSSED.
 *
 *  Plaid webhooks carry no universal event id: SYNC_UPDATES_AVAILABLE has
 *  webhook_type, webhook_code and item_id and nothing unique. So the key is a
 *  hash of the RAW BODY, which makes a genuine retry, byte-identical by
 *  definition, collapse to one row.
 *
 *  WHAT IT DOES NOT DISTINGUISH: two separate notifications whose bodies are
 *  identical, which for SYNC_UPDATES_AVAILABLE is possible. The consequence is
 *  a skipped sync rather than a duplicated one, and the next webhook or the
 *  watchdog covers it, so the failure direction is the safe one. It is
 *  recorded here rather than assumed away because THE FIRST REAL PAYLOAD WILL
 *  SETTLE IT: WEBHOOK_UPDATE_ACKNOWLEDGED is the acceptance criterion for this
 *  task and its body is the first Plaid webhook we will have ever inspected. */
async function eventKey(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Codes that mean transactions changed and a sync should run. Anything else is
 *  recorded and not acted on, which is deliberate: an unrecognised code should
 *  leave a row somebody can read rather than trigger work nobody designed. */
const SYNC_CODES = new Set(["SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "INITIAL_UPDATE", "HISTORICAL_UPDATE"]);

export async function handlePlaidWebhook(
  rawBody: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string,
  lock: DurableObjectNamespace | undefined
): Promise<WebhookResult> {
  const body = JSON.parse(rawBody) as {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
  };
  const webhookType = body.webhook_type ?? null;
  const webhookCode = body.webhook_code ?? null;
  const itemId = body.item_id ?? null;

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // THE HOUSEHOLD COMES FROM THE ITEM, NEVER FROM THE PAYLOAD. Plaid's
    // namespace is shared across every household, so the lookup names what we
    // hold rather than trusting what arrived.
    const [item] = itemId
      ? await sql<{ id: string; household_id: string }[]>`
          select id, household_id from plaid_items where item_id = ${itemId}
        `
      : [];

    // CHECK AND INSERT IN ONE STATEMENT, INSIDE A TRANSACTION THAT DECLARES THE
    // HOUSEHOLD. A select followed by an insert is two statements a retry can
    // interleave, and the unique index on (source, event_id) is what actually
    // decides: ON CONFLICT DO NOTHING with RETURNING tells us whether we were
    // first WITHOUT a race.
    //
    // THE GUC IS SET HERE AND THE FIRST VERSION DID NOT SET IT, which is the
    // third instance of that class and the first caught before shipping.
    // 0026's sync_worker_write on provider_events reads
    // `household_id IS NULL OR household_id = current_setting(...)`, so an
    // ATTRIBUTED event written without the setting matches nothing and raises
    // nothing, exactly as the disconnect's UPDATE did. An unattributed event
    // would have kept working, which is what would have made it invisible: the
    // failing case is the one where we know whose it is.
    //
    // Refused by every-write-declares-a-household before it left the machine.
    const key = await eventKey(rawBody);
    const { inserted, eventRowId } = await sql.begin(async (tx) => {
      if (item) await tx`select set_config('marginsheet.household_id', ${item.household_id}, true)`;
      const rows = (await tx`
        insert into provider_events (household_id, source, event_id, event_type, payload)
        values (${item?.household_id ?? null}, 'plaid', ${key}, ${webhookCode},
                ${sql.json(JSON.parse(rawBody))})
        on conflict (source, event_id) do nothing
        returning id
      `) as { id: string }[];
      return { inserted: rows.length > 0, eventRowId: rows[0]?.id };
    });
    const firstTime = inserted;

    // processed_at MEANS "THE RECEIVER FINISHED WITH THIS EVENT", NOT "A SYNC
    // RAN", and the difference was nearly a false alarm.
    //
    // The first version set it only after a successful dispatch. Most webhook
    // codes do not ask for a sync, so every one of them would have sat with
    // processed_at null forever, and the acceptance criterion for this whole
    // task, WEBHOOK_UPDATE_ACKNOWLEDGED, is one of them: it would have appeared
    // in the readout looking exactly like the failure the field exists to show.
    //
    // A FIELD WHOSE NORMAL CASE LOOKS LIKE ITS FAILURE CASE IS NOT A SIGNAL.
    // It now marks completion on every path the handler reaches deliberately,
    // and stays null only when the handler did not finish: a crash, a throw, a
    // dispatch that failed. That is the state worth stopping for.
    const finish = async (note: string, dispatched: unknown = null): Promise<WebhookResult> => {
      if (eventRowId) {
        await sql.begin(async (tx) => {
          if (item) await tx`select set_config('marginsheet.household_id', ${item.household_id}, true)`;
          await tx`update provider_events set processed_at = now(), updated_at = now() where id = ${eventRowId}`;
        });
      }
      return { webhookType, webhookCode, itemId, firstTime, dispatched, note };
    };

    if (!firstTime) {
      // Not marked: the row belongs to the first delivery, which marked itself.
      // Marking here would overwrite that timestamp with a retry's.
      return { webhookType, webhookCode, itemId, firstTime: false, dispatched: null, note: "already recorded, so no sync was dispatched" };
    }
    if (!item) return finish("no Item of ours matches this item_id");
    if (!webhookCode || !SYNC_CODES.has(webhookCode)) {
      return finish("recorded and handled; this code does not ask for a sync");
    }
    if (!lock) return finish("recorded; no HOUSEHOLD_SYNC binding to dispatch through");

    // THROUGH THE LOCK, NEVER AROUND IT. Two webhooks for one household meet
    // here and the second waits.
    const stub = lock.get(lock.idFromName(item.household_id));
    const response = await stub.fetch(
      new Request("https://sync.internal/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ householdId: item.household_id, itemRowId: item.id }),
      })
    );
    const dispatched = await response.json().catch(() => ({ error: `the lock returned ${response.status}` }));

    return finish("dispatched through the household lock", dispatched);
  } finally {
    await sql.end();
  }
}
