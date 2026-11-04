import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { referrals, users, type User } from "@/db/schema";
import { getConfig, type GameConfig } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { creditCoins, grantXp, type Tx } from "@/lib/ledger";
import { levelProgress, nextStage, stageForLevel } from "@/lib/progression";
import { nextUtcReset, utcDay } from "@/lib/time";
import { tgApi } from "@/lib/telegram";
import { displayName, effectiveStatus, publicProfile } from "@/lib/users";

/** All amounts in this module are integer milli-GOP (1 GOP = 1000). */
export const MILLI = 1000;
const HOUR_MS = 3_600_000;

export type MineState = {
  on: boolean;
  /** true when the mine was off because the check-in deadline passed */
  shutDown: boolean;
  speedGop: number; // GOP/hour, e.g. 0.5
  dailyLimit: number; // whole GOP
  minedToday: number; // whole GOP (floor of milli)
  remainingToday: number; // whole GOP
  quotaFull: boolean;
  /** un-collected production preview (milli-GOP) */
  pendingMilli: number;
  pendingGop: number; // decimal GOP for display
  /** ms until the mine shuts down (null when off) */
  shutdownInMs: number | null;
  shutdownAt: string | null;
  /** next UTC midnight */
  resetAt: string;
  checkins: number;
  speedTier: number;
  limitTier: number;
  maxSpeedTier: number;
  maxLimitTier: number;
};

export type CheckinResult = {
  creditedGop: number;
  balanceGop: number;
  restarted: boolean;
  wasOff: boolean;
  xpGained: number;
  level: number;
  previousLevel: number;
  referralActivated: { inviteeReward: number } | null;
  state: MineState;
};

/** Speed of a tier in milli-GOP per hour. */
export function speedMilliPerHour(cfg: GameConfig, tier: number): number {
  const s = cfg.mine.speedTiers[Math.min(Math.max(tier, 0), cfg.mine.speedTiers.length - 1)];
  return Math.round(s * MILLI);
}

export function dailyLimitMilli(cfg: GameConfig, tier: number): number {
  const l = cfg.mine.limitTiers[Math.min(Math.max(tier, 0), cfg.mine.limitTiers.length - 1)];
  return Math.round(l * MILLI);
}

/**
 * Pure accrual math. Production accrues only while the mine is ON (checked in within
 * shutdownHours) and stops at the deadline — missed hours are never credited retroactively.
 * Production spanning UTC midnight is credited against the settle day (strictly ≤ the split
 * accounting, so it can never be exploited for extra coins).
 */
export function accrualPreview(u: User, cfg: GameConfig, now: Date, dayOverride?: string) {
  const shutdownMs = cfg.mine.shutdownHours * HOUR_MS;
  const deadline = u.mineLastActiveAt.getTime() + shutdownMs;
  const on = now.getTime() < deadline;
  const effectiveEnd = Math.min(now.getTime(), deadline);
  const settled = u.lastSettledAt.getTime();
  const elapsed = Math.max(0, effectiveEnd - Math.min(settled, effectiveEnd));
  const day = dayOverride ?? utcDay(now);
  const minedToday = u.dailyMinedDay === day ? u.dailyMined : 0;
  const raw = Math.floor((elapsed * speedMilliPerHour(cfg, u.mineSpeedTier)) / HOUR_MS);
  const room = Math.max(0, dailyLimitMilli(cfg, u.mineLimitTier) - minedToday);
  const pendingMilli = Math.min(raw, room);
  return { on, deadline, elapsed, minedToday, raw, pendingMilli };
}

/** Read-only mine state for UI/bot. No writes. */
export function buildMineState(u: User, cfg: GameConfig, now = new Date()): MineState {
  const p = accrualPreview(u, cfg, now);
  const limitMilli = dailyLimitMilli(cfg, u.mineLimitTier);
  const minedToday = p.minedToday + p.pendingMilli; // production already counted into the pending pot
  const remainingToday = Math.max(0, limitMilli - minedToday);
  return {
    on: p.on,
    shutDown: !p.on,
    speedGop: cfg.mine.speedTiers[Math.min(u.mineSpeedTier, cfg.mine.speedTiers.length - 1)],
    dailyLimit: limitMilli / MILLI,
    minedToday: Math.floor(minedToday / MILLI),
    remainingToday: Math.floor(remainingToday / MILLI),
    quotaFull: remainingToday <= 0,
    pendingMilli: p.pendingMilli,
    pendingGop: Math.round(p.pendingMilli) / MILLI,
    shutdownInMs: p.on ? Math.max(0, p.deadline - now.getTime()) : null,
    shutdownAt: p.on ? new Date(p.deadline).toISOString() : null,
    resetAt: nextUtcReset(now).toISOString(),
    checkins: u.collectedCount,
    speedTier: u.mineSpeedTier,
    limitTier: u.mineLimitTier,
    maxSpeedTier: cfg.mine.speedTiers.length - 1,
    maxLimitTier: cfg.mine.limitTiers.length - 1,
  };
}

type Activation = { referralId: number; inviterTelegramId: number; inviterName: string; inviteeName: string; inviterReward: number; inviteeReward: number };

/**
 * Atomically activate a pending referral exactly once. The conditional UPDATE (status='pending')
 * is the idempotency gate; ledger idempotency keys are a second, database-enforced gate.
 * Activation requires the invitee to have checked in activationCheckins times (anti-farm gate).
 */
export async function activateReferralIfEligible(tx: Tx, invitee: Pick<User, "id" | "firstName" | "lastName" | "username" | "collectedCount">, cfg: GameConfig): Promise<Activation | null> {
  if (!cfg.referral.enabled || invitee.collectedCount < cfg.referral.activationCheckins) return null;
  const [ref] = await tx
    .update(referrals)
    .set({ status: "activated", activatedAt: new Date(), inviterReward: cfg.referral.inviterReward, inviteeReward: cfg.referral.inviteeReward })
    .where(and(eq(referrals.inviteeId, invitee.id), eq(referrals.status, "pending")))
    .returning();
  if (!ref) return null;
  const [inviter] = await tx.select().from(users).where(eq(users.id, ref.inviterId)).limit(1);
  if (!inviter || inviter.status === "banned") {
    await tx.update(referrals).set({ status: "rejected", inviterReward: 0, inviteeReward: 0 }).where(eq(referrals.id, ref.id));
    return null;
  }
  if (cfg.referral.inviterReward > 0) {
    await creditCoins(tx, { userId: inviter.id, amount: cfg.referral.inviterReward * MILLI, type: "referral_inviter", key: `referral_inviter:${ref.id}`, sourceRef: `referral:${ref.id}` });
  }
  await tx.update(users).set({ referralCount: sql`${users.referralCount} + 1` }).where(eq(users.id, inviter.id));
  await grantXp(tx, { userId: inviter.id, amount: cfg.xp.perReferral, type: "referral", key: `referral:${ref.id}`, levels: cfg.progression.levels });
  if (cfg.referral.inviteeReward > 0) {
    await creditCoins(tx, { userId: invitee.id, amount: cfg.referral.inviteeReward * MILLI, type: "referral_welcome", key: `referral_welcome:${ref.id}`, sourceRef: `referral:${ref.id}` });
  }
  await grantXp(tx, { userId: invitee.id, amount: cfg.xp.perWelcome, type: "welcome", key: `welcome:${ref.id}`, levels: cfg.progression.levels });
  return {
    referralId: ref.id,
    inviterTelegramId: inviter.telegramId,
    inviterName: displayName(inviter),
    inviteeName: displayName(invitee),
    inviterReward: cfg.referral.inviterReward,
    inviteeReward: cfg.referral.inviteeReward,
  };
}

/**
 * Check-in = collect + keep the mine running.
 * One transaction holding the user's row lock serializes concurrent check-ins from any number
 * of devices; the settle key makes the ledger write idempotent, so double submits are no-ops.
 */
export async function checkIn(o: { userId: number; now?: Date; cfg?: GameConfig }): Promise<CheckinResult> {
  const cfg = o.cfg ?? (await getConfig());
  const now = o.now ?? new Date();
  if (!cfg.mine.enabled || cfg.announcement.maintenance) throw new ApiError(503, "MINING_PAUSED", "Mining is temporarily paused");
  const day = utcDay(now);
  const settleKey = `mine:${o.userId}:${now.getTime()}`;
  const holder: { activation: Activation | null } = { activation: null };

  const result = await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, o.userId)).for("update");
    if (!u) throw new ApiError(404, "USER_NOT_FOUND");
    const status = effectiveStatus(u);
    if (status === "banned") throw new ApiError(403, "ACCOUNT_BANNED", "This account has been banned");
    if (status === "suspended") throw new ApiError(403, "EARNING_SUSPENDED", "Earning is temporarily suspended for this account");

    const wasOff = now.getTime() >= u.mineLastActiveAt.getTime() + cfg.mine.shutdownHours * HOUR_MS;
    const p = accrualPreview(u, cfg, now, day);
    const credited = p.pendingMilli;

    // Daily production counter (whole window is attributed to the settle day — see accrualPreview).
    const dailyMined = (u.dailyMinedDay === day ? u.dailyMined : 0) + credited;

    if (credited > 0) {
      await creditCoins(tx, { userId: o.userId, amount: credited, type: "mine", key: settleKey, sourceRef: `day:${day}`, reason: `${(credited / MILLI).toFixed(3)} GOP mined` });
    }
    await grantXp(tx, { userId: o.userId, amount: cfg.xp.perCheckin, type: "checkin", key: `checkin:${o.userId}:${now.getTime()}`, levels: cfg.progression.levels });

    const [updated] = await tx
      .update(users)
      .set({
        mineLastActiveAt: now, // check-in restarts the shutdown window
        lastSettledAt: now,
        dailyMined,
        dailyMinedDay: day,
        collectedCount: sql`${users.collectedCount} + 1`,
      })
      .where(eq(users.id, o.userId))
      .returning();

    let previousLevel = u.level;
    let level = u.level;
    if (u.referredById) {
      holder.activation = await activateReferralIfEligible(tx, updated, cfg);
    }
    const [fresh] = await tx.select({ level: users.level, balance: users.balance }).from(users).where(eq(users.id, o.userId)).limit(1);
    level = fresh.level;
    previousLevel = u.level;

    const state = buildMineState({ ...updated, dailyMined, dailyMinedDay: day }, cfg, now);
    return {
      creditedGop: credited / MILLI,
      balanceGop: fresh.balance / MILLI,
      restarted: true,
      wasOff,
      xpGained: cfg.xp.perCheckin,
      level,
      previousLevel,
      referralActivated: holder.activation ? { inviteeReward: holder.activation.inviteeReward } : null,
      state,
    } satisfies CheckinResult;
  });

  if (holder.activation) void notifyInviter(holder.activation);
  return result;
}

async function notifyInviter(a: Activation) {
  await tgApi("sendMessage", {
    chat_id: a.inviterTelegramId,
    text: `⛏ ${a.inviteeName} started mining Gop Coin with your link!\n\n+${a.inviterReward} GOP Coins have been added to your balance.`,
  });
}

/** Full authoritative state for the client. */
export async function buildMeState(user: User, isAdmin: boolean) {
  const cfg = await getConfig();
  const now = new Date();
  const mine = buildMineState(user, cfg, now);
  const prog = levelProgress(user.xp, cfg.progression.levels);
  const stage = stageForLevel(user.level, cfg.progression.stages);
  const upcoming = nextStage(user.level, cfg.progression.stages);
  const [pending] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(referrals)
    .where(and(eq(referrals.inviterId, user.id), eq(referrals.status, "pending")));
  const [myReferral] = await db.select({ status: referrals.status }).from(referrals).where(eq(referrals.inviteeId, user.id)).limit(1);
  return {
    user: {
      ...publicProfile(user),
      username: user.username,
      balance: user.balance / MILLI,
      balanceMilli: user.balance,
      lifetimeEarned: user.lifetimeEarned / MILLI,
      mineEarned: user.mineEarned / MILLI,
      referralEarned: user.referralEarned / MILLI,
      purchaseEarned: user.purchaseEarned / MILLI,
      checkins: user.collectedCount,
      xp: user.xp,
      referralCount: user.referralCount,
      pendingReferrals: pending.c,
      referralCode: user.referralCode,
      status: effectiveStatus(user),
      suspendedUntil: user.suspendedUntil,
      joinedAt: user.createdAt,
      invitedBy: myReferral ? { status: myReferral.status } : null,
    },
    progression: { ...prog, stage, nextStage: upcoming },
    mine,
    mineTierData: {
      speedTiers: cfg.mine.speedTiers,
      speedPrices: cfg.mine.speedPrices,
      limitTiers: cfg.mine.limitTiers,
      limitPrices: cfg.mine.limitPrices,
    },
    rules: {
      mineEnabled: cfg.mine.enabled && !cfg.announcement.maintenance,
      shutdownHours: cfg.mine.shutdownHours,
      referralEnabled: cfg.referral.enabled,
      inviterReward: cfg.referral.inviterReward,
      inviteeReward: cfg.referral.inviteeReward,
      activationCheckins: cfg.referral.activationCheckins,
      xpPerCheckin: cfg.xp.perCheckin,
      xpPerReferral: cfg.xp.perReferral,
      campaignNote: cfg.referral.campaignNote,
      shopEnabled: cfg.features.shop,
    },
    payments: cfg.payments,
    levels: cfg.progression.levels,
    stages: cfg.progression.stages,
    features: cfg.features,
    community: cfg.community,
    announcement: cfg.announcement,
    isAdmin,
    serverTime: now.toISOString(),
  };
}

export async function friendsState(user: User) {
  const rows = await db
    .select({ ref: referrals, u: users })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.inviteeId))
    .where(eq(referrals.inviterId, user.id))
    .orderBy(desc(referrals.createdAt))
    .limit(200);
  const activated = rows.filter((r) => r.ref.status === "activated").length;
  const pending = rows.filter((r) => r.ref.status === "pending").length;
  return {
    total: rows.length,
    activated,
    pending,
    earned: user.referralEarned / MILLI,
    friends: rows.map((r) => ({
      ...publicProfile(r.u),
      status: r.ref.status,
      joinedAt: r.ref.createdAt,
      activatedAt: r.ref.activatedAt,
      reward: r.ref.inviterReward ?? 0,
      progress: Math.min(r.u.collectedCount, 10_000),
    })),
  };
}
