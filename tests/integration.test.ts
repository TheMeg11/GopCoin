/**
 * Backup & restore round-trip against a real PostgreSQL (booted by tests/e2e-db.mjs).
 * Requires DATABASE_URL pointing at a migrated database.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { users } from "@/db/schema";
import { buildBackup, listPublicTables, restoreBackup, validateBackupJson } from "@/lib/backup";
import { creditCoins } from "@/lib/ledger";

async function truncateAll() {
  const tables = await listPublicTables();
  if (tables.length) await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
}

beforeAll(async () => {
  await truncateAll();
  await db.insert(users).values({ telegramId: 900001, referralCode: "E2ETEST1", balance: 0 });
  const [u] = await db.select().from(users).where(eq(users.telegramId, 900001));
  await db.transaction(async (tx) => {
    await creditCoins(tx, { userId: u.id, amount: 12_345, type: "mine", key: "e2e:seed:1", sourceRef: "e2e", reason: "seed" });
  });
});

describe("backup/restore round-trip", () => {
  it("backs up every public table", async () => {
    const tables = await listPublicTables();
    expect(tables).toContain("users");
    expect(tables).toContain("coin_transactions");
    expect(tables).toContain("crypto_orders");
    const { backup, bytes } = await buildBackup();
    expect(bytes).toBeGreaterThan(100);
    expect(backup.data["users"].length).toBe(1);
    expect(backup.marker).toBe("GOPCOIN_BACKUP");
  });

  it("restores identical data after a wipe", async () => {
    const { json } = await buildBackup();
    const backup = validateBackupJson(json);

    // wipe everything (simulating data loss / a fresh deployment)
    await truncateAll();
    const empty = await db.execute<{ c: number }>(sql`SELECT count(*)::int AS c FROM users`);
    expect(empty.rows[0].c).toBe(0);

    const { counts } = await restoreBackup(backup);
    expect(counts["users"]).toBe(1);

    const [u] = await db.select().from(users);
    expect(u.telegramId).toBe(900001);
    expect(u.referralCode).toBe("E2ETEST1");
    expect(u.balance).toBe(12_345); // ledger-consistent balance survived
    const tx = await db.execute<{ c: number }>(sql`SELECT count(*)::int AS c FROM coin_transactions`);
    expect(tx.rows[0].c).toBe(1);
    // sequences were restored → new inserts must not collide
    const again = await db.insert(users).values({ telegramId: 900002, referralCode: "E2ETEST2" }).returning({ id: users.id });
    expect(again[0].id).toBeGreaterThan(1);
  });

  it("rejects non-backup files", () => {
    expect(() => validateBackupJson("{}")).toThrow(/not a GOP Coin backup/);
    expect(() => validateBackupJson("not json at all")).toThrow(/valid JSON/);
  });
});

describe("economy v3 migration (drizzle/0002)", () => {
  /** Execute the statements of drizzle/0002_economy_v3.sql against the live test DB. */
  async function run0002() {
    const raw = readFileSync("drizzle/0002_economy_v3.sql", "utf8");
    const stmts = raw
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) await db.execute(sql.raw(s));
  }

  beforeAll(async () => {
    await truncateAll();
    // plant the OLD-generation state exactly as production looks today
    const oldGen = JSON.stringify({
      mine: { enabled: true, shutdownHours: 6, speedTiers: [0.5, 1, 2, 4, 8, 16, 32], speedPrices: [150, 350, 800, 1800, 4200, 10000], limitTiers: [500, 1000, 2000, 4000, 8000, 16000, 32000], limitPrices: [120, 300, 700, 1600, 3800, 9000] },
      payments: { crypto: { packages: [{ id: "c10000", gop: 10000, usd: 95 }] } },
    });
    await db.execute(sql.raw(`INSERT INTO game_config (key, value, version) VALUES ('main', '${oldGen}'::jsonb, 5)`));
    // speed-rusher who never bought capacity (was never cap-limited under v2):
    // speedTier 3 (96 GOP/day potential) with capTier 0
    await db.insert(users).values({ telegramId: 910001, referralCode: "MIGTEST1", mineSpeedTier: 3, mineLimitTier: 0 });
    await db.insert(users).values({ telegramId: 910002, referralCode: "MIGTEST2", mineSpeedTier: 1, mineLimitTier: 2 }); // bought caps early
  });

  it("gives users cap parity and refreshes the old-generation config exactly once", async () => {
    await run0002();

    const rusher = await db.select().from(users).where(eq(users.telegramId, 910001));
    expect(rusher[0].mineLimitTier).toBe(3); // GREATEST(0, 3) — income preserved
    const capBuyer = await db.select().from(users).where(eq(users.telegramId, 910002));
    expect(capBuyer[0].mineLimitTier).toBe(2); // untouched (already ahead)

    const [cfg] = await db.execute<{ value: Record<string, unknown>; version: number }>(
      sql`SELECT value, version FROM game_config WHERE key='main'`,
    ).then((r) => r.rows);
    const mine = cfg.value.mine as Record<string, unknown>;
    expect(mine.shutdownHours).toBe(0); // 24/7 mining
    expect(mine.limitTiers).toEqual([12, 24, 48, 96, 192, 384, 768]);
    expect(mine.speedPrices).toEqual([60, 130, 280, 600, 1300, 2800]);
    expect(cfg.value.payments).toBeTruthy();
    const crypto = (cfg.value.payments as { crypto?: { packages?: { id: string; usd: number }[] } }).crypto;
    expect(crypto?.packages?.find((p) => p.id === "c10000")?.usd).toBe(110);
    expect(cfg.version).toBe(6); // 5 → 6

    // second run: the guard no longer matches (limitTiers[0] ≠ 500) → config untouched
    await run0002();
    const [again] = await db.execute<{ version: number }>(sql`SELECT version FROM game_config WHERE key='main'`).then((r) => r.rows);
    expect(again.version).toBe(6);
    const rusherAfter = await db.select().from(users).where(eq(users.telegramId, 910001));
    expect(rusherAfter[0].mineLimitTier).toBe(3);
  });

  it("keeps a fresh v3 config untouched by the guard", async () => {
    // replace with a v3-style config, run migration, expect no change
    const v3 = JSON.stringify({
      mine: { enabled: true, shutdownHours: 0, speedTiers: [0.5, 1, 2, 4, 8, 16, 32], speedPrices: [60, 130, 280, 600, 1300, 2800], limitTiers: [12, 24, 48, 96, 192, 384, 768], limitPrices: [40, 90, 200, 450, 1000, 2200] },
    });
    await db.execute(sql.raw(`UPDATE game_config SET value = '${v3}'::jsonb, version = 10 WHERE key='main'`));
    await run0002();
    const [cfg] = await db.execute<{ version: number }>(sql`SELECT version FROM game_config WHERE key='main'`).then((r) => r.rows);
    expect(cfg.version).toBe(10); // guard did not fire
  });
});

afterAll(async () => {
  await pool.end();
});
