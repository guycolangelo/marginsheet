import postgres from "postgres";
const sql = postgres(process.env.PROBE_URL!, { max: 1 });
await sql`create role role_leak_probe nologin`;
const r = await sql`select rolname from pg_roles where rolname = 'role_leak_probe'`;
console.log("created on probe branch:", r.length === 1);
await sql.end();
