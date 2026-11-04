/**
 * E2E harness: boots a REAL embedded PostgreSQL and drives the risky database paths:
 *   Part 1 (here): migrate.mjs — fresh migrate, old-schema drift → snapshot+rebuild, idempotency.
 *   Part 2: spawns vitest with DATABASE_URL → tests/integration.test.ts (backup/restore round-trip).
 * Run: node tests/e2e-db.mjs
 */
import { Client } from "pg";
import { execFileSync, execFileSync as run } from "child_process";
import { readdirSync, rmSync, existsSync } from "fs";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 5433;
const DB = "app_db";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
};

const pg = new EmbeddedPostgres({
  databaseDir: "/tmp/gop-e2e-pgdata",
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
});
await pg.initialise();
await pg.start();
await pg.createDatabase(DB);

const url = `postgresql://postgres:postgres@127.0.0.1:${PORT}/${DB}`;
const c = new Client({ connectionString: url });
await c.connect();

const snapshotFiles = () => readdirSync(".").filter((f) => f.startsWith("gopcoin-legacy-snapshot-"));
const cleanSnapshots = () => snapshotFiles().forEach((f) => rmSync(f, { force: true }));

try {
  cleanSnapshots();

  // ---------- Part 1a: fresh migrate ----------
  execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const t1 = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
  const names1 = t1.rows.map((r) => r.table_name);
  ok("fresh migrate created all tables", ["users", "game_config", "crypto_orders", "coin_transactions"].every((t) => names1.includes(t)), names1.join(","));
  const trig = await c.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='coin_transactions'::regclass AND NOT tgisinternal`);
  ok("append-only triggers installed", trig.rows.some((r) => r.tgname.includes("append_only")), trig.rows.map((r) => r.tgname).join(","));

  // ---------- Part 1b: old-generation schema planted → drift + rebuild ----------
  await c.query(`DROP SCHEMA public CASCADE`);
  await c.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await c.query(`CREATE SCHEMA public`);
  await c.query(`CREATE TABLE users (id serial PRIMARY KEY, telegram_id bigint NOT NULL, referral_code varchar(16) NOT NULL,
    balance bigint NOT NULL DEFAULT 0, mine_speed_milli integer NOT NULL DEFAULT 500, daily_limit integer NOT NULL DEFAULT 500,
    settle_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`);
  await c.query(`CREATE TABLE daily_mining (user_id integer NOT NULL, day date NOT NULL, mined_milli bigint NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`);
  await c.query(`CREATE TABLE payments (id serial PRIMARY KEY, user_id integer NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending')`);
  await c.query(`CREATE TABLE game_config (key varchar(32) PRIMARY KEY, value jsonb NOT NULL)`);
  await c.query(`CREATE TABLE legacy_thing (id bigserial PRIMARY KEY, note text)`);
  await c.query(`INSERT INTO users (telegram_id, referral_code, balance, settle_count) VALUES (222, 'LEGACYAAA', 777, 3)`);
  await c.query(`INSERT INTO legacy_thing (note) VALUES ('precious legacy row')`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await c.query(`CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)`);
  await c.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', 99999999999999)`);

  const out = execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" }).toString();
  console.log("   migrate:", out.split("\n").filter(Boolean).join(" | ").slice(0, 300));
  const t2 = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='collected_count'`);
  ok("drift detected & rebuilt to current schema", t2.rows.length === 1);
  const t3 = await c.query(`SELECT to_regclass('public.crypto_orders') IS NOT NULL AS ok`);
  ok("crypto_orders table exists after rebuild", t3.rows[0].ok === true);
  const drizzleMax = await c.query(`SELECT MAX(created_at)::bigint AS m FROM drizzle.__drizzle_migrations`);
  ok("migration journal reset", Number(drizzleMax.rows[0].m) < 99999999999999, `max=${drizzleMax.rows[0].m}`);
  ok("legacy snapshot file created", snapshotFiles().length === 1, snapshotFiles().join(","));

  // ---------- Part 1c: idempotency ----------
  const out2 = execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" }).toString();
  ok("second migrate is a no-op", /up to date/.test(out2), (out2.split("\n").filter(Boolean).pop() ?? "").slice(0, 80));

  // ---------- Part 2: backup/restore round-trip via vitest ----------
  run("npx", ["vitest", "run", "tests/integration.test.ts"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  results.push(...readVitestResults());
  function readVitestResults() {
    // vitest prints its own summary; failures already exit non-zero, so reaching here means pass
    return [{ name: "backup/restore integration suite", pass: true, extra: "vitest" }];
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  ok("e2e harness", false, msg.slice(0, 300));
} finally {
  await c.end().catch(() => {});
  await pg.stop().catch(() => {});
  rmSync("/tmp/gop-e2e-pgdata", { recursive: true, force: true });
  cleanSnapshots();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n== e2e summary: ${results.length - failed.length}/${results.length} passed ==`);
process.exit(failed.length ? 1 : 0);
