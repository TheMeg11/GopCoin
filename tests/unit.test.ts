import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, configSchema } from "@/lib/config";
import { accrualPreview, buildMineState, checkinXpBucket, dailyLimitMilli, speedMilliPerHour, MILLI } from "@/lib/mine";
import { expectedAssetAmount, upgradeView } from "@/lib/shop";
import type { User } from "@/db/schema";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function makeUser(over: Partial<User> = {}): User {
  const now = new Date("2026-01-10T12:00:00Z");
  return {
    id: 1, telegramId: 100, firstName: "T", lastName: null, username: null, photoUrl: null, languageCode: null,
    referralCode: "ABCDEFGH", referredById: null, balance: 0, lifetimeEarned: 0, mineEarned: 0, referralEarned: 0,
    purchaseEarned: 0, collectedCount: 0, xp: 0, level: 1, referralCount: 0, mineSpeedTier: 0, mineLimitTier: 0,
    mineLastActiveAt: new Date(now.getTime() - HOUR), lastSettledAt: new Date(now.getTime() - HOUR),
    dailyMined: 0, dailyMinedDay: "2026-01-10", status: "active", suspendedUntil: null, statusReason: null,
    flagged: false, riskScore: 0, canMessage: false, botBlocked: false, adminNote: null,
    createdAt: now, lastSeenAt: now, ...over,
  } as User;
}

describe("config", () => {
  it("default config validates", () => {
    expect(configSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });
  it("rejects non-increasing tiers", () => {
    const bad = structuredClone(DEFAULT_CONFIG) as typeof DEFAULT_CONFIG;
    bad.mine.speedTiers = [1, 1, 2, 4, 8, 16, 32];
    expect(configSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects wrong price-array length", () => {
    const bad = structuredClone(DEFAULT_CONFIG) as typeof DEFAULT_CONFIG;
    bad.mine.speedPrices = [1, 2];
    expect(configSchema.safeParse(bad).success).toBe(false);
  });
  it("v3 economy: mine runs 24/7 and the cap ladder is the binding constraint", () => {
    expect(DEFAULT_CONFIG.mine.shutdownHours).toBe(0);
    // cap tier i must be >= speed tier i × 24h so the matching speed upgrade can pay off
    DEFAULT_CONFIG.mine.speedTiers.forEach((s, i) => {
      expect(DEFAULT_CONFIG.mine.limitTiers[i]).toBeGreaterThanOrEqual(s * 24);
    });
  });
});

describe("mining math (v3: 24/7 mine)", () => {
  const cfg = DEFAULT_CONFIG;

  it("base speed is 0.5 GOP/h = 500 milli/h; base cap is 12 GOP/day", () => {
    expect(speedMilliPerHour(cfg, 0)).toBe(500);
    expect(dailyLimitMilli(cfg, 0)).toBe(12_000);
  });

  it("accrues 500 milli-GOP after exactly one hour with mine on", () => {
    const u = makeUser({ mineLastActiveAt: new Date("2026-01-10T12:00:00Z"), lastSettledAt: new Date("2026-01-10T12:00:00Z") });
    const p = accrualPreview(u, cfg, new Date("2026-01-10T13:00:00Z"));
    expect(p.on).toBe(true);
    expect(p.pendingMilli).toBe(500);
  });

  it("keeps producing far beyond the old 6h window (no mandatory check-in)", () => {
    const u = makeUser({ mineLastActiveAt: new Date("2026-01-09T12:00:00Z"), lastSettledAt: new Date("2026-01-09T12:00:00Z") });
    const p = accrualPreview(u, cfg, new Date("2026-01-10T12:00:00Z")); // 24h later
    expect(p.on).toBe(true);
    // 24h × 0.5 GOP/h = 12 GOP, clamped exactly to the 12 GOP daily cap
    expect(p.pendingMilli).toBe(12_000);
    expect(p.raw).toBeGreaterThanOrEqual(p.pendingMilli);
  });

  it("hard-stops at the daily cap even with a 24/7 mine", () => {
    const u = makeUser({ dailyMined: 11_500, dailyMinedDay: "2026-01-10" });
    const p = accrualPreview(u, cfg, new Date("2026-01-10T20:00:00Z"));
    expect(p.pendingMilli).toBe(500); // only 0.5 GOP room left
    const state = buildMineState(u, cfg);
    expect(state.quotaFull).toBe(true);
  });

  it("resets the daily counter on a new UTC day", () => {
    const u = makeUser({ dailyMined: 12_000, dailyMinedDay: "2026-01-09", mineLastActiveAt: new Date("2026-01-10T12:00:00Z"), lastSettledAt: new Date("2026-01-10T12:00:00Z") });
    const p = accrualPreview(u, cfg, new Date("2026-01-10T13:00:00Z"));
    expect(p.minedToday).toBe(0);
    expect(p.pendingMilli).toBe(500);
  });

  it("respects the shutdown window when the admin re-enables one", () => {
    const cfg6 = { ...structuredClone(cfg), mine: { ...cfg.mine, shutdownHours: 6 } };
    const u = makeUser({ mineLastActiveAt: new Date("2026-01-10T12:00:00Z"), lastSettledAt: new Date("2026-01-10T12:00:00Z") });
    const p = accrualPreview(u, cfg6, new Date("2026-01-10T19:30:00Z")); // 7.5h later
    expect(p.on).toBe(false);
    expect(p.pendingMilli).toBe(3_000); // only the first 6h are paid
    const state = buildMineState(u, cfg6, new Date("2026-01-10T13:00:00Z"));
    expect(state.shutdownInMs).not.toBeNull();
    // 24/7 mine exposes no shutdown timer
    expect(buildMineState(u, cfg).shutdownInMs).toBeNull();
  });

  it("caps production cross-tier: high speed + low cap earns only the cap", () => {
    // speed tier 1 (1 GOP/h = 24 GOP/day potential) but cap tier 0 (12 GOP/day)
    const u = makeUser({ mineSpeedTier: 1, mineLastActiveAt: new Date("2026-01-10T00:00:00Z"), lastSettledAt: new Date("2026-01-10T00:00:00Z") });
    const p = accrualPreview(u, cfg, new Date("2026-01-10T20:00:00Z"));
    expect(p.raw).toBe(20_000); // 20h × 1000 milli
    expect(p.pendingMilli).toBe(12_000); // clamped to the 12 GOP cap
  });

  it("state exposes tier info and pending decimals", () => {
    const u = makeUser({ mineSpeedTier: 2, mineLimitTier: 2, mineLastActiveAt: new Date("2026-01-10T12:00:00Z"), lastSettledAt: new Date("2026-01-10T12:00:00Z") });
    const state = buildMineState(u, cfg, new Date("2026-01-10T12:30:00Z"));
    expect(state.speedGop).toBe(2);
    expect(state.dailyLimit).toBe(48);
    expect(state.pendingGop).toBeCloseTo(1, 5); // 30 min × 2 GOP/h
    expect(state.maxSpeedTier).toBe(6);
  });
});

describe("XP anti-farm", () => {
  it("buckets check-in XP so spam cannot level accounts", () => {
    const t0 = new Date("2026-01-10T05:59:59Z");
    const t1 = new Date("2026-01-10T06:00:00Z");
    expect(checkinXpBucket(t0)).toBe(checkinXpBucket(new Date("2026-01-10T00:00:00Z")));
    expect(checkinXpBucket(t1)).toBe(checkinXpBucket(t0) + 1);
    // max grants per day with a 6h bucket = 4
    const day = new Date("2026-01-10T00:00:01Z").getTime();
    const buckets = new Set<number>();
    for (let i = 0; i < 1000; i++) buckets.add(checkinXpBucket(new Date(day + i * 60_000)));
    expect(buckets.size).toBeLessThanOrEqual(5);
  });
});

describe("upgrade ordering (capacity unlocks speed)", () => {
  const cfg = DEFAULT_CONFIG;

  it("blocks speed upgrades until the matching capacity tier is owned", () => {
    const u = makeUser({ mineSpeedTier: 0, mineLimitTier: 0 });
    const v = upgradeView(u, cfg, "speed");
    expect(v.purchasable).toBe(false);
    expect(v.lockedReason).toMatch(/capacity first/i);
  });

  it("allows speed once capacity is ahead", () => {
    const u = makeUser({ mineSpeedTier: 0, mineLimitTier: 1 });
    expect(upgradeView(u, cfg, "speed").purchasable).toBe(true);
  });

  it("capacity is always purchasable while not maxed", () => {
    expect(upgradeView(makeUser({ mineLimitTier: 0 }), cfg, "limit").purchasable).toBe(true);
    expect(upgradeView(makeUser({ mineLimitTier: 6 }), cfg, "limit").purchasable).toBe(false);
  });

  it("maxed ladders expose no price", () => {
    expect(upgradeView(makeUser({ mineSpeedTier: 6, mineLimitTier: 6 }), cfg, "speed").price).toBeNull();
  });
});

describe("economy invariants (30/90/180-day supply bounds)", () => {
  const cfg = DEFAULT_CONFIG;

  it("payback of a (speed+capacity) pair stays inside the 8–13 day band", () => {
    for (let i = 0; i < cfg.mine.speedPrices.length; i++) {
      const pair = cfg.mine.speedPrices[i] + cfg.mine.limitPrices[i];
      const gainPerDay = (cfg.mine.speedTiers[i + 1] - cfg.mine.speedTiers[i]) * 24;
      const payback = pair / gainPerDay;
      expect(payback).toBeGreaterThanOrEqual(8);
      expect(payback).toBeLessThanOrEqual(13.5);
    }
  });

  it("per-user mining income is hard-bounded at every tier combination", () => {
    const maxPerDay = Math.max(
      ...cfg.mine.speedTiers.flatMap((s, si) => cfg.mine.limitTiers.map((c, ci) => Math.min(s * 24, c))),
    );
    expect(maxPerDay).toBe(768); // 32 GOP/h × 24h, cap 768
    // 180-day simulation for the most dedicated free player (24/7 online, no misses)
    let mined = 0;
    for (let d = 0; d < 180; d++) mined += maxPerDay;
    expect(mined).toBe(768 * 180); // ≤ 138,240 GOP over 6 months — scarce by design
    expect(mined * 0.01).toBeCloseTo(1382.4, 1); // anchor value of the theoretical max
  });

  it("total burn to max both ladders is a real sink", () => {
    const burn = cfg.mine.speedPrices.reduce((a, b) => a + b, 0) + cfg.mine.limitPrices.reduce((a, b) => a + b, 0);
    expect(burn).toBe(9150);
  });
});

describe("crypto pricing", () => {
  const cfg = DEFAULT_CONFIG;
  it("applies the buffer to the expected amount", () => {
    // $11 / 600 * 1.03 = 0.01888333… → rounded 8dp
    expect(expectedAssetAmount(cfg.payments.crypto.packages[0], cfg)).toBeCloseTo(11 / 600 * 1.03, 6);
  });
  it("keeps every package priced at or above the $0.01 anchor", () => {
    for (const p of cfg.payments.crypto.packages) {
      expect(p.usd / p.gop).toBeGreaterThanOrEqual(0.011);
    }
    for (const p of cfg.payments.stars.packages) {
      // Telegram Stars ≈ $0.013 → effective $/GOP must stay above the anchor even after bulk discounts
      expect((p.stars * 0.013) / p.gop).toBeGreaterThanOrEqual(0.01);
    }
  });
});

describe("milli arithmetic", () => {
  it("1 GOP = 1000 milli", () => {
    expect(MILLI).toBe(1000);
  });
});
