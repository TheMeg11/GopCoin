import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** All coin amounts across the schema are integer MILLI-GOP (1 GOP = 1000 milli). */
export const MILLI = 1000;

/** Players. Identity = Telegram user id validated server-side. Balances are integer counters guarded by CHECK constraints. */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    firstName: varchar("first_name", { length: 128 }).notNull().default(""),
    lastName: varchar("last_name", { length: 128 }),
    username: varchar("username", { length: 64 }),
    photoUrl: text("photo_url"),
    languageCode: varchar("language_code", { length: 16 }),
    referralCode: varchar("referral_code", { length: 16 }).notNull(),
    referredById: integer("referred_by_id"),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    lifetimeEarned: bigint("lifetime_earned", { mode: "number" }).notNull().default(0),
    mineEarned: bigint("mine_earned", { mode: "number" }).notNull().default(0),
    referralEarned: bigint("referral_earned", { mode: "number" }).notNull().default(0),
    purchaseEarned: bigint("purchase_earned", { mode: "number" }).notNull().default(0),
    collectedCount: integer("collected_count").notNull().default(0),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    level: integer("level").notNull().default(1),
    referralCount: integer("referral_count").notNull().default(0),
    mineSpeedTier: integer("mine_speed_tier").notNull().default(0),
    mineLimitTier: integer("mine_limit_tier").notNull().default(0),
    /** Last time the user checked in (pressed "keep mining"). The mine auto-stops shutdownHours later. */
    mineLastActiveAt: ts("mine_last_active_at").notNull().defaultNow(),
    /** Last time accrued production was moved into the balance. */
    lastSettledAt: ts("last_settled_at").notNull().defaultNow(),
    /** Production credited today (milli-GOP) and the UTC day it belongs to. */
    dailyMined: bigint("daily_mined", { mode: "number" }).notNull().default(0),
    dailyMinedDay: date("daily_mined_day", { mode: "string" }),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active | suspended | banned
    suspendedUntil: ts("suspended_until"),
    statusReason: text("status_reason"),
    flagged: boolean("flagged").notNull().default(false),
    riskScore: integer("risk_score").notNull().default(0),
    canMessage: boolean("can_message").notNull().default(false),
    botBlocked: boolean("bot_blocked").notNull().default(false),
    adminNote: text("admin_note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_telegram_id_uq").on(t.telegramId),
    uniqueIndex("users_referral_code_uq").on(t.referralCode),
    index("users_referred_by_idx").on(t.referredById),
    index("users_lifetime_idx").on(t.lifetimeEarned),
    index("users_xp_idx").on(t.xp),
    index("users_refcount_idx").on(t.referralCount),
    index("users_created_idx").on(t.createdAt),
    check("users_balance_nonneg", sql`${t.balance} >= 0`),
    check("users_counters_nonneg", sql`${t.xp} >= 0 AND ${t.referralCount} >= 0 AND ${t.collectedCount} >= 0`),
    check("users_mine_tiers", sql`${t.mineSpeedTier} >= 0 AND ${t.mineLimitTier} >= 0`),
    check("users_daily_mined_nonneg", sql`${t.dailyMined} >= 0`),
  ],
);

/** Append-only coin ledger. Every balance change writes exactly one row. Amounts in milli-GOP. */
export const coinTransactions = pgTable(
  "coin_transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").notNull(),
    type: varchar("type", { length: 32 }).notNull(), // mine | referral_inviter | referral_welcome | task | purchase_stars | purchase_crypto | upgrade | admin_adjustment
    amount: bigint("amount", { mode: "number" }).notNull(), // negative = spend/burn
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    sourceRef: varchar("source_ref", { length: 128 }),
    reason: text("reason"),
    adminTelegramId: bigint("admin_telegram_id", { mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("coin_tx_idem_uq").on(t.idempotencyKey),
    index("coin_tx_user_idx").on(t.userId, t.createdAt),
    index("coin_tx_type_created_idx").on(t.type, t.createdAt),
    check("coin_tx_amount_nonzero", sql`${t.amount} <> 0`),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    inviterId: integer("inviter_id").notNull(),
    inviteeId: integer("invitee_id").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | activated | rejected
    source: varchar("source", { length: 16 }).notNull().default("miniapp"),
    inviterReward: integer("inviter_reward"),
    inviteeReward: integer("invitee_reward"),
    createdAt: ts("created_at").notNull().defaultNow(),
    activatedAt: ts("activated_at"),
  },
  (t) => [
    uniqueIndex("referrals_invitee_uq").on(t.inviteeId),
    index("referrals_inviter_idx").on(t.inviterId, t.status),
    index("referrals_activated_idx").on(t.activatedAt),
    check("referrals_no_self", sql`${t.inviterId} <> ${t.inviteeId}`),
  ],
);

export const xpEvents = pgTable(
  "xp_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    amount: integer("amount").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("xp_events_idem_uq").on(t.idempotencyKey), index("xp_events_user_idx").on(t.userId)],
);

/** Versioned, database-backed game configuration (single "main" row). */
export const gameConfig = pgTable("game_config", {
  key: varchar("key", { length: 32 }).primaryKey(),
  value: jsonb("value").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: bigint("updated_by", { mode: "number" }),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description").notNull().default(""),
  type: varchar("type", { length: 24 }).notNull(), // link | telegram_channel | ingame
  verification: varchar("verification", { length: 24 }).notNull(), // manual | telegram_member | auto
  url: text("url"),
  chatId: varchar("chat_id", { length: 64 }),
  requirementKind: varchar("requirement_kind", { length: 24 }), // level | referrals | collected | checkins
  requirementValue: integer("requirement_value"),
  reward: integer("reward").notNull().default(0),
  active: boolean("active").notNull().default(true),
  expiresAt: ts("expires_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const taskClaims = pgTable(
  "task_claims",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").notNull(),
    userId: integer("user_id").notNull(),
    status: varchar("status", { length: 16 }).notNull(), // pending | completed | rejected
    reward: integer("reward"),
    reviewedBy: bigint("reviewed_by", { mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [uniqueIndex("task_claims_task_user_uq").on(t.taskId, t.userId), index("task_claims_status_idx").on(t.status)],
);

export const securityEvents = pgTable(
  "security_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id"),
    type: varchar("type", { length: 48 }).notNull(),
    severity: integer("severity").notNull().default(1),
    details: jsonb("details"),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("security_events_user_idx").on(t.userId, t.createdAt), index("security_events_created_idx").on(t.createdAt)],
);

export const accountRestrictions = pgTable(
  "account_restrictions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    action: varchar("action", { length: 16 }).notNull(), // flag | unflag | suspend | restore | ban | unban
    reason: text("reason").notNull(),
    until: ts("until"),
    adminTelegramId: bigint("admin_telegram_id", { mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("restrictions_user_idx").on(t.userId)],
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adminTelegramId: bigint("admin_telegram_id", { mode: "number" }).notNull(),
    action: varchar("action", { length: 48 }).notNull(),
    targetUserId: integer("target_user_id"),
    details: jsonb("details"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const broadcasts = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  message: text("message").notNull(),
  buttonText: varchar("button_text", { length: 40 }),
  segment: varchar("segment", { length: 24 }).notNull().default("all"), // all | active7d | level5
  status: varchar("status", { length: 16 }).notNull().default("draft"), // draft | queued | completed | cancelled
  scheduledAt: ts("scheduled_at"),
  total: integer("total").notNull().default(0),
  sent: integer("sent").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  createdBy: bigint("created_by", { mode: "number" }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const broadcastDeliveries = pgTable(
  "broadcast_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    broadcastId: integer("broadcast_id").notNull(),
    userId: integer("user_id").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | sending | sent | failed
    error: text("error"),
    sentAt: ts("sent_at"),
  },
  (t) => [
    uniqueIndex("deliveries_bc_user_uq").on(t.broadcastId, t.userId),
    index("deliveries_bc_status_idx").on(t.broadcastId, t.status),
  ],
);

/** Manual crypto purchases (BNB BEP-20). One row per user order; tx_hash is globally unique. */
export const cryptoOrders = pgTable(
  "crypto_orders",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    packageId: varchar("package_id", { length: 32 }).notNull(),
    gopAmount: bigint("gop_amount", { mode: "number" }).notNull(), // whole GOP
    usdAmount: numeric("usd_amount", { precision: 12, scale: 2 }).notNull(),
    assetSymbol: varchar("asset_symbol", { length: 12 }).notNull().default("BNB"),
    assetAmount: numeric("asset_amount", { precision: 24, scale: 8 }).notNull(), // expected, buffer included
    assetUsdRate: numeric("asset_usd_rate", { precision: 14, scale: 2 }).notNull(), // BNB/USD locked at creation
    address: varchar("address", { length: 96 }).notNull(), // receiving address at creation time
    txHash: varchar("tx_hash", { length: 128 }),
    txFrom: varchar("tx_from", { length: 96 }),
    txValue: numeric("tx_value", { precision: 24, scale: 8 }),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | approved | rejected
    note: text("note"),
    adminTelegramId: bigint("admin_telegram_id", { mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    uniqueIndex("crypto_orders_tx_hash_uq").on(t.txHash),
    index("crypto_orders_status_idx").on(t.status, t.createdAt),
    index("crypto_orders_user_idx").on(t.userId, t.createdAt),
    check("crypto_orders_gop_positive", sql`${t.gopAmount} > 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type CryptoOrder = typeof cryptoOrders.$inferSelect;
