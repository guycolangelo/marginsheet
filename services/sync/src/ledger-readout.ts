// The Plaid half of the ledger readout. THROWAWAY, like the connect surface.
//
// WHY IT EXISTS AT ALL, AND IT IS THE ONLY REASON WORTH THE CODE. A readout
// built from our own tables can only ever agree with itself. It can say we hold
// 201 transactions and it cannot say whether 201 is WHAT EXISTS or WHAT WE
// KEPT, because both answers produce the same rows. /transactions/get returns
// total_transactions for a window, computed by Plaid over the same Item, and it
// is the only statement available from outside our pipeline (Guy, 20 Aug 2026).
//
// PER ACCOUNT AS WELL AS PER ITEM, for the reason the two-member household
// mattered: a uniform backfill window is an ASSUMPTION, and six accounts on one
// login can answer differently. An Item-level total that matches hides an
// account that returned nothing.
//
// THE WINDOW IS DELIBERATELY WIDER THAN ANY WE EXPECT. Asking for 730 days and
// receiving 90 days of transactions IS the finding; asking for 90 would make
// the answer agree with the question.

import postgres from "postgres";
import { callPlaid, type PlaidCredentials } from "./plaid-client.js";
import { decryptToken } from "./token-crypto.js";

const WINDOW_DAYS = 730;

interface TransactionsGetResponse {
  total_transactions: number;
  transactions: Array<{ date: string; account_id: string }>;
}

export interface PlaidAccountTotal {
  plaidAccountId: string;
  totalTransactions: number | null;
  oldestInWindow: string | null;
  error?: unknown;
}

export interface PlaidItemTotal {
  window: { startDate: string; endDate: string };
  totalTransactions: number | null;
  oldestInWindow: string | null;
  error?: unknown;
  accounts: PlaidAccountTotal[];
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Asks Plaid how many transactions exist for this Item, and for each account.
 *
 *  EVERY FAILURE IS RETURNED RATHER THAN THROWN. A cross-check that dies on the
 *  first refusal tells you nothing about the other five accounts, and
 *  PRODUCT_NOT_READY on one account is itself an answer worth seeing. The raw
 *  error travels so the reader can disagree with any interpretation of it. */
export async function plaidTotals(
  accessToken: string,
  plaidAccountIds: string[],
  credentials: PlaidCredentials
): Promise<PlaidItemTotal> {
  const startDate = isoDay(WINDOW_DAYS);
  const endDate = isoDay(0);
  const window = { startDate, endDate };

  // count 1 rather than 0: we want total_transactions, and one transaction back
  // is the cheapest way to also learn a real date from Plaid's own copy.
  const ask = async (accountIds?: string[]) =>
    callPlaid<TransactionsGetResponse>("/transactions/get", credentials, {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        count: 1,
        offset: 0,
        ...(accountIds ? { account_ids: accountIds } : {}),
      },
    });

  let totalTransactions: number | null = null;
  let oldestInWindow: string | null = null;
  let itemError: unknown;
  try {
    const body = await ask();
    totalTransactions = body.total_transactions;
    oldestInWindow = body.transactions[0]?.date ?? null;
  } catch (error) {
    const shaped = error as { toJSON?: () => unknown; message?: string };
    itemError = shaped.toJSON ? shaped.toJSON() : { message: shaped.message ?? "unknown" };
  }

  const accounts: PlaidAccountTotal[] = [];
  for (const plaidAccountId of plaidAccountIds) {
    try {
      const body = await ask([plaidAccountId]);
      accounts.push({
        plaidAccountId,
        totalTransactions: body.total_transactions,
        oldestInWindow: body.transactions[0]?.date ?? null,
      });
    } catch (error) {
      const shaped = error as { toJSON?: () => unknown; message?: string };
      accounts.push({
        plaidAccountId,
        totalTransactions: null,
        oldestInWindow: null,
        error: shaped.toJSON ? shaped.toJSON() : { message: shaped.message ?? "unknown" },
      });
    }
  }

  return { window, totalTransactions, oldestInWindow, error: itemError, accounts };
}

/** The whole readout for a household: lookup, decrypt, ask Plaid.
 *
 *  THE TOKEN NEVER LEAVES THIS MODULE, which is why the lookup lives here
 *  rather than in the Worker entry point. The first version selected
 *  access_token_ciphertext in index.ts and plaid-call-sites.test.ts refused it
 *  on the spot: that file already calls fetch, so a file that also names a
 *  token is a file that could build a Plaid request outside the one module the
 *  leak probe guards. The control was right and the code moved, which is the
 *  second time this exact control has moved code rather than the reverse. */
export async function readoutForHousehold(
  householdId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string
): Promise<Array<{ itemId: string } & Partial<PlaidItemTotal> & { error?: unknown }>> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // ONE TRANSACTION, for the same reason as everywhere else: set_config's
    // third argument is is_local. It changes no behaviour on THIS path, because
    // sync_worker_access is USING (true) and the household predicate is written
    // into the statement, and it is fixed anyway: a pattern that is correct
    // only because of a policy elsewhere is one somebody copies to a path where
    // that policy does not apply.
    const items = await sql.begin(async (tx) => {
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;
      return tx<{ id: string; item_id: string; ciphertext: string | null }[]>`
        select id, item_id, access_token_ciphertext as ciphertext
          from plaid_items where household_id = ${householdId} order by created_at
      `;
    });

    const results = [];
    for (const item of items) {
      if (!item.ciphertext) {
        results.push({ itemId: item.item_id, error: "no token held" });
        continue;
      }
      // Scoped by household as well as by our own item id. The id is ours and
      // cannot collide, so this is defence in depth rather than a fix.
      const accounts = await sql<{ plaid_account_id: string }[]>`
        select plaid_account_id from financial_accounts
         where plaid_item_id = ${item.id} and household_id = ${householdId}
         order by plaid_account_id
      `;
      const token = await decryptToken(item.ciphertext, encryptionKey);
      results.push({
        itemId: item.item_id,
        ...(await plaidTotals(token, accounts.map((a) => a.plaid_account_id), credentials)),
      });
    }
    return results;
  } finally {
    await sql.end();
  }
}
