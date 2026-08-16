// The two questions a deployed Worker must be able to answer about its
// database: what am I connected AS, and is the schema I was built against
// actually there.
//
// Both services asked the first question from byte-identical private copies of
// this file. Neither asked the second at all, which is why ten PRs merged
// green against databases holding zero tables. One module now, so a third
// service cannot inherit a stale copy.

import postgres from "postgres";

// Health and identity both open a connection per request. Keep it small and
// short-lived: these endpoints are polled by uptime monitors and by CI.
const CONNECTION = { max: 1, idle_timeout: 5, connect_timeout: 10 } as const;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

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
// rls-not-forced entry in the invariant manifest, and a CI job asserts
// against it on every pull request and every push to main. Removing it
// removes the check.

export interface DbIdentity {
  current_user: string;
  bypassrls: boolean;
}

export async function readDbIdentity(databaseUrl: string): Promise<DbIdentity> {
  const sql = postgres(databaseUrl, CONNECTION);
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

// ---------------------------------------------------------------------------
// Schema health
// ---------------------------------------------------------------------------

// The database half of GET /health.
//
// WHY THIS EXISTS (ruled 15 Aug 2026). /health reported
// {service, environment, build} and nothing else, so it proved the Worker had
// booted and the edge served the right commit. It did not prove the Worker
// could reach a database, and it did not prove the database held a schema.
// For ten merged PRs it returned green against three branches holding zero
// tables, and for several hours it returned green while all six Workers held
// an empty connection string. A health check that passes while the
// application cannot query anything is not a weak control, it is a misleading
// one: it converts an outage into a silence.
//
// So this runs a REAL QUERY AGAINST A REAL TABLE. Not `select 1`, which any
// empty database answers happily. It reads households, the spine table every
// other table hangs off, and it reports how many migrations the connected
// database has applied so the deploy verification can compare that count
// against the migration files in the commit being deployed.
//
// WHAT IT MUST NEVER RETURN: the households count itself, or any other row
// count from a household table. How many households exist is a business fact,
// and /health is unauthenticated. The query's VALUE is discarded; only the
// fact that it succeeded is reported.

export interface SchemaHealth {
  ok: boolean;
  /** Rows in schema_migrations. Compared against the deployed commit's migration files. */
  migrations: number | null;
  /** Base tables in the public schema. */
  tables: number | null;
  /** Present only when ok is false. Scrubbed of anything connection-shaped. */
  error?: string;
}

// A Postgres error can carry a host or a database name in its text. This
// endpoint is unauthenticated, so the message is truncated and anything
// credential-shaped is dropped rather than trusted to be absent.
function safeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const scrubbed = raw
    .replace(/postgresql:\/\/\S*/gi, "[connection]")
    .replace(/\bep-[a-z0-9-]+/gi, "[host]")
    .replace(/password[^\s,]*/gi, "[redacted]");
  return scrubbed.slice(0, 200);
}

export async function readSchemaHealth(databaseUrl: string): Promise<SchemaHealth> {
  const sql = postgres(databaseUrl, CONNECTION);
  try {
    const [row] = await sql<{ migrations: number; tables: number }[]>`
      select
        (select count(*)::int from schema_migrations) as migrations,
        (select count(*)::int
           from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
        -- The real query against a real table. Its result is deliberately not
        -- selected into the response: the point is that it can run at all.
        (select count(*)::int from households) as households
    `;
    return { ok: true, migrations: row.migrations, tables: row.tables };
  } catch (err) {
    return { ok: false, migrations: null, tables: null, error: safeError(err) };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
