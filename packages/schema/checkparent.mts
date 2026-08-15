import postgres from "postgres";
const sql = postgres(process.env.CHECK_URL!, { max: 1 });
const r = await sql`select rolname from pg_roles where rolname = 'role_leak_probe'`;
console.log("role present on this branch:", r.length === 1);
await sql.end();
