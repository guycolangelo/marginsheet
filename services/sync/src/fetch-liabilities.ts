// Cash Flow's committed outflow: what the payment will be, and when.
//
// last_statement_balance paired with next_payment_due_date is a KNOWN AMOUNT ON
// A KNOWN DATE, which is why it renders as committed rather than estimated, and
// it is why the cards were connected. Everything around it existed before this
// file did: the table since 0002, the grants since 0023, the consent in
// config/plaid-consent.json. NOTHING CALLED THE ENDPOINT.
//
// TWO PROPERTIES THAT SHAPED THIS, NEITHER OF WHICH IS THE FETCH.
//
// BILLED ON FIRST USE, so the sync will not call this for an Item whose
// liabilities_enabled_at is null. A recurring per-Item charge must not begin as
// a side effect of a sync somebody triggered for transactions.
//
// AND CONSENT IS NOT COVERAGE. An institution may not support Liabilities, may
// support it and report nothing for one card, or may report fully. An empty
// liability_details row expresses all three identically, so each account gets a
// liability_coverage value at the moment the answer is knowable: 'unsupported'
// when the Item is refused, 'not_reported' when the call SUCCEEDS and the
// account is absent from the response, 'reported' when it is present.
//
// THE DISTINCTION IS NOT COSMETIC. Under 'reported', a null statement balance
// is a card with nothing owed. Under the other two it is a figure we do not
// have, and a surface that renders those the same has told a household its
// committed outflow is zero when it does not know.

import { callPlaid, type PlaidCredentials, type PlaidError } from "./plaid-client.js";
import type { Tx } from "./apply-streams.js";

export interface LiabilitiesOutcome {
  itemId: string;
  fetched: boolean;
  /** Why not, when not. Never a bare false. */
  reason: string;
  accountsReported: number;
  accountsNotReported: number;
  unsupported: boolean;
}

interface CreditLiability {
  account_id: string;
  last_statement_balance?: number | null;
  last_statement_issue_date?: string | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: string | null;
  last_payment_date?: string | null;
  last_payment_amount?: number | null;
  is_overdue?: boolean | null;
  aprs?: Array<{ apr_type?: string | null; apr_percentage?: number | null; balance_subject_to_apr?: number | null }> | null;
}

/** Plaid returns an Item-level refusal when the institution cannot serve the
 *  product at all. Those mean UNSUPPORTED rather than broken, and they are the
 *  only errors that set coverage: anything else leaves it alone, because a
 *  transient failure is not evidence about what an institution supports.
 *
 *  READ FROM THE TYPED FIELD, NEVER OFF A CAST. `toJSON()` emits `errorCode`
 *  and a cast naming `error_code` produced a classifier that could never
 *  return its positive value, which cost a disconnect repair and a purge gate
 *  on 20 Aug 2026. */
const UNSUPPORTED_CODES = new Set([
  "PRODUCTS_NOT_SUPPORTED",
  "PRODUCT_NOT_READY",
  "NO_LIABILITY_ACCOUNTS",
  "INVALID_PRODUCT",
]);

export async function fetchLiabilities(
  tx: Tx,
  householdId: string,
  item: { id: string; itemId: string; accessToken: string; enabledAt: string | null },
  credentials: PlaidCredentials
): Promise<LiabilitiesOutcome> {
  if (item.enabledAt === null) {
    // NOT AN ERROR AND NOT A SKIP TO BE COUNTED. Liabilities has not been paid
    // for on this Item, and starting the charge is a decision somebody makes
    // through /internal/enable-liabilities rather than one a sync makes.
    return {
      itemId: item.itemId, fetched: false, unsupported: false,
      accountsReported: 0, accountsNotReported: 0,
      reason: "liabilities is not enabled for this Item, so no call was made and no charge was started",
    };
  }

  let credit: CreditLiability[];
  try {
    const body = await callPlaid<{ liabilities?: { credit?: CreditLiability[] | null } }>(
      "/liabilities/get", credentials, { access_token: item.accessToken }
    );
    credit = body.liabilities?.credit ?? [];
  } catch (error) {
    const e = error as PlaidError;
    if (e.errorCode && UNSUPPORTED_CODES.has(e.errorCode)) {
      // EVERY credit account on this Item, because the refusal is Item-level.
      await tx`
        update financial_accounts
           set liability_coverage = 'unsupported', updated_at = now()
         where household_id = ${householdId}
           and plaid_item_id = ${item.id}
           and type = 'credit'
      `;
      return {
        itemId: item.itemId, fetched: false, unsupported: true,
        accountsReported: 0, accountsNotReported: 0,
        reason: `the institution does not serve Liabilities for this Item (${e.errorCode}), so no card on it has a committed outflow we can see`,
      };
    }
    throw error;
  }

  // WRITTEN FIRST, THEN THE ABSENCES MARKED, so a card that stopped being
  // reported moves from 'reported' to 'not_reported' rather than keeping a
  // stale value. The order matters: marking absences first would clear the
  // rows this loop is about to set.
  let reported = 0;
  for (const c of credit) {
    const rows = (await tx`
      update financial_accounts
         set liability_coverage = 'reported', updated_at = now()
       where household_id = ${householdId} and plaid_account_id = ${c.account_id}
      returning id
    `) as { id: string }[];
    if (rows.length === 0) continue; // an account of another household's Item, or one we do not hold
    const accountId = rows[0].id;
    reported += 1;

    const apr = (type: string) =>
      c.aprs?.find((a) => (a.apr_type ?? "").toLowerCase().includes(type))?.apr_percentage ?? null;

    await tx`
      insert into liability_details (
        household_id, account_id, last_statement_balance, last_statement_date,
        minimum_payment, next_payment_due_date, last_payment_date, last_payment_amount,
        purchase_apr, cash_apr, balance_transfer_apr, is_overdue, fetched_at
      )
      values (
        ${householdId}, ${accountId}, ${c.last_statement_balance ?? null},
        ${c.last_statement_issue_date ?? null}::date, ${c.minimum_payment_amount ?? null},
        ${c.next_payment_due_date ?? null}::date, ${c.last_payment_date ?? null}::date,
        ${c.last_payment_amount ?? null}, ${apr("purchase")}, ${apr("cash")},
        ${apr("balance_transfer")}, ${c.is_overdue ?? false}, now()
      )
      on conflict (account_id) do update
        set last_statement_balance = excluded.last_statement_balance,
            last_statement_date = excluded.last_statement_date,
            minimum_payment = excluded.minimum_payment,
            next_payment_due_date = excluded.next_payment_due_date,
            last_payment_date = excluded.last_payment_date,
            last_payment_amount = excluded.last_payment_amount,
            purchase_apr = excluded.purchase_apr,
            cash_apr = excluded.cash_apr,
            balance_transfer_apr = excluded.balance_transfer_apr,
            is_overdue = excluded.is_overdue,
            fetched_at = now(),
            updated_at = now()
    `;
  }

  // THE CALL SUCCEEDED AND THESE CARDS WERE NOT IN IT. That is a different
  // sentence from 'unsupported' and a very different one from 'nothing owed',
  // and it is the state that would otherwise be an empty row.
  const missed = (await tx`
    update financial_accounts
       set liability_coverage = 'not_reported', updated_at = now()
     where household_id = ${householdId}
       and plaid_item_id = ${item.id}
       and type = 'credit'
       and liability_coverage <> 'reported'
    returning id
  `) as { id: string }[];

  return {
    itemId: item.itemId, fetched: true, unsupported: false,
    accountsReported: reported, accountsNotReported: missed.length,
    reason: reported === 0
      ? "the institution serves Liabilities and reported no cards on this Item"
      : `reported ${reported} card${reported === 1 ? "" : "s"}`,
  };
}
