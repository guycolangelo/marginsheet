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
  // BOTH FORMS, SIDE BY SIDE, BECAUSE THEY DISAGREED.
  //
  // has_column_privilege(role, table, column, priv) names a role and can be
  // asked from an owner connection. has_column_privilege(table, column, priv)
  // answers for current_user, which is what a query actually exercises after
  // SET ROLE. On 20 Aug 2026 the first version of this probe asked only the
  // 4-argument form, reported the grant as present, and the test on the same
  // database in the same job could not read the column. THE PROBE HAD THE
  // DEFECT IT WAS BUILT TO FIND: it asked a question in a form that does not
  // match how the grant is used, so it could not disagree with reality.
  const checks = [
    ["households", "first_sync_completed_at", "SELECT"],
    ["households", "first_sync_completed_at", "UPDATE"],
    ["households", "id", "SELECT"],
    ["household_state_signals", "enqueued_at", "UPDATE"],
  ];
  for (const [table, column, priv] of checks) {
    let named = "?";
    let effective = "?";
    try {
      const [row] = await sql`
        select has_column_privilege('marginsheet_sync', ${table}, ${column}, ${priv}) as allowed
      `;
      named = String(row.allowed);
    } catch (error) {
      named = `could not ask (${error.message})`;
    }
    try {
      await sql`set role marginsheet_sync`;
      const [row] = await sql`
        select has_column_privilege(${table}, ${column}, ${priv}) as allowed
      `;
      effective = String(row.allowed);
    } catch (error) {
      effective = `could not ask (${error.message})`;
    } finally {
      await sql`reset role`;
    }
    const flag = named !== effective ? "   <-- THE TWO FORMS DISAGREE" : "";
    console.log(`${priv} on ${table}.${column}: named=${named} effective=${effective}${flag}`);
  }

  // THE RECONCILIATION. A ledger that names a migration whose grant is absent
  // is a schema behind its own ledger, which is a different problem from
  // talking to the wrong database. Asked in the EFFECTIVE form, because that is
  // the one a query obeys.
  let granted = false;
  try {
    await sql`set role marginsheet_sync`;
    const [g] = await sql`
      select has_column_privilege('households','first_sync_completed_at','SELECT') as granted
    `;
    granted = g.granted;
  } finally {
    await sql`reset role`;
  }
  const has0028 = applied.some((r) => r.name.startsWith("0028"));
  if (has0028 && !granted) {
    console.log("MISMATCH: the ledger records 0028 and marginsheet_sync cannot use the grant it makes.");
  } else if (!has0028) {
    console.log("NOTE: 0028 is not in this ledger tail, so this database is older than the grant.");
  } else {
    console.log("consistent: the ledger records 0028 and the role can use the grant.");
  }
} catch (error) {
  console.log(`harness-db-identity: could not probe (${error.message})`);
} finally {
  await sql.end();
}
