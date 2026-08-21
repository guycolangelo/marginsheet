// 4.7: Plaid's recurring streams into commitments.
//
// WHY IT EXISTS AT ALL. projection-spec section 6 wants a commitments list on
// day one, before the census has asked anything, and plaid_recurring is the
// bootstrap: authority 1, the lowest, because it is a detection rather than a
// statement. Everything else overrides it.
//
// AUTHORITY LIVES IN THE UPSERT'S WHERE CLAUSE, NOT IN A CONVENTION. Enforced
// by recurring-authority.test.ts, which drives this function against a real
// database with a stored commitment from each higher source. commitments_stream_unique
// keys on (household, merchant_key, direction, cadence, account), so a second
// import collides with whatever wrote that stream last. If the census corrected
// a cadence or a household stated an amount, a blind DO UPDATE would overwrite
// it on the next sync and the correction would evaporate silently. THE LIST OF
// SOURCES THIS MAY OVERWRITE IS DERIVED FROM overrides() rather than restated,
// so it cannot drift from the authority table.
//
// BILLING IS NOT SETTLED AND THIS DOES NOT RUN AUTOMATICALLY. Liabilities is
// billed per Item per month from first use, and the same question has not been
// answered for Recurring Transactions. Twelve hours after learning that lesson
// is the wrong time to assume the answer, so this is reachable only through
// /internal/import-recurring and the sync does not call it. Recorded in
// docs/open-items.json with the question stated.

import { callPlaid, type PlaidCredentials } from "./plaid-client.js";
import { normalizeMerchantKey } from "@marginsheet/shared/merchant";
import { COMMITMENT_SOURCE_AUTHORITY, overrides, type CommitmentSource } from "@marginsheet/shared/commitments";
import type { Tx } from "./apply-streams.js";

/** Plaid's frequencies, mapped to ours.
 *
 *  OUR ENUM IS WIDER AND THAT IS THE POINT. every_other_month, quarterly and
 *  semiannual have no Plaid equivalent, which is exactly what the census is for:
 *  "the long cadences Plaid misses" is the authority table's own description of
 *  census, and this map is where that gap becomes visible rather than implied. */
const CADENCE: Record<string, string> = {
  WEEKLY: "weekly",
  BIWEEKLY: "biweekly",
  SEMI_MONTHLY: "semimonthly",
  MONTHLY: "monthly",
  ANNUALLY: "annual",
  UNKNOWN: "irregular",
};

interface Stream {
  stream_id: string;
  account_id: string;
  description?: string | null;
  merchant_name?: string | null;
  frequency?: string | null;
  average_amount?: { amount?: number | null } | null;
  last_amount?: { amount?: number | null } | null;
  predicted_next_date?: string | null;
  is_active?: boolean | null;
  status?: string | null;
}

export interface RecurringOutcome {
  itemId: string;
  streamsSeen: number;
  written: number;
  /** Streams whose stored commitment came from a HIGHER authority and was left
   *  alone. Reported rather than silent: a household wondering why its stated
   *  amount survived should be able to see that it did. */
  deferredToHigherAuthority: number;
  unmatchedAccounts: number;
  irregular: number;
}

export async function importRecurring(
  tx: Tx,
  householdId: string,
  item: { id: string; itemId: string; accessToken: string },
  credentials: PlaidCredentials
): Promise<RecurringOutcome> {
  const body = await callPlaid<{
    inflow_streams?: Stream[] | null;
    outflow_streams?: Stream[] | null;
  }>("/transactions/recurring/get", credentials, { access_token: item.accessToken });

  // DERIVED FROM THE AUTHORITY TABLE, NEVER LISTED HERE. plaid_recurring is the
  // lowest authority so today this is exactly ['plaid_recurring'], and writing
  // that literal would be a second statement of the same fact that stops
  // agreeing the moment the table changes.
  const overwritable = (Object.keys(COMMITMENT_SOURCE_AUTHORITY) as CommitmentSource[])
    .filter((stored) => overrides("plaid_recurring", stored));

  const streams: Array<{ s: Stream; direction: "inflow" | "outflow" }> = [
    ...(body.inflow_streams ?? []).map((s) => ({ s, direction: "inflow" as const })),
    ...(body.outflow_streams ?? []).map((s) => ({ s, direction: "outflow" as const })),
  ];

  let written = 0, deferred = 0, unmatched = 0, irregular = 0;

  for (const { s, direction } of streams) {
    const raw = s.merchant_name ?? s.description ?? "";
    if (raw.trim() === "") continue;
    const merchantKey = normalizeMerchantKey(raw);
    const cadence = CADENCE[(s.frequency ?? "UNKNOWN").toUpperCase()] ?? "irregular";
    if (cadence === "irregular") irregular += 1;

    // NAMES THE HOUSEHOLD, because plaid_account_id is PLAID'S namespace and two
    // households linking the same bank login see the same value.
    const accounts = (await tx`
      select id from financial_accounts
       where household_id = ${householdId} and plaid_account_id = ${s.account_id}
    `) as { id: string }[];
    if (accounts.length === 0) { unmatched += 1; continue; }

    const amount = s.average_amount?.amount ?? s.last_amount?.amount ?? null;
    if (amount === null) continue;

    // FIXED ON PLAID'S AVERAGE, NEVER A BAND BUILT FROM TWO SAMPLES. Plaid
    // supplies an average and a last amount and no range. Constructing a band
    // from those two would be inventing an estimate, and estimates are sourced
    // or asked, never invented. A band arrives from the census or from a
    // household statement, both of which outrank this.
    const expectedAmount = Math.abs(amount);

    // is_active false means Plaid has stopped believing this recurs. That is
    // ENDED rather than PAUSED: paused is a household decision and nothing
    // Plaid reports can express one.
    const status = s.is_active === false ? "ended" : "active";

    const rows = (await tx`
      insert into commitments
        (household_id, merchant_key, direction, account_id, cadence,
         expected_amount, next_expected_date, source, status)
      values
        (${householdId}, ${merchantKey}, ${direction}::commitment_direction, ${accounts[0].id},
         ${cadence}::cadence,
         -- BUILT IN SQL RATHER THAN PASSED AS A STRING. A JSON string handed to
         -- a jsonb parameter is serialised again by the driver, so the column
         -- ends up holding a jsonb STRING rather than an object and
         -- expected_amount->>'amount' reads null. The row is written, the shape
         -- looks right in a dump, and every consumer gets nothing.
         jsonb_build_object('kind', 'fixed', 'amount', ${expectedAmount}::numeric),
         ${s.predicted_next_date ?? null}::date,
         'plaid_recurring'::commitment_source, ${status}::commitment_status)
      on conflict (household_id, merchant_key, direction, cadence, account_id) do update
        set expected_amount = excluded.expected_amount,
            next_expected_date = excluded.next_expected_date,
            status = excluded.status,
            updated_at = now()
        where commitments.source = any(${overwritable}::commitment_source[])
      returning id
    `) as { id: string }[];

    if (rows.length === 1) written += 1;
    else deferred += 1;
  }

  return {
    itemId: item.itemId,
    streamsSeen: streams.length,
    written,
    deferredToHigherAuthority: deferred,
    unmatchedAccounts: unmatched,
    irregular,
  };
}
