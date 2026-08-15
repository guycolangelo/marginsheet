// GET /debug/db-identity
//
// Returns the database role this Worker authenticates as, and whether that
// role holds BYPASSRLS. Two values: a role name and a boolean.
//
// WHY THIS EXISTS IN PRODUCTION, DELIBERATELY (ruled 15 Aug 2026).
//
// Wrangler secrets are write-only, so CI cannot read NEON_DATABASE_URL to
// confirm which role a Worker connects as. The only way to check the DEPLOYED
// REALITY rather than a config file is to ask the Worker itself. Checking dev
// and staging and trusting production by inference is exactly the reasoning
// that produced the finding this endpoint exists to prevent: every Worker was
// connecting as neondb_owner, which holds BYPASSRLS and reads past every
// household_isolation policy, and nothing caught it because nothing asked.
//
// WHAT IT MUST NEVER RETURN: a connection string, a host, a password, a
// database name, or anything else credential-shaped. A role name is not a
// secret; it is the thing being audited. Adding a field here that identifies
// the connection rather than the role turns an audit endpoint into a
// disclosure.
//
// This is NOT a debug leftover. It is the enforcement half of the
// rls-not-forced entry in the invariant manifest, and the isolation suite
// asserts against it. Removing it removes the check.

import postgres from "postgres";

export interface DbIdentity {
  current_user: string;
  bypassrls: boolean;
}

export async function readDbIdentity(databaseUrl: string): Promise<DbIdentity> {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const [row] = await sql<{ current_user: string; bypassrls: boolean }[]>`
      select current_user,
             coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypassrls
    `;
    // Only these two fields are ever returned. See the note above.
    return { current_user: row.current_user, bypassrls: row.bypassrls };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
