// Production migration runner (used by Railway's pre-deploy / start command).
// Applies SQL migrations in ./drizzle exactly once each, tracked by drizzle.
//
// Schema-drift self-healing:
// The game is on its second schema generation. A plain `drizzle migrate` compares only the
// migration *timestamps* recorded in the database, so when the live database holds an older
// schema generation it would silently apply nothing (new code + old tables = broken app) or
// fail on CREATE TABLE. We detect that drift, snapshot EVERY existing row, try to send the
// snapshot to the admin via Telegram (the assumption is that this file may be the only copy
// left), then rebuild the schema from the current migrations. Fresh databases skip all of this.
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
const log = (...a) => console.log("[migrate]", ...a);

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "./drizzle");

function journalTimestamps() {
  try {
    const j = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
    return j.entries.map((e) => Number(e.when));
  } catch {
    return [];
  }
}

async function publicTables(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

/** True when the live schema is NOT the one this code expects (older generation). */
async function schemaDriftDetected(client) {
  const tables = await publicTables(client);
  if (tables.length === 0) return false; // fresh database
  if (!tables.includes("users")) return false; // unknown/empty state — let drizzle try first
  const hasNewColumns = (await columnExists(client, "users", "collected_count")) && tables.includes("crypto_orders");
  if (hasNewColumns) return false; // current generation — plain migrate is correct
  // App tables exist but they belong to an older schema generation.
  // Also rebuild when the DB journal is NEWER than the code journal (drizzle would skip everything).
  const codeMax = Math.max(0, ...journalTimestamps());
  let dbMax = 0;
  try {
    const { rows } = await client.query(`SELECT COALESCE(MAX(created_at),0)::bigint AS m FROM drizzle.__drizzle_migrations`);
    dbMax = Number(rows[0]?.m ?? 0);
  } catch {
    dbMax = 0;
  }
  return !hasNewColumns || dbMax > codeMax;
}

/** Dump every public table to a JSON snapshot (pure SQL — no pg_dump needed). */
async function snapshotAllTables(client) {
  const tables = await publicTables(client);
  const data = {};
  for (const t of tables) {
    const { rows } = await client.query(`SELECT * FROM "${t}" ORDER BY 1`);
    data[t] = rows;
  }
  return { marker: "GOPCOIN_LEGACY_SNAPSHOT", createdAt: new Date().toISOString(), counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), data };
}

async function sendSnapshotToAdmin(snapshot, fileName) {
  const token = process.env.BOT_TOKEN;
  const adminRaw = (process.env.TELEGRAM_ADMIN_ID ?? process.env.ADMIN_ID ?? "").trim();
  if (!token || !/^\d{1,20}$/.test(adminRaw)) {
    log("snapshot not sent: BOT_TOKEN/TELEGRAM_ADMIN_ID missing");
    return false;
  }
  try {
    const json = JSON.stringify(snapshot);
    const form = new FormData();
    form.append("chat_id", adminRaw);
    form.append("caption", `🛟 Safety snapshot of the PREVIOUS schema, taken automatically before the database was rebuilt.\n${snapshot.createdAt}\nTables: ${Object.entries(snapshot.counts).map(([k, v]) => `${k}:${v}`).join(", ")}\nKeep this file — it documents all data that existed before the upgrade.`);
    form.append("document", new Blob([json], { type: "application/json" }), fileName);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) });
    const j = await res.json();
    log("snapshot delivery:", j.ok ? "sent to admin ✅" : `failed (${j.description ?? res.status})`);
    return !!j.ok;
  } catch (e) {
    log("snapshot delivery failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function rebuildSchema(client) {
  const snapshot = await snapshotAllTables(client);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `gopcoin-legacy-snapshot-${stamp}.json`;
  try {
    writeFileSync(fileName, JSON.stringify(snapshot));
    log(`legacy snapshot written to ${fileName} (${Object.values(snapshot.counts).reduce((a, b) => a + b, 0)} rows)`);
  } catch (e) {
    log("snapshot file write failed (continuing):", e instanceof Error ? e.message : e);
  }
  await sendSnapshotToAdmin(snapshot, fileName);
  log("dropping legacy schema and rebuilding from current migrations…");
  await client.query(`DROP SCHEMA IF EXISTS public CASCADE`);
  await client.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await client.query(`CREATE SCHEMA public`);
}

async function runMigrate() {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}

try {
  const drift = await schemaDriftDetected(pool);
  if (drift) {
    log("schema drift detected (older schema generation) — starting safe transition");
    await rebuildSchema(pool);
    await runMigrate();
    log("database rebuilt and migrated to the current schema");
  } else {
    await runMigrate().catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists/i.test(msg)) {
        log("migration failed with 'already exists' — falling back to rebuild");
        await rebuildSchema(pool);
        await runMigrate();
        log("database rebuilt and migrated to the current schema");
      } else {
        throw e;
      }
    });
    log("database is up to date");
  }
} catch (e) {
  console.error("[migrate] failed", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
