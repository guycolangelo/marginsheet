// Sets marginsheet_sync's password on a Neon branch and prints that role's
// connection string to stdout, so it can be piped straight into
// `wrangler secret put` without ever being displayed.
//
// Usage:  pnpm exec tsx scripts/sync-db-url.mts <branch>
//
// WHY THIS EXISTS. Spike 1a (17 Aug 2026) went looking for the sync role's
// provisioning path and there was none. The role had held LOGIN since
// migration 0009 and no way to obtain a credential: app-db-url.mts and
// put-app-db-url.sh handle marginsheet_app only, and no sync connection string
// was inventoried anywhere. A role with privileges and no connections is a
// control nobody has exercised, and it is load-bearing for every Plaid token
// in the product.
//
// THE GRANT CHECK IS THE POINT, NOT A COURTESY. Issuing the credential is the
// moment an over-broad grant stops being theoretical: before it exists nothing
// can connect as this role, and after it exists a compromised sync worker
// reads whatever the role can reach. So this refuses to mint a credential for
// a role wider than its description, rather than trusting that 0023 ran.
//
// The refusal lives HERE, at the operation, rather than in each caller. A
// control that has to be remembered in several places is a control that will
// be correct in most of them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const PROJECT = "fancy-paper-35797264";

// The nine tables 0023 enumerates. Kept here as a literal rather than read
// from the migration, deliberately: this is a second, independent statement of
// what the role may reach, and a check that reads its expectation from the
// thing it is checking cannot disagree with it.
const EXPECTED_TABLES = [
  "account_balance_snapshots",
  // The tenth, added 18 Aug 2026 for the household-state-changed outbox.
  //
  // A LEGITIMATE TENTH RATHER THAN AN EXCEPTION, and the reasoning matters more
  // than the entry: the sync worker must WRITE the signal, in the same
  // transaction as the data change it describes. A signal written by anything
  // else is a signal the sync worker's transaction cannot include, so the row
  // and the change it announces could commit separately, which is the
  // atomicity the outbox exists to provide.
  //
  // THAT REASONING IS WHAT STOPS AN ELEVENTH TABLE BEING ARGUED IN BY ANALOGY.
  // The test is not "the pipeline touches it" but "the sync worker's own
  // transaction must contain the write, or the guarantee is lost".
  "household_state_signals",
  "commitments",
  "financial_accounts",
  "institutions",
  "liability_details",
  "plaid_items",
  "provider_events",
  "schema_migrations",
  "transactions",
];

const branch = process.argv[2];
if (!branch) {
  console.error("usage: sync-db-url.mts <branch>   (dev | staging | main)");
  process.exit(1);
}

const password = readFileSync("/tmp/syncpw", "utf8").trim();
if (!password) {
  console.error("/tmp/syncpw is empty. Generate the password first.");
  process.exit(1);
}

const ownerUrl = execFileSync(
  "pnpm",
  [
    "exec",
    "neonctl",
    "connection-string",
    branch,
    "--project-id",
    PROJECT,
    "--database-name",
    "marginsheet",
    "--role-name",
    "neondb_owner",
  ],
  { encoding: "utf8" }
).trim();

const owner = postgres(ownerUrl, { max: 1 });
try {
  // Check the grant BEFORE setting a password. A refusal after the credential
  // exists is a refusal that came too late.
  const granted = await owner<{ table_name: string }[]>`
    select distinct table_name
    from information_schema.role_table_grants
    where grantee = 'marginsheet_sync' and table_schema = 'public'
    order by table_name
  `;
  const actual = granted.map((r) => r.table_name);
  const unexpected = actual.filter((t) => !EXPECTED_TABLES.includes(t));
  const missing = EXPECTED_TABLES.filter((t) => !actual.includes(t));

  if (unexpected.length > 0) {
    console.error(
      `REFUSING: marginsheet_sync holds grants on ${unexpected.length} table(s) it should not:\n` +
        `  ${unexpected.join(", ")}\n` +
        `The custody doc describes this role as the Plaid sync worker. Issuing a\n` +
        `credential now would make that description false. Apply migration 0023,\n` +
        `or if the pipeline genuinely needs a new table, add it to 0023 by name,\n` +
        `to EXPECTED_TABLES here, and to the negative control.`
    );
    process.exit(1);
  }
  if (missing.length > 0) {
    console.error(
      `REFUSING: marginsheet_sync is missing grants it needs: ${missing.join(", ")}.\n` +
        `Is migration 0023 applied to branch ${branch}?`
    );
    process.exit(1);
  }

  // The one column this role exists for. A sync worker that cannot read the
  // ciphertext is not a narrower sync worker, it is a broken one.
  const [token] = await owner<{ allowed: boolean }[]>`
    select has_column_privilege(
      'marginsheet_sync', 'plaid_items', 'access_token_ciphertext', 'SELECT'
    ) as allowed
  `;
  if (!token.allowed) {
    console.error(
      "REFUSING: marginsheet_sync cannot read plaid_items.access_token_ciphertext,\n" +
        "which is the only reason this role exists. Something revoked the column grant."
    );
    process.exit(1);
  }

  await owner.unsafe(
    `ALTER ROLE marginsheet_sync LOGIN PASSWORD '${password.replace(/'/g, "''")}'`
  );

  const [check] = await owner<{ rolbypassrls: boolean; rolcanlogin: boolean }[]>`
    select rolbypassrls, rolcanlogin from pg_roles where rolname = 'marginsheet_sync'
  `;
  if (check.rolbypassrls) {
    console.error("REFUSING: marginsheet_sync holds BYPASSRLS, which defeats every policy.");
    process.exit(1);
  }
  if (!check.rolcanlogin) {
    console.error("REFUSING: marginsheet_sync cannot log in even after ALTER ROLE.");
    process.exit(1);
  }
} finally {
  await owner.end();
}

const host = new URL(ownerUrl).hostname;
process.stdout.write(
  `postgresql://marginsheet_sync:${encodeURIComponent(password)}@${host}/marginsheet?sslmode=require\n`
);
