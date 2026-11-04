import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { coinTransactions, users, xpEvents } from "@/db/schema";
import { levelForXp, type LevelDef } from "@/lib/progression";
import { ApiError } from "@/lib/http";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Exec = Tx | typeof db;

/**
 * Coin transaction types. Amounts are integer milli-GOP; negative = spend/burn.
 * mine | referral_inviter | referral_welcome | task | purchase_stars | purchase_crypto | upgrade | admin_adjustment
 */
export type CoinTxType = "mine" | "referral_inviter" | "referral_welcome" | "task" | "purchase_stars" | "purchase_crypto" | "upgrade" | "admin_adjustment";

/**
 * The single entry point for balance changes. Must be called inside a transaction.
 * - Locks the user row (serializes concurrent reward operations per user).
 * - Inserts an immutable ledger row keyed by a unique idempotency key; a duplicate key = no-op.
 * - Applies the delta; CHECK(balance >= 0) is the last line of defence against negatives.
 * Returns the new balance, or null if this idempotency key was already processed.
 */
export async function creditCoins(
  tx: Tx,
  o: { userId: number; amount: number; type: CoinTxType; key: string; sourceRef?: string; reason?: string; adminTelegramId?: number },
): Promise<number | null> {
  if (!Number.isSafeInteger(o.amount)) throw new ApiError(400, "BAD_AMOUNT");
  const [row] = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, o.userId)).for("update");
  if (!row) throw new ApiError(404, "USER_NOT_FOUND");
  const after = row.balance + o.amount;
  if (after < 0) throw new ApiError(400, "NEGATIVE_BALANCE", "This adjustment would make the balance negative");
  const inserted = await tx
    .insert(coinTransactions)
    .values({
      userId: o.userId,
      type: o.type,
      amount: o.amount,
      balanceAfter: after,
      idempotencyKey: o.key,
      sourceRef: o.sourceRef ?? null,
      reason: o.reason ?? null,
      adminTelegramId: o.adminTelegramId ?? null,
    })
    .onConflictDoNothing({ target: coinTransactions.idempotencyKey })
    .returning({ id: coinTransactions.id });
  if (inserted.length === 0) return null;
  const earned = Math.max(0, o.amount);
  await tx
    .update(users)
    .set({
      balance: sql`${users.balance} + ${o.amount}`,
      lifetimeEarned: sql`GREATEST(0, ${users.lifetimeEarned} + ${o.amount})`,
      ...(o.type === "mine" ? { mineEarned: sql`${users.mineEarned} + ${earned}` } : {}),
      ...(o.type === "referral_inviter" ? { referralEarned: sql`${users.referralEarned} + ${earned}` } : {}),
      ...(o.type === "purchase_stars" || o.type === "purchase_crypto" ? { purchaseEarned: sql`${users.purchaseEarned} + ${earned}` } : {}),
    })
    .where(eq(users.id, o.userId));
  return after;
}

/** Idempotent XP grant + authoritative level recomputation. */
export async function grantXp(tx: Tx, o: { userId: number; amount: number; type: string; key: string; levels: LevelDef[] }) {
  if (o.amount <= 0) return null;
  const ins = await tx
    .insert(xpEvents)
    .values({ userId: o.userId, amount: o.amount, type: o.type, idempotencyKey: o.key })
    .onConflictDoNothing({ target: xpEvents.idempotencyKey })
    .returning({ id: xpEvents.id });
  if (ins.length === 0) return null;
  const [u] = await tx
    .update(users)
    .set({ xp: sql`${users.xp} + ${o.amount}` })
    .where(eq(users.id, o.userId))
    .returning({ xp: users.xp, level: users.level });
  const level = levelForXp(u.xp, o.levels);
  if (level !== u.level) await tx.update(users).set({ level }).where(eq(users.id, o.userId));
  return { xp: u.xp, level, previousLevel: u.level };
}
