// What database is the planted-failure harness actually talking to, and does it
// hold what the migrations say it holds?
//
// WHY THIS EXISTS. On 20 Aug 2026 control-register failed with "permission
// denied for table households" on a column migration 0028 grants, while the
// migrate job ran the SAME test against a branch with the SAME parent and
// passed. Its scratch branch reported "up: nothing pending" although two of the
// migrations on disk were unmerged and could not be in staging's ledger.
//
// TWO READINGS FIT THAT EVIDENCE EQUALLY. Either the parent's ledger is ahead
// of its schema, recording migrations whose SQL never ran there, which is the
// 15 Aug failure the branch script was written to prevent. Or the harness was
// not talking to the branch anybody thought it was.
//
// "permission denied" cannot tell those apart, and neither can more reasoning:
// the last time a message could not distinguish its causes here, guessing cost
// two wrong fixes and forty minutes, and a single probe turned it into a
// finding in one run. This is that probe. It prints WHICH database, WHAT its
// ledger says, and WHETHER the grant is actually present, so the next failure
// names its own cause.
//
// IT NEVER FAILS THE JOB. A diagnostic that can break the build is one people
// remove; this one reports and exits 0, and the harness that follows is what
// decides the outcome.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("harness-db-identity: no DATABASE_URL, nothing to report");
  process.exit(0);
}

const sql = postgres(url, { max: 1 });
try {
  // The host identifies the branch without printing the credential.
  const host = new URL(url.replace(/^postgres(ql)?:/, "https:")).host;
  console.log(`database host: ${host}`);

  const [who] = await sql`select current_database() as db, current_user as role, version() as version`;
  console.log(`database: ${who.db}  connected as: ${who.role}`);

  const applied = await sql`select name from schema_migrations order by name desc limit 6`;
  console.log(`ledger tail (newest first): ${applied.map((r) => r.name).join(", ")}`);
  const [count] = await sql`select count(*)::int as n from schema_migrations`;
  console.log(`ledger holds ${count.n} migrations`);

  // The specific claim that failed, asked of the catalog rather than inferred
  // from the ledger. A ledger says a file ran; only this says the grant is here.
  const checks = [
    ["households", "first_sync_completed_at", "SELECT"],
    ["households", "first_sync_completed_at", "UPDATE"],
    ["households", "id", "SELECT"],
    ["household_state_signals", "enqueued_at", "UPDATE"],
  ];
  for (const [table, column, priv] of checks) {
    try {
      const [row] = await sql`
        select has_column_privilege('marginsheet_sync', ${table}, ${column}, ${priv}) as allowed
      `;
      console.log(`marginsheet_sync ${priv} on ${table}.${column}: ${row.allowed}`);
    } catch (error) {
      console.log(`marginsheet_sync ${priv} on ${table}.${column}: could not ask (${(error).message})`);
    }
  }

  // THE RECONCILIATION, which is the whole point: a ledger that names a
  // migration whose grant is absent is a schema behind its own ledger, and that
  // is a different problem from talking to the wrong database.
  const [g] = await sql`
    select has_column_privilege('marginsheet_sync','households','first_sync_completed_at','SELECT') as granted
  `;
  const has0028 = applied.some((r) => r.name.startsWith("0028"));
  if (has0028 && !g.granted) {
    console.log("MISMATCH: the ledger records 0028 and the grant it makes is absent. The schema is behind its own ledger.");
  } else if (!has0028) {
    console.log("NOTE: 0028 is not in this ledger tail, so this database is older than the grant.");
  } else {
    console.log("consistent: the ledger records 0028 and the grant is present.");
  }
} catch (error) {
  console.log(`harness-db-identity: could not probe (${error.message})`);
} finally {
  await sql.end();
}
