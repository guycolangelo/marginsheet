// Token exchange (M4 task 4.3.2).
//
// RUNS HERE AND NOWHERE ELSE. The access token is encrypted with a key only
// this Worker holds, so the exchange happens where the key lives. `api` proxies
// the public token over a service binding and receives a result carrying no
// token at all (M4 section 4a).
//
// ZOMBIE PREVENTION IS BY CONSTRUCTION, NOT BY CHECKING. Every write below is
// an upsert onto a unique index that already exists in migration 0002:
// plaid_items.item_id, financial_accounts.plaid_account_id, institutions
// .plaid_institution_id, and (account_id, date) on snapshots. A re-fired
// exchange therefore cannot create a second Item even if the guard logic is
// wrong, because the database refuses. A check that could be forgotten is a
// check somebody forgets; a constraint is not optional.

import postgres from "postgres";
import { callPlaid, type PlaidCredentials } from "./plaid-client.js";
import { encryptToken } from "./token-crypto.js";

export interface ExchangeResult {
  itemId: string;
  institution: { plaidInstitutionId: string; name: string } | null;
  accounts: { plaidAccountId: string; name: string | null; mask: string | null; type: string | null }[];
  /** True when this exchange found an Item that already existed. */
  alreadyConnected: boolean;
}

interface PlaidAccount {
  account_id: string;
  name?: string;
  official_name?: string;
  mask?: string;
  type?: string;
  subtype?: string;
  balances?: { current?: number; available?: number; limit?: number; iso_currency_code?: string };
}

export async function exchangePublicToken(
  publicToken: string,
  householdId: string,
  credentials: PlaidCredentials,
  encryptionKey: string,
  databaseUrl: string
): Promise<ExchangeResult> {
  const exchanged = await callPlaid<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    credentials,
    { public_token: publicToken }
  );
  const accessToken = exchanged.access_token;

  const item = await callPlaid<{ item: { institution_id?: string } }>("/item/get", credentials, {
    access_token: accessToken,
  });
  const plaidInstitutionId = item.item.institution_id ?? null;

  let institutionName: string | null = null;
  if (plaidInstitutionId) {
    const inst = await callPlaid<{ institution: { name: string } }>(
      "/institutions/get_by_id",
      credentials,
      { institution_id: plaidInstitutionId, country_codes: ["US"] }
    );
    institutionName = inst.institution.name;
  }

  const fetched = await callPlaid<{ accounts: PlaidAccount[] }>("/accounts/get", credentials, {
    access_token: accessToken,
  });

  // Encrypted BEFORE the connection is opened, so a database failure cannot
  // leave a window where the plaintext is held longer than it needs to be.
  const ciphertext = await encryptToken(accessToken, encryptionKey);

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await sql.begin(async (tx) => {
      // household_isolation filters on this GUC. Set inside the transaction so
      // it cannot leak to another request on a pooled connection.
      await tx`select set_config('marginsheet.household_id', ${householdId}, true)`;

      let institutionRowId: string | null = null;
      if (plaidInstitutionId) {
        const [row] = await tx<{ id: string }[]>`
          insert into institutions (plaid_institution_id, name)
          values (${plaidInstitutionId}, ${institutionName ?? plaidInstitutionId})
          on conflict (plaid_institution_id) do update
            set name = excluded.name, updated_at = now()
          returning id
        `;
        institutionRowId = row.id;
      }

      // THE ZOMBIE PREVENTION. A re-fired exchange collides on item_id and
      // updates rather than inserting. xmax = 0 distinguishes an insert from
      // an update on the returning row, which is how alreadyConnected is
      // known without a second query.
      const [itemRow] = await tx<{ id: string; inserted: boolean }[]>`
        insert into plaid_items (household_id, institution_id, item_id, access_token_ciphertext)
        values (${householdId}, ${institutionRowId}, ${exchanged.item_id}, ${ciphertext})
        on conflict (item_id) do update
          set access_token_ciphertext = excluded.access_token_ciphertext,
              institution_id = excluded.institution_id,
              status = 'healthy',
              updated_at = now()
        returning id, (xmax = 0) as inserted
      `;

      const today = new Date().toISOString().slice(0, 10);
      for (const account of fetched.accounts) {
        const [accountRow] = await tx<{ id: string }[]>`
          insert into financial_accounts (
            household_id, plaid_item_id, plaid_account_id, name, official_name,
            mask, type, subtype, current_balance, available_balance, credit_limit, iso_currency
          ) values (
            ${householdId}, ${itemRow.id}, ${account.account_id}, ${account.name ?? null},
            ${account.official_name ?? null}, ${account.mask ?? null}, ${account.type ?? null},
            ${account.subtype ?? null}, ${account.balances?.current ?? null},
            ${account.balances?.available ?? null}, ${account.balances?.limit ?? null},
            ${account.balances?.iso_currency_code ?? null}
          )
          on conflict (plaid_account_id) do update
            set name = excluded.name, official_name = excluded.official_name,
                mask = excluded.mask, type = excluded.type, subtype = excluded.subtype,
                current_balance = excluded.current_balance,
                available_balance = excluded.available_balance,
                credit_limit = excluded.credit_limit,
                is_active = true, updated_at = now()
          returning id
        `;

        await tx`
          insert into account_balance_snapshots (household_id, account_id, date, current_balance, available_balance)
          values (${householdId}, ${accountRow.id}, ${today},
                  ${account.balances?.current ?? null}, ${account.balances?.available ?? null})
          on conflict (account_id, date) do update
            set current_balance = excluded.current_balance,
                available_balance = excluded.available_balance,
                updated_at = now()
        `;
      }

      // NO TOKEN IN THE RESULT, and nothing here can be widened into one by
      // accident: the fields are named individually rather than spread.
      return {
        itemId: exchanged.item_id,
        institution: plaidInstitutionId
          ? { plaidInstitutionId, name: institutionName ?? plaidInstitutionId }
          : null,
        accounts: fetched.accounts.map((a) => ({
          plaidAccountId: a.account_id,
          name: a.name ?? null,
          mask: a.mask ?? null,
          type: a.type ?? null,
        })),
        alreadyConnected: !itemRow.inserted,
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
