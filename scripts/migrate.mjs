// Applies db/migrations/NNNN_*.sql files that haven't been applied yet, in
// order, each in its own transaction, recording them in schema_migrations.
//
//   npm run db:migrate
//
// Safe on a database set up by hand from these same files before this
// script existed: every migration is written to be re-runnable (if not
// exists / on conflict do nothing), so the first run just re-applies them
// harmlessly and starts tracking. Plain SQL over the regular connection,
// so it works with Supabase's transaction pooler, unlike drizzle-kit push.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = (await readdir(dir)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

const sql = postgres(url, { prepare: false, onnotice: () => {} });
try {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamp not null default now()
  )`;
  // Keep it out of Supabase's REST API like every other table (0005_security.sql).
  await sql`alter table schema_migrations enable row level security`;

  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`Database is up to date (${files.length} migrations).`);
  }
  for (const file of pending) {
    const body = await readFile(path.join(dir, file), "utf-8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
