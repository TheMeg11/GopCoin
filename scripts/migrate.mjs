// Production migration runner (used by Railway's pre-deploy / start command).
// Applies SQL migrations in ./drizzle exactly once each, tracked in drizzle.__drizzle_migrations.
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("[migrate] database is up to date");
} catch (e) {
  console.error("[migrate] failed", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
