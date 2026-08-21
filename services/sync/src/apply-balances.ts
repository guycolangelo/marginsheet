// Balances, from the accounts Plaid returns with EVERY /transactions/sync page.
//
// WHY THIS EXISTS. Until 21 Aug 2026 nothing refreshed a balance after
// connection: exchange.ts wrote them once at token exchange and that was the
// only writer in the system. The balances arriving with every sync page were
// discarded, and not by a decision: SyncPage did not declare an accounts field,
// callPlaid returns the whole parsed body cast to that type, and A CAST IS NOT
// A FILTER, so the data sat in memory on every page and nothing read it.
//
// THE COST WAS Cash Flow PROJECTING A 13 WEEK PATH FROM A NUMBER THAT NEVER
// MOVES, and a household's balance reading as current while being months old.
// It was invisible because a balance renders identically whether it is live or
// frozen: no error, no empty result, no missing field.
//
// FREE RATHER THAN BILLED (Guy, 20 Aug 2026). These balances are included in
// the Transactions subscription already paid per Item per month.
// /accounts/balance/get is billed per call and forces a live institution
// refresh, which is a different question with a different freshness
// requirement: a 13 week projection wants a balance that MOVES WITH THE SYNC,
// because the projection is a path computed from a ledger and a balance fetched
// at a different instant than the transactions would disagree with them. The
// billed call is reserved for a household asking whether something will clear
// right now.
//
// PER DAY, NOT PER SYNC (Guy, 20 Aug 2026). account_balance_snapshots is keyed
// by date and the projection reads a SERIES. A row per sync would make that
// series depend on how often we happened to sync, which is a property of us
// rather than of the household's money. The upsert is on (account_id, date) and
// the last write wins, so several syncs within a day converge on the closing figure
// rather than accumulating noise.
//
// ENFORCED BY packages/schema/test/db/balance-capture.test.ts, registered as
// balance-capture-is-per-day and balance-capture-names-the-household. It runs
// these statements against a real schema as marginsheet_sync, writes twice within a single
// day and requires ONE snapshot carrying the later figure, and holds two
// households whose accounts share a plaid_account_id so the isolation assertion
// has a failure case to distinguish. A comment is the weakest form of a rule.

/** The slice of a Plaid account object this needs. */
export interface PlaidAccountBalances {
  account_id: string;
  balances?: {
    current?: number | null;
    available?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
  } | null;
}

export type Tx = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export interface BalanceResult {
  /** Accounts whose row was updated. Rows ACTUALLY touched, not the number
   *  handed in: they differ exactly when an account belongs to somebody else,
   *  which is the case this needs to get right. */
  accounts: number;
  snapshots: number;
}

/** Writes current balances and today's snapshot for each account.
 *
 *  NAMES THE HOUSEHOLD IN EVERY STATEMENT. plaid_account_id is Plaid's
 *  namespace, shared across every household, so a write keyed on it must carry
 *  the household or two households linking the same bank reach each other's
 *  rows. Our own uuid primary keys need no such predicate; these do. */
export async function applyBalances(
  tx: Tx,
  householdId: string,
  accounts: PlaidAccountBalances[]
): Promise<BalanceResult> {
  if (accounts.length === 0) return { accounts: 0, snapshots: 0 };

  let updated = 0;
  let snapshots = 0;

  for (const account of accounts) {
    const current = account.balances?.current ?? null;
    const available = account.balances?.available ?? null;
    const limit = account.balances?.limit ?? null;

    const rows = (await tx`
      update financial_accounts
         set current_balance = ${current},
             available_balance = ${available},
             credit_limit = ${limit},
             updated_at = now()
       where household_id = ${householdId}
         and plaid_account_id = ${account.account_id}
      returning id
    `) as { id: string }[];
    updated += rows.length;

    // THE SNAPSHOT IS KEYED ON OUR ACCOUNT ID, so it can only be written for a
    // row the update above already found within this household. No account, no
    // snapshot, and no way to write one against somebody else's account.
    if (rows.length === 0) continue;

    const written = (await tx`
      insert into account_balance_snapshots (household_id, account_id, date, current_balance, available_balance)
      values (${householdId}, ${rows[0].id}, current_date, ${current}, ${available})
      on conflict (account_id, date) do update
        set current_balance = excluded.current_balance,
            available_balance = excluded.available_balance,
            updated_at = now()
      returning id
    `) as { id: string }[];
    snapshots += written.length;
  }

  return { accounts: updated, snapshots };
}
