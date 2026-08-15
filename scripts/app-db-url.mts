// Sets marginsheet_app's password on a Neon branch and prints that role's
// connection string to stdout, so it can be piped straight into
// `wrangler secret put` without ever being displayed.
//
// Usage:  pnpm exec tsx scripts/app-db-url.mts <branch>
//
// The password is read from /tmp/apppw, generated separately. It is never
// echoed, never logged, and never written to the repo. Re-running is safe:
// it sets the same password again.
//
// WHY THIS EXISTS: every Worker's NEON_DATABASE_URL was issued for
// neondb_owner in Task 0.3, and that role holds BYPASSRLS, so the
// application would have read past every household_isolation policy. The
// application must authenticate as marginsheet_app, which holds no BYPASSRLS
// and is therefore subject to every policy.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const PROJECT = "fancy-paper-35797264";
const branch = process.argv[2];
if (!branch) {
  console.error("usage: app-db-url.mts <branch>   (dev | staging | main)");
  process.exit(1);
}

const password = readFileSync("/tmp/apppw", "utf8").trim();
if (!password) {
  console.error("/tmp/apppw is empty. Generate the password first.");
  process.exit(1);
}

// The owner URL, used once to set the password and then discarded.
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
  await owner.unsafe(
    `ALTER ROLE marginsheet_app LOGIN PASSWORD '${password.replace(/'/g, "''")}'`
  );

  const [check] = await owner<{ rolbypassrls: boolean; rolcanlogin: boolean }[]>`
    select rolbypassrls, rolcanlogin from pg_roles where rolname = 'marginsheet_app'
  `;
  if (check.rolbypassrls) {
    console.error("REFUSING: marginsheet_app holds BYPASSRLS, which defeats every policy.");
    process.exit(1);
  }
  if (!check.rolcanlogin) {
    console.error("REFUSING: marginsheet_app cannot log in. Is migration 0009 applied?");
    process.exit(1);
  }
} finally {
  await owner.end();
}

const host = new URL(ownerUrl).hostname;
process.stdout.write(
  `postgresql://marginsheet_app:${encodeURIComponent(password)}@${host}/marginsheet?sslmode=require\n`
);
