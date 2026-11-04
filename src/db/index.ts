import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

/**
 * Right-sized pool for Railway (Hobby Postgres allows ~20 connections total):
 * - max 5: one Next.js instance never starves the database, even with the bot webhook,
 *   broadcast worker and backup jobs sharing the process.
 * - short idle timeout releases unused connections (cost control on metered Postgres).
 * - statement timeout keeps a pathological query from pinning a connection.
 */
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: "gopcoin",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
