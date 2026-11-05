import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { gameConfig, tasks } from "@/db/schema";
import { DEFAULT_LEVELS, DEFAULT_STAGES } from "@/lib/progression";

const int = (min: number, max: number) => z.number().int().min(min).max(max);
/** Speeds in GOP/hour (up to 2 decimals). Prices/caps are whole GOP. */
const speed = z.number().min(0.01).max(100_000);
const whole = int(0, 2_000_000_000);

export const levelSchema = z.object({ level: int(1, 1000), xp: int(0, 1_000_000_000), title: z.string().trim().min(1).max(40) });
export const stageSchema = z.object({
  name: z.string().trim().min(1).max(40),
  minLevel: int(1, 1000),
  image: z.string().trim().min(1).max(300),
  description: z.string().trim().max(200),
});

const optUrl = z.union([z.literal(""), z.string().trim().url().max(300)]);

export const starsPackageSchema = z.object({ id: z.string().trim().regex(/^[a-z0-9_]{1,24}$/), gop: int(1, 2_000_000_000), stars: int(1, 100_000) });
export const cryptoPackageSchema = z.object({ id: z.string().trim().regex(/^[a-z0-9_]{1,24}$/), gop: int(1, 2_000_000_000), usd: z.number().min(0.5).max(1_000_000) });

export const configSchema = z
  .object({
    mine: z.object({
      enabled: z.boolean(),
      /** Hours a mine keeps running after the last check-in. 0 = runs 24/7 (no shutdown). */
      shutdownHours: z.number().min(0).max(72),
      /** GOP/hour per tier. Tier 0 is the starting speed. Max 12 tiers. */
      speedTiers: z.array(speed).min(1).max(12),
      /** Burn price (GOP) to move from tier i to i+1; length = speedTiers.length - 1. */
      speedPrices: z.array(whole).max(11),
      /** Daily mining cap (GOP) per tier; tier 0 is the starting cap. */
      limitTiers: z.array(whole).min(1).max(12),
      /** Burn price (GOP) to move from tier i to i+1; length = limitTiers.length - 1. */
      limitPrices: z.array(whole).max(11),
    }),
    referral: z.object({
      enabled: z.boolean(),
      inviterReward: int(0, 1_000_000),
      inviteeReward: int(0, 1_000_000),
      /** Activated referrals require this many check-ins by the invitee (anti-farm gate). */
      activationCheckins: int(1, 1000),
      maxNewReferralsPerHour: int(1, 100_000),
      campaignNote: z.string().max(300),
    }),
    xp: z.object({ perCheckin: int(0, 100_000), perReferral: int(0, 1_000_000), perWelcome: int(0, 1_000_000) }),
    progression: z.object({ levels: z.array(levelSchema).min(2).max(500), stages: z.array(stageSchema).min(1).max(50) }),
    risk: z.object({ flagThreshold: int(1, 100_000) }),
    features: z.object({ tasks: z.boolean(), leaderboard: z.boolean(), shop: z.boolean() }),
    payments: z.object({
      stars: z.object({
        enabled: z.boolean(),
        /** Whole GOP received per Star paid. 1 = 1 GOP ≈ $0.01. */
        gopPerStar: z.number().min(0.01).max(10_000),
        packages: z.array(starsPackageSchema).min(0).max(24),
      }),
      crypto: z.object({
        enabled: z.boolean(),
        network: z.string().trim().min(1).max(60),
        assetSymbol: z.string().trim().min(1).max(12),
        address: z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a 0x EVM address"),
        /** GOP price used for crypto orders (USD). Slightly above the $0.01 anchor. */
        usdPerGop: z.number().min(0.000001).max(1000),
        /** Admin-tunable BNB/USD reference used to compute expected amounts. */
        bnbUsd: z.number().min(0.01).max(1_000_000),
        /** Extra % added on top of the expected amount to absorb price movement between order and payment. */
        bufferPercent: z.number().min(0).max(25),
        packages: z.array(cryptoPackageSchema).min(0).max(24),
      }),
    }),
    community: z.object({ channelUrl: optUrl, chatUrl: optUrl, websiteUrl: optUrl }),
    announcement: z.object({
      text: z.string().max(500),
      maintenance: z.boolean(),
      maintenanceMessage: z.string().max(500),
    }),
  })
  .superRefine((c, ctx) => {
    const lv = c.progression.levels;
    lv.forEach((l, i) => {
      if (l.level !== i + 1) ctx.addIssue({ code: "custom", path: ["progression", "levels", i], message: "Levels must be consecutive starting at 1" });
      if (i === 0 && l.xp !== 0) ctx.addIssue({ code: "custom", path: ["progression", "levels", 0], message: "Level 1 must require 0 XP" });
      if (i > 0 && l.xp <= lv[i - 1].xp) ctx.addIssue({ code: "custom", path: ["progression", "levels", i], message: "XP thresholds must strictly increase" });
    });
    const st = c.progression.stages;
    if (st[0]?.minLevel !== 1) ctx.addIssue({ code: "custom", path: ["progression", "stages", 0], message: "First stage must start at level 1" });
    st.forEach((s, i) => {
      if (i > 0 && s.minLevel <= st[i - 1].minLevel) ctx.addIssue({ code: "custom", path: ["progression", "stages", i], message: "Stage levels must strictly increase" });
    });
    // Tier economics: strictly increasing tiers, one price per transition.
    const sp = c.mine.speedTiers;
    sp.forEach((v, i) => {
      if (i > 0 && v <= sp[i - 1]) ctx.addIssue({ code: "custom", path: ["mine", "speedTiers", i], message: "Speed tiers must strictly increase" });
    });
    if (c.mine.speedPrices.length !== sp.length - 1)
      ctx.addIssue({ code: "custom", path: ["mine", "speedPrices"], message: "speedPrices must have exactly speedTiers.length - 1 entries" });
    const lt = c.mine.limitTiers;
    lt.forEach((v, i) => {
      if (i > 0 && v <= lt[i - 1]) ctx.addIssue({ code: "custom", path: ["mine", "limitTiers", i], message: "Limit tiers must strictly increase" });
    });
    if (c.mine.limitPrices.length !== lt.length - 1)
      ctx.addIssue({ code: "custom", path: ["mine", "limitPrices"], message: "limitPrices must have exactly limitTiers.length - 1 entries" });
  });

export type GameConfig = z.infer<typeof configSchema>;

/**
 * DEFAULT economy — v3, derived from ECONOMY.md (1 GOP ≈ 1 ⭐ ≈ $0.01 anchor).
 *
 * v3 changes (audited + simulated over 30/90/180 days, see ECONOMY.md §2–3):
 * - shutdownHours 0: the mine runs 24/7 — no more mandatory 6h check-in.
 * - Daily-cap ladder is BINDING: cap tier i = speed tier i × 24h, so capacity
 *   upgrades genuinely gate income and must precede the matching speed upgrade.
 * - Prices rebalanced so the payback of a (speed+capacity) pair stays in the
 *   classic idle-game band of 8–13 days of the EXTRA production it unlocks.
 */
export const DEFAULT_CONFIG: GameConfig = {
  mine: {
    enabled: true,
    shutdownHours: 0, // 0 = mine runs 24/7 — collecting is optional, never a race against a timer
    speedTiers: [0.5, 1, 2, 4, 8, 16, 32],
    speedPrices: [60, 130, 280, 600, 1300, 2800],
    limitTiers: [12, 24, 48, 96, 192, 384, 768],
    limitPrices: [40, 90, 200, 450, 1000, 2200],
  },
  referral: { enabled: true, inviterReward: 50, inviteeReward: 25, activationCheckins: 1, maxNewReferralsPerHour: 30, campaignNote: "" },
  xp: { perCheckin: 15, perReferral: 200, perWelcome: 0 },
  progression: { levels: DEFAULT_LEVELS, stages: DEFAULT_STAGES },
  risk: { flagThreshold: 40 },
  features: { tasks: true, leaderboard: true, shop: true },
  payments: {
    stars: {
      enabled: true,
      gopPerStar: 1,
      packages: [
        { id: "s50", gop: 50, stars: 50 },
        { id: "s150", gop: 150, stars: 145 },
        { id: "s500", gop: 500, stars: 470 },
        { id: "s1500", gop: 1500, stars: 1350 },
        { id: "s5000", gop: 5000, stars: 4300 },
      ],
    },
    crypto: {
      enabled: true,
      network: "BNB Smart Chain (BEP-20)",
      assetSymbol: "BNB",
      address: "0x812Dfa18C02905D7011FbCB09120E68De1f07AA3",
      // v3 audit: bulk packs used to dip BELOW the anchor ($0.009–0.0095/GOP); all packages
      // now hold the $0.011 crypto price point so buying never undercuts the coin's value.
      usdPerGop: 0.011,
      bnbUsd: 600,
      bufferPercent: 3,
      packages: [
        { id: "c1000", gop: 1000, usd: 11 },
        { id: "c3000", gop: 3000, usd: 33 },
        { id: "c10000", gop: 10000, usd: 110 },
        { id: "c30000", gop: 30000, usd: 330 },
      ],
    },
  },
  community: { channelUrl: "https://t.me/GOPCOININFO", chatUrl: "", websiteUrl: "" },
  announcement: { text: "", maintenance: false, maintenanceMessage: "Gop Coin is under maintenance. Mining is paused for a few minutes." },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge stored values over defaults so newly added settings get sane defaults. */
export function mergeConfig(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? mergeConfig(base[k], v) : v;
  return out;
}

/** First boot only: server-verifiable tasks (channel membership checked via getChatMember). */
async function seedDefaultTasks() {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(tasks);
  if (c > 0) return;
  await db.insert(tasks).values([
    { title: "Join the official GOP Coin channel", description: "News, events and listing updates are posted here first.", type: "telegram_channel", verification: "telegram_member", url: "https://t.me/GOPCOININFO", chatId: "@GOPCOININFO", reward: 25, sortOrder: 1 },
    { title: "Run your first check-in", description: "Press ⛏ Check in once and collect your first mined coins.", type: "ingame", verification: "auto", requirementKind: "checkins", requirementValue: 1, reward: 25, sortOrder: 2 },
    { title: "Invite your first friend", description: "One activated referral (friend makes one check-in).", type: "ingame", verification: "auto", requirementKind: "referrals", requirementValue: 1, reward: 50, sortOrder: 3 },
    { title: "Evolve into a Young Goblin", description: "Reach level 5.", type: "ingame", verification: "auto", requirementKind: "level", requirementValue: 5, reward: 100, sortOrder: 4 },
    { title: "Reach level 10", description: "A true Cave Goblin.", type: "ingame", verification: "auto", requirementKind: "level", requirementValue: 10, reward: 250, sortOrder: 5 },
  ]);
}

let cache: { at: number; version: number; value: GameConfig } | null = null;
const CACHE_MS = 10_000; // short TTL keeps instances consistent; one DB read / 10 s max

export async function getConfig(fresh = false): Promise<GameConfig> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await db.select().from(gameConfig).where(eq(gameConfig.key, "main")).limit(1);
  let value: GameConfig = DEFAULT_CONFIG;
  let version = 0;
  if (rows.length === 0) {
    const ins = await db.insert(gameConfig).values({ key: "main", value: DEFAULT_CONFIG, version: 1 }).onConflictDoNothing().returning({ key: gameConfig.key });
    if (ins.length) await seedDefaultTasks();
  } else {
    version = rows[0].version;
    const parsed = configSchema.safeParse(mergeConfig(DEFAULT_CONFIG, rows[0].value));
    if (parsed.success) value = parsed.data;
    else console.error("[config] stored config invalid, using defaults", parsed.error.issues.slice(0, 3));
  }
  cache = { at: Date.now(), version, value };
  return value;
}

export async function getConfigWithVersion(): Promise<{ value: GameConfig; version: number }> {
  const value = await getConfig(true);
  return { value, version: cache?.version ?? 0 };
}

/** Transactional, optimistic-concurrency config save. */
export async function saveConfig(next: unknown, expectedVersion: number, adminTelegramId: number): Promise<GameConfig> {
  const parsed = configSchema.parse(next);
  const res = await db
    .insert(gameConfig)
    .values({ key: "main", value: parsed, version: 1, updatedBy: adminTelegramId })
    .onConflictDoUpdate({
      target: gameConfig.key,
      set: { value: parsed, version: sql`${gameConfig.version} + 1`, updatedAt: new Date(), updatedBy: adminTelegramId },
      where: sql`${gameConfig.version} = ${expectedVersion}`,
    })
    .returning({ version: gameConfig.version });
  if (res.length === 0) throw new Error("CONFIG_CONFLICT");
  cache = null;
  return parsed;
}
