// Starting a recurring charge, deliberately.
//
// Plaid bills Liabilities PER ITEM PER MONTH FROM FIRST USE, so the first
// /liabilities/get is the moment the money starts. That is what the consent was
// for and it is fine, AND IT MUST NOT BE A SIDE EFFECT OF A SYNC SOMEBODY
// TRIGGERED FOR TRANSACTIONS (Guy, 21 Aug 2026).
//
// So the sync reads plaid_items.liabilities_enabled_at and calls nothing when
// it is null, and only this route sets it. Dry run by default, and the dry run
// REPORTS WHAT IT IS ABOUT TO START PAYING FOR rather than only what it will
// change: a confirmation prompt that does not name the cost is a prompt with
// the important half missing, which is the same rule as the milestone clear
// reporting what would still block a re-fire.
//
// IT DOES NOT CALL PLAID. Setting the flag starts nothing; the next sync makes
// the first call. That separation is deliberate, because it keeps this route
// reversible: clearing the flag before a sync runs leaves no charge started.
// AFTERWARDS IT IS NOT REVERSIBLE BY US, because the billing is Plaid's and
// clearing a column of ours does not stop it. The dry run says so.

import postgres from "postgres";

export interface EnableLiabilitiesResult {
  householdId: string;
  dryRun: boolean;
  /** Per Item, because Plaid bills per Item and not per account. Reporting a
   *  card count here would overstate the cost by an order of magnitude on an
   *  Item holding six of them. */
  items: Array<{
    itemId: string;
    institution: string | null;
    creditAccounts: number;
    alreadyEnabled: boolean;
    billingNote: string;
  }>;
  itemsToEnable: number;
  enabled: number;
  costNote: string;
  refused?: string;
}

export async function enableLiabilities(
  databaseUrl: string,
  householdId: string,
  apply: boolean
): Promise<EnableLiabilitiesResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return (await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;

      const rows = (await tx`
        select pi.item_id,
               i.name as institution,
               (pi.liabilities_enabled_at is not null) as enabled,
               (select count(*)::int from financial_accounts fa
                 where fa.plaid_item_id = pi.id and fa.household_id = pi.household_id
                   and fa.type = 'credit' and fa.is_active) as credit_accounts
          from plaid_items pi
          left join institutions i on i.id = pi.institution_id
         where pi.household_id = ${householdId} and pi.status <> 'disconnected'
         order by i.name nulls last, pi.item_id
      `) as { item_id: string; institution: string | null; enabled: boolean; credit_accounts: number }[];

      const items = rows.map((r) => ({
        itemId: r.item_id,
        institution: r.institution,
        creditAccounts: r.credit_accounts,
        alreadyEnabled: r.enabled,
        billingNote: r.enabled
          ? "already enabled; the charge for this Item has started or will on its next sync"
          : r.credit_accounts === 0
            ? "no credit accounts on this Item, so enabling buys nothing and still starts a charge"
            : `enabling starts ONE per-Item monthly charge covering ${r.credit_accounts} card${r.credit_accounts === 1 ? "" : "s"}`,
      }));

      const pending = rows.filter((r) => !r.enabled);

      if (rows.length === 0) {
        return {
          householdId, dryRun: !apply, items, itemsToEnable: 0, enabled: 0,
          costNote: "no connected Items", refused: "this household has no connected Items",
        };
      }

      const costNote =
        `Plaid bills Liabilities PER ITEM PER MONTH from first use. ${pending.length} Item${pending.length === 1 ? "" : "s"} would begin billing, ` +
        `not ${rows.reduce((t, r) => t + r.credit_accounts, 0)} cards. ` +
        "THE FLAG DOES NOT CALL PLAID: the next sync makes the first call, so clearing it before then starts nothing. " +
        "After that first call the billing is Plaid's and clearing this column does not stop it.";

      if (!apply) {
        return { householdId, dryRun: true, items, itemsToEnable: pending.length, enabled: 0, costNote };
      }

      const updated = (await tx`
        update plaid_items
           set liabilities_enabled_at = now(), updated_at = now()
         where household_id = ${householdId}
           and status <> 'disconnected'
           and liabilities_enabled_at is null
        returning item_id
      `) as { item_id: string }[];

      // Rows ACTUALLY updated, never the count we intended. Those differ when
      // the GUC is unset or a row moved underneath, which is the case this
      // needs to get right.
      return { householdId, dryRun: false, items, itemsToEnable: pending.length, enabled: updated.length, costNote };
    })) as EnableLiabilitiesResult;
  } finally {
    await sql.end();
  }
}
