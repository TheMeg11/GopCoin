/**
 * Backup & restore round-trip against a real PostgreSQL (booted by tests/e2e-db.mjs).
 * Requires DATABASE_URL pointing at a migrated database.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
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

afterAll(async () => {
  await pool.end();
});
