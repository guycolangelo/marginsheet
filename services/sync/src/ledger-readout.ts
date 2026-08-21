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
// ONE CALL PER PAGE OF DATA, NOT ONE CALL PER ACCOUNT. The first version asked
// /transactions/get once per account and once for the Item, and the both-ends
// fix doubled that: eighteen calls for eight accounts, which hit
// RATE_LIMIT_EXCEEDED on 20 Aug 2026 and returned TRANSACTIONS_LIMIT for every
// per-account call while the Item-level call succeeded. The per-account column
// was then SILENT rather than zero, which is the readout's own recurring
// failure shape appearing in the readout.
//
// It now pages the window ONCE at 500 per page and groups client-side. Three
// things follow, and the second two are why this is better rather than merely
// cheaper. The call count scales with DATA rather than with ACCOUNTS. The
// oldest and newest come from min and max over real rows, so the
// most-recent-first ORDERING ASSUMPTION disappears entirely rather than being
// flagged. And having every transaction_id makes the Item-versus-ledger
// difference nameable: not "202 against 201" but WHICH ONE.
//
// THE WINDOW IS DELIBERATELY WIDER THAN ANY WE EXPECT. Asking for 730 days and
// receiving 90 days of transactions IS the finding; asking for 90 would make
// the answer agree with the question.

import postgres from "postgres";
import { callPlaid, type PlaidCredentials } from "./plaid-client.js";
import { decryptToken } from "./token-crypto.js";

const WINDOW_DAYS = 730;
const PAGE = 500;
/** Ten pages, 5000 transactions. A cap rather than a limit anybody should hit:
 *  beyond it the readout reports what it saw and says the ids are incomplete,
 *  because a diagnostic that silently truncates is worse than one that stops. */
const MAX_PAGES = 10;

interface TransactionsGetResponse {
  total_transactions: number;
  transactions: Array<{ transaction_id: string; date: string; account_id: string }>;
}

export interface PlaidAccountTotal {
  plaidAccountId: string;
  totalTransactions: number;
  oldestInWindow: string | null;
  newestInWindow: string | null;
}

export interface PlaidItemTotal {
  window: { startDate: string; endDate: string };
  totalTransactions: number | null;
  fetched: number;
  idsComplete: boolean;
  oldestInWindow: string | null;
  newestInWindow: string | null;
  error?: unknown;
  accounts: PlaidAccountTotal[];
  /** Ids Plaid returned that our ledger does not hold, and the reverse. THE
   *  POINT OF THE WHOLE READOUT IN ONE FIELD: a count difference says something
   *  is missing, and only an id says WHAT, which is the difference between a
   *  discrepancy and a diagnosis. */
  plaidOnly: string[];
  oursOnly: string[];
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Every transaction Plaid holds for this Item in the window, paged once.
 *
 *  EVERY FAILURE IS RETURNED RATHER THAN THROWN, so a refusal on page three
 *  still reports pages one and two and says the ids are incomplete. */
export async function plaidTotals(
  accessToken: string,
  ourIds: Set<string>,
  credentials: PlaidCredentials
): Promise<PlaidItemTotal> {
  const startDate = isoDay(WINDOW_DAYS);
  const endDate = isoDay(0);
  const window = { startDate, endDate };

  const rows: TransactionsGetResponse["transactions"] = [];
  let totalTransactions: number | null = null;
  let error: unknown;
  let idsComplete = false;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await callPlaid<TransactionsGetResponse>("/transactions/get", credentials, {
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: { count: PAGE, offset: page * PAGE },
      });
      totalTransactions = body.total_transactions;
      rows.push(...body.transactions);
      if (rows.length >= body.total_transactions || body.transactions.length === 0) {
        idsComplete = true;
        break;
      }
    }
  } catch (e) {
    const shaped = e as { toJSON?: () => unknown; message?: string };
    error = shaped.toJSON ? shaped.toJSON() : { message: shaped.message ?? "unknown" };
  }

  const byAccount = new Map<string, { total: number; oldest: string; newest: string }>();
  for (const r of rows) {
    const a = byAccount.get(r.account_id);
    if (!a) byAccount.set(r.account_id, { total: 1, oldest: r.date, newest: r.date });
    else {
      a.total += 1;
      if (r.date < a.oldest) a.oldest = r.date;
      if (r.date > a.newest) a.newest = r.date;
    }
  }

  const dates = rows.map((r) => r.date).sort();
  const plaidIds = new Set(rows.map((r) => r.transaction_id));

  return {
    window,
    totalTransactions,
    fetched: rows.length,
    idsComplete,
    oldestInWindow: dates[0] ?? null,
    newestInWindow: dates[dates.length - 1] ?? null,
    error,
    accounts: [...byAccount].map(([plaidAccountId, a]) => ({
      plaidAccountId,
      totalTransactions: a.total,
      oldestInWindow: a.oldest,
      newestInWindow: a.newest,
    })),
    // Only meaningful when the fetch completed; an incomplete page set would
    // report every unfetched id as missing from Plaid, which is backwards.
    plaidOnly: idsComplete ? [...plaidIds].filter((id) => !ourIds.has(id)) : [],
    oursOnly: idsComplete ? [...ourIds].filter((id) => !plaidIds.has(id)) : [],
  };
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
      // OUR IDS FOR THIS ITEM, so the comparison can name the row rather than
      // the count. Scoped by household as well as by our own item id: the id is
      // ours and cannot collide, so this is defence in depth.
      const ours = await sql<{ plaid_transaction_id: string }[]>`
        select t.plaid_transaction_id
          from transactions t
          join financial_accounts fa
            on fa.id = t.account_id and fa.household_id = t.household_id
         where fa.plaid_item_id = ${item.id}
           and t.household_id = ${householdId}
      `;
      const token = await decryptToken(item.ciphertext, encryptionKey);
      results.push({
        itemId: item.item_id,
        ...(await plaidTotals(token, new Set(ours.map((r) => r.plaid_transaction_id)), credentials)),
      });
    }
    return results;
  } finally {
    await sql.end();
  }
}
