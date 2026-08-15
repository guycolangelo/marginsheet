// Migration runner. Up applies every pending migration; down reverses the
// most recent one.
//
// Down matters more than it looks: a migration that cannot roll back is a
// migration you cannot deploy on a Friday. Every migration ships with a
// hand-written .down.sql beside the generated .sql, and CI proves both
// directions against a real Neon branch on every PR.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "migrations");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function ensureLedger(): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
}

async function migrationFiles(): Promise<string[]> {
  const all = await readdir(MIGRATIONS_DIR);
  return all
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();
}

async function up(): Promise<void> {
  await ensureLedger();
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name)
  );

  let count = 0;
  for (const file of await migrationFiles()) {
    if (applied.has(file)) continue;
    const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`applying ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    count += 1;
  }
  console.log(count === 0 ? "up: nothing pending" : `up: applied ${count}`);
}

async function down(): Promise<void> {
  await ensureLedger();
  const [latest] = await sql<{ name: string }[]>`
    select name from schema_migrations order by name desc limit 1
  `;
  if (!latest) {
    console.log("down: nothing applied");
    return;
  }

  const downFile = latest.name.replace(/\.sql$/, ".down.sql");
  const body = await readFile(join(MIGRATIONS_DIR, downFile), "utf8");
  console.log(`reverting ${latest.name}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`delete from schema_migrations where name = ${latest.name}`;
  });
  console.log(`down: reverted ${latest.name}`);
}

const command = process.argv[2];
try {
  if (command === "up") await up();
  else if (command === "down") await down();
  else {
    console.error("usage: migrate.ts up|down");
    process.exit(1);
  }
} finally {
  await sql.end();
}
