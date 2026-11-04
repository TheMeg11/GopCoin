import { randomUUID } from "crypto";
import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { MILLI } from "@/lib/mine";
import {
  accountRestrictions, adminAuditLogs, broadcasts, coinTransactions, cryptoOrders, referrals,
  securityEvents, taskClaims, tasks, users,
} from "@/db/schema";
import { getConfigWithVersion, saveConfig, type GameConfig } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { creditCoins } from "@/lib/ledger";
import { completeClaim } from "@/lib/tasks";
import { queueBroadcast, processBroadcastTick } from "@/lib/broadcast";
import { setupBot } from "@/lib/bot";
import { startOfUtcDay, utcDay } from "@/lib/time";
import { displayName, effectiveStatus } from "@/lib/users";

export async function audit(adminId: number, action: string, targetUserId: number | null, details?: Record<string, unknown>) {
  await db.insert(adminAuditLogs).values({ adminTelegramId: adminId, action, targetUserId, details: details ?? null });
}

const num = (v: unknown) => Number(v ?? 0);

export async function getStats() {
  const today = startOfUtcDay();
  const day = utcDay();
  const { value: cfg } = await getConfigWithVersion();
  const [u] = (await db.execute<Record<string, string>>(sql`SELECT
      count(*) total,
      count(*) FILTER (WHERE created_at >= ${today}) new_today,
      count(*) FILTER (WHERE last_seen_at >= ${today}) dau,
      count(*) FILTER (WHERE flagged) flagged,
      count(*) FILTER (WHERE status <> 'active') restricted,
      coalesce(sum(balance),0) balances,
      coalesce(sum(mine_earned),0) mine_coins,
      coalesce(sum(purchase_earned),0) purchase_coins,
      count(*) FILTER (WHERE mine_last_active_at + make_interval(hours => ${cfg.mine.shutdownHours}) > now()) mines_running
    FROM users`)).rows;
  const [r] = (await db.execute<Record<string, string>>(sql`SELECT
      count(*) FILTER (WHERE status='activated') activated,
      count(*) FILTER (WHERE status='pending') pending,
      count(*) FILTER (WHERE activated_at >= ${today}) activated_today
    FROM referrals`)).rows;
  const [m] = (await db.execute<Record<string, string>>(sql`SELECT
      coalesce(sum(daily_mined),0) mined_today
    FROM users WHERE daily_mined_day = ${day}`)).rows;
  const [l] = (await db.execute<Record<string, string>>(sql`SELECT
      coalesce(sum(amount) FILTER (WHERE type IN ('referral_inviter','referral_welcome')),0) referral_rewards,
      coalesce(sum(amount) FILTER (WHERE type='task'),0) task_rewards
    FROM coin_transactions`)).rows;
  const [pc] = (await db.execute<Record<string, string>>(sql`SELECT count(*) c FROM task_claims WHERE status='pending'`)).rows;
  const [co] = (await db.execute<Record<string, string>>(sql`SELECT
      count(*) FILTER (WHERE status='pending') pending_orders,
      coalesce(sum(usd_amount) FILTER (WHERE status='approved'),0) approved_usd
    FROM crypto_orders`)).rows;
  const series = (await db.execute<Record<string, string>>(sql`
    WITH d AS (SELECT generate_series((now() at time zone 'utc')::date - 13, (now() at time zone 'utc')::date, interval '1 day')::date AS day)
    SELECT to_char(d.day,'YYYY-MM-DD') AS day,
      (SELECT count(*) FROM users WHERE (created_at at time zone 'utc')::date = d.day) AS registrations,
      (SELECT count(*) FROM users WHERE last_seen_at::date = d.day) AS active,
      (SELECT count(*) FROM referrals WHERE (activated_at at time zone 'utc')::date = d.day) AS referrals,
      (SELECT coalesce(sum(amount),0) FROM coin_transactions WHERE amount > 0 AND (created_at at time zone 'utc')::date = d.day) AS coins
    FROM d ORDER BY d.day`)).rows;
  return {
    users: { total: num(u.total), newToday: num(u.new_today), dau: num(u.dau), flagged: num(u.flagged), restricted: num(u.restricted) },
    referrals: { activated: num(r.activated), pending: num(r.pending), activatedToday: num(r.activated_today) },
    coins: {
      balances: num(u.balances) / MILLI,
      mineCoins: num(u.mine_coins) / MILLI,
      purchaseCoins: num(u.purchase_coins) / MILLI,
      referralRewards: num(l.referral_rewards) / MILLI,
      taskRewards: num(l.task_rewards) / MILLI,
      minedToday: num(m.mined_today) / MILLI,
    },
    mines: { running: num(u.mines_running) },
    payments: { pendingCryptoOrders: num(co.pending_orders), approvedCryptoUsd: num(co.approved_usd) },
    pendingClaims: num(pc.c),
    series: series.map((s) => ({ day: s.day, registrations: num(s.registrations), active: num(s.active), referrals: num(s.referrals), coins: num(s.coins) / MILLI })),
    config: {
      baseSpeed: cfg.mine.speedTiers[0],
      shutdownHours: cfg.mine.shutdownHours,
      baseDailyCap: cfg.mine.limitTiers[0],
      inviterReward: cfg.referral.inviterReward,
      inviteeReward: cfg.referral.inviteeReward,
      starsEnabled: cfg.payments.stars.enabled,
      cryptoEnabled: cfg.payments.crypto.enabled,
      mining: cfg.mine.enabled,
      referrals: cfg.referral.enabled,
      maintenance: cfg.announcement.maintenance,
    },
  };
}

export async function listUsers(params: URLSearchParams) {
  const q = (params.get("q") ?? "").trim().slice(0, 64);
  const filter = params.get("filter") ?? "all";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const pageSize = 25;
  const conds: SQL[] = [];
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const c = or(ilike(users.firstName, like), ilike(users.lastName, like), ilike(users.username, like), ilike(users.referralCode, like), ...(/^\d+$/.test(q) ? [eq(users.telegramId, Number(q))] : []));
    if (c) conds.push(c);
  }
  let order: SQL = desc(users.createdAt);
  if (filter === "active") conds.push(eq(users.status, "active"));
  if (filter === "restricted") conds.push(inArray(users.status, ["suspended", "banned"]));
  if (filter === "flagged") { conds.push(eq(users.flagged, true)); order = desc(users.riskScore); }
  if (filter === "referrals") order = desc(users.referralCount);
  if (filter === "balance") order = desc(users.balance);
  if (filter === "miners") order = desc(users.mineEarned);
  if (filter === "recent") conds.push(gte(users.createdAt, new Date(Date.now() - 86400_000)));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(order, desc(users.id))
    .limit(pageSize + 1)
    .offset(page * pageSize);
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(users).where(where);
  return {
    total: c,
    page,
    hasMore: rows.length > pageSize,
    users: rows.slice(0, pageSize).map((u) => ({
      id: u.id, telegramId: String(u.telegramId), name: displayName(u), username: u.username, joinedAt: u.createdAt,
      balance: u.balance / MILLI, lifetimeEarned: u.lifetimeEarned / MILLI, level: u.level, referralCount: u.referralCount,
      speedTier: u.mineSpeedTier, capTier: u.mineLimitTier, minedToday: u.dailyMinedDay === utcDay() ? u.dailyMined / MILLI : 0,
      status: effectiveStatus(u), flagged: u.flagged, riskScore: u.riskScore,
    })),
  };
}

export async function userDetail(id: number) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw new ApiError(404, "USER_NOT_FOUND");
  const [ledger, invited, inviter, orders, restrictions, events] = await Promise.all([
    db.select().from(coinTransactions).where(eq(coinTransactions.userId, id)).orderBy(desc(coinTransactions.id)).limit(50),
    db.select({ r: referrals, name: users.firstName, username: users.username }).from(referrals).innerJoin(users, eq(users.id, referrals.inviteeId)).where(eq(referrals.inviterId, id)).orderBy(desc(referrals.id)).limit(50),
    db.select({ r: referrals, inviter: users }).from(referrals).innerJoin(users, eq(users.id, referrals.inviterId)).where(eq(referrals.inviteeId, id)).limit(1),
    db.select().from(cryptoOrders).where(eq(cryptoOrders.userId, id)).orderBy(desc(cryptoOrders.id)).limit(20),
    db.select().from(accountRestrictions).where(eq(accountRestrictions.userId, id)).orderBy(desc(accountRestrictions.id)).limit(30),
    db.select().from(securityEvents).where(eq(securityEvents.userId, id)).orderBy(desc(securityEvents.id)).limit(30),
  ]);
  const [{ sum }] = await db.select({ sum: sql<string>`coalesce(sum(amount),0)` }).from(coinTransactions).where(eq(coinTransactions.userId, id));
  return {
    user: {
      ...u,
      telegramId: String(u.telegramId),
      name: displayName(u),
      effectiveStatus: effectiveStatus(u),
      balance: u.balance / MILLI,
      lifetimeEarned: u.lifetimeEarned / MILLI,
      mineEarned: u.mineEarned / MILLI,
      referralEarned: u.referralEarned / MILLI,
      purchaseEarned: u.purchaseEarned / MILLI,
    },
    ledgerConsistent: Number(sum) === u.balance,
    ledger: ledger.map((l) => ({ ...l, amount: l.amount / MILLI, balanceAfter: l.balanceAfter / MILLI })),
    invited: invited.map((i) => ({ id: i.r.inviteeId, name: i.name, username: i.username, status: i.r.status, createdAt: i.r.createdAt, activatedAt: i.r.activatedAt })),
    inviter: inviter[0] ? { id: inviter[0].inviter.id, name: displayName(inviter[0].inviter), status: inviter[0].r.status } : null,
    orders: orders.map((o) => ({ ...o, gopAmount: o.gopAmount, usdAmount: o.usdAmount })),
    restrictions,
    events,
  };
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string().trim().min(3).max(500), hours: z.number().int().min(1).max(24 * 365), confirm: z.literal(true) }),
  z.object({ action: z.literal("restore"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("ban"), reason: z.string().trim().min(3).max(500), confirm: z.literal(true) }),
  z.object({ action: z.literal("unban"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("flag"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("unflag"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("note"), note: z.string().trim().max(2000) }),
  z.object({ action: z.literal("adjust"), amount: z.number().min(-100_000_000).max(100_000_000).refine((n) => n !== 0, "Amount cannot be 0"), reason: z.string().trim().min(5).max(500), confirm: z.literal(true) }),
]);

export async function userAction(adminId: number, userId: number, body: unknown) {
  const a = actionSchema.parse(body);
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new ApiError(404, "USER_NOT_FOUND");
  const restrict = async (action: string, reason: string, set: Partial<typeof users.$inferInsert>, until: Date | null = null) => {
    await db.transaction(async (tx) => {
      await tx.update(users).set(set).where(eq(users.id, userId));
      await tx.insert(accountRestrictions).values({ userId, action, reason, until, adminTelegramId: adminId });
      await tx.insert(adminAuditLogs).values({ adminTelegramId: adminId, action: `user.${action}`, targetUserId: userId, details: { reason, until } });
    });
  };
  switch (a.action) {
    case "suspend": {
      const until = new Date(Date.now() + a.hours * 3600_000);
      await restrict("suspend", a.reason, { status: "suspended", suspendedUntil: until, statusReason: a.reason }, until);
      break;
    }
    case "restore":
      await restrict("restore", a.reason, { status: "active", suspendedUntil: null, statusReason: null });
      break;
    case "ban":
      await restrict("ban", a.reason, { status: "banned", statusReason: a.reason });
      break;
    case "unban":
      await restrict("unban", a.reason, { status: "active", suspendedUntil: null, statusReason: null });
      break;
    case "flag":
      await restrict("flag", a.reason, { flagged: true });
      break;
    case "unflag":
      await restrict("unflag", a.reason, { flagged: false, riskScore: 0 });
      await db.update(securityEvents).set({ resolved: true }).where(eq(securityEvents.userId, userId));
      break;
    case "note":
      await db.update(users).set({ adminNote: a.note || null }).where(eq(users.id, userId));
      await audit(adminId, "user.note", userId, { note: a.note });
      break;
    case "adjust": {
      // Amount arrives in whole GOP; the ledger stores milli-GOP.
      const key = `admin:${randomUUID()}`;
      const amountMilli = Math.round(a.amount * MILLI);
      await db.transaction(async (tx) => {
        const balance = await creditCoins(tx, { userId, amount: amountMilli, type: "admin_adjustment", key, reason: a.reason, adminTelegramId: adminId });
        await tx.insert(adminAuditLogs).values({ adminTelegramId: adminId, action: "user.adjust_balance", targetUserId: userId, details: { amount: a.amount, reason: a.reason, balanceAfter: (balance ?? 0) / MILLI, ledgerKey: key } });
      });
      break;
    }
  }
  return userDetail(userId);
}

export async function updateConfig(adminId: number, body: unknown) {
  const b = z.object({ config: z.unknown(), version: z.number().int(), confirm: z.literal(true) }).parse(body);
  const before = await getConfigWithVersion();
  let saved: GameConfig;
  try {
    saved = await saveConfig(b.config, b.version, adminId);
  } catch (e) {
    if (e instanceof Error && e.message === "CONFIG_CONFLICT") throw new ApiError(409, "CONFIG_CONFLICT", "Configuration was changed elsewhere. Reload and try again.");
    throw e;
  }
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const section of Object.keys(saved) as (keyof GameConfig)[]) {
    const from = before.value[section] as Record<string, unknown>;
    const to = saved[section] as Record<string, unknown>;
    for (const k of Object.keys(to)) {
      if (JSON.stringify(from?.[k]) !== JSON.stringify(to[k])) changed[`${section}.${k}`] = k === "levels" || k === "stages" || k === "packages" ? { from: "(list)", to: "(list updated)" } : { from: from?.[k], to: to[k] };
    }
  }
  await audit(adminId, "config.update", null, { changed });
  return getConfigWithVersion();
}

const taskSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(""),
  type: z.enum(["link", "telegram_channel", "ingame"]),
  verification: z.enum(["manual", "telegram_member", "auto"]),
  url: z.union([z.literal(""), z.string().trim().url().max(500)]).nullable().default(null),
  chatId: z.string().trim().max(64).nullable().default(null),
  requirementKind: z.enum(["level", "referrals", "collected", "checkins"]).nullable().default(null),
  requirementValue: z.number().int().min(1).max(10_000_000).nullable().default(null),
  reward: z.number().int().min(0).max(1_000_000),
  active: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().default(null),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
}).superRefine((t, ctx) => {
  if (t.verification === "auto" && (!t.requirementKind || !t.requirementValue)) ctx.addIssue({ code: "custom", path: ["requirementKind"], message: "Auto tasks need a requirement" });
  if (t.verification === "telegram_member" && !t.chatId) ctx.addIssue({ code: "custom", path: ["chatId"], message: "Membership tasks need a chat id (e.g. @channel)" });
});

function taskValues(t: z.infer<typeof taskSchema>) {
  return { ...t, url: t.url || null, chatId: t.chatId || null, expiresAt: t.expiresAt ? new Date(t.expiresAt) : null };
}

export async function createTask(adminId: number, body: unknown) {
  const t = taskSchema.parse(body);
  const [row] = await db.insert(tasks).values(taskValues(t)).returning();
  await audit(adminId, "task.create", null, { taskId: row.id, title: row.title, reward: row.reward });
  return row;
}

export async function updateTask(adminId: number, id: number, body: unknown) {
  const t = taskSchema.parse(body);
  const [row] = await db.update(tasks).set(taskValues(t)).where(eq(tasks.id, id)).returning();
  if (!row) throw new ApiError(404, "TASK_NOT_FOUND");
  await audit(adminId, "task.update", null, { taskId: id, title: row.title, reward: row.reward, active: row.active });
  return row;
}

export async function listClaims(status: string) {
  return db
    .select({ c: taskClaims, title: tasks.title, reward: tasks.reward, name: users.firstName, username: users.username, telegramId: users.telegramId })
    .from(taskClaims)
    .innerJoin(tasks, eq(tasks.id, taskClaims.taskId))
    .innerJoin(users, eq(users.id, taskClaims.userId))
    .where(eq(taskClaims.status, status))
    .orderBy(desc(taskClaims.id))
    .limit(100)
    .then((rows) => rows.map((r) => ({ ...r, telegramId: String(r.telegramId) })));
}

export async function reviewClaim(adminId: number, claimId: number, body: unknown) {
  const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(body);
  const [c] = await db.select().from(taskClaims).where(eq(taskClaims.id, claimId)).limit(1);
  if (!c || c.status !== "pending") throw new ApiError(409, "CLAIM_NOT_PENDING");
  if (decision === "approve") {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, c.taskId));
    await completeClaim(c.taskId, c.userId, t.reward, adminId);
  } else {
    await db.update(taskClaims).set({ status: "rejected", reviewedBy: adminId }).where(and(eq(taskClaims.id, claimId), eq(taskClaims.status, "pending")));
  }
  await audit(adminId, `claim.${decision}`, c.userId, { claimId, taskId: c.taskId });
  return { ok: true };
}

export async function listSecurity() {
  return db
    .select({ e: securityEvents, name: users.firstName, username: users.username })
    .from(securityEvents)
    .leftJoin(users, eq(users.id, securityEvents.userId))
    .where(eq(securityEvents.resolved, false))
    .orderBy(desc(securityEvents.id))
    .limit(100);
}

export async function resolveSecurity(adminId: number, id: number) {
  await db.update(securityEvents).set({ resolved: true }).where(eq(securityEvents.id, id));
  await audit(adminId, "security.resolve", null, { eventId: id });
  return { ok: true };
}

const broadcastSchema = z.object({
  title: z.string().trim().min(2).max(120),
  message: z.string().trim().min(1).max(3500),
  buttonText: z.string().trim().max(40).nullable().default(null),
  segment: z.enum(["all", "active7d", "level5"]),
  scheduledAt: z.string().datetime().nullable().default(null),
});

export async function createBroadcast(adminId: number, body: unknown) {
  const b = broadcastSchema.parse(body);
  const [row] = await db.insert(broadcasts).values({ ...b, buttonText: b.buttonText || null, scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null, createdBy: adminId }).returning();
  await audit(adminId, "broadcast.create", null, { broadcastId: row.id, title: row.title, segment: row.segment });
  return row;
}

export async function broadcastAction(adminId: number, id: number, action: string) {
  if (action === "queue") {
    const total = await queueBroadcast(id).catch((e: Error) => { throw new ApiError(409, "BROADCAST_STATE", e.message); });
    await audit(adminId, "broadcast.queue", null, { broadcastId: id, recipients: total });
  } else if (action === "cancel") {
    await db.update(broadcasts).set({ status: "cancelled" }).where(and(eq(broadcasts.id, id), inArray(broadcasts.status, ["draft", "queued"])));
    await audit(adminId, "broadcast.cancel", null, { broadcastId: id });
  } else if (action === "process") {
    await processBroadcastTick();
  } else throw new ApiError(400, "BAD_ACTION");
  const [row] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  return row;
}

export async function listBroadcasts() {
  return db.select().from(broadcasts).orderBy(desc(broadcasts.id)).limit(50);
}

export async function listAudit() {
  const rows = await db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.id)).limit(200);
  return rows.map((r) => ({ ...r, adminTelegramId: String(r.adminTelegramId) }));
}

export async function runBotSetup(adminId: number) {
  const res = await setupBot().catch((e: Error) => { throw new ApiError(400, "BOT_SETUP_FAILED", e.message); });
  await audit(adminId, "bot.setup", null, { webhookOk: res.webhook.ok, menuOk: res.menu.ok });
  return res;
}
