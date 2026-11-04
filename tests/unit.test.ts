import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, configSchema } from "@/lib/config";
import { accrualPreview, buildMineState, speedMilliPerHour, dailyLimitMilli } from "@/lib/mine";
import { expectedAssetAmount } from "@/lib/shop";
import type { User } from "@/db/schema";

const HOUR = 3_600_000;

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
});

describe("mining math", () => {
  const cfg = DEFAULT_CONFIG;

  it("base speed is 0.5 GOP/h = 500 milli/h", () => {
    expect(speedMilliPerHour(cfg, 0)).toBe(500);
    expect(dailyLimitMilli(cfg, 0)).toBe(500_000);
  });

  it("accrues 500 milli-GOP after exactly one hour with mine on", () => {
    const u = makeUser({ mineLastActiveAt: new Date("2026-01-10T12:00:00Z"), lastSettledAt: new Date("2026-01-10T12:00:00Z") });
    const p = accrualPreview(u, cfg, new Date("2026-01-10T13:00:00Z"));
    expect(p.on).toBe(true);
    expect(p.pendingMilli).toBe(500);
  });

  it("stops accrual at the 6h shutdown deadline", () => {
    const now = new Date("2026-01-10T19:30:00Z"); // 7.5h after check-in, settled 7.5h ago
    const p = accrualPreview(makeUser(), cfg, now);
    expect(p.on).toBe(false);
    // only the first 6h are paid: 0.5 * 6 = 3 GOP
    expect(p.pendingMilli).toBe(3_000);
  });

  it("credits nothing extra after a past shutdown", () => {
    const u = makeUser({ mineLastActiveAt: new Date("2026-01-10T00:00:00Z"), lastSettledAt: new Date("2026-01-10T07:00:00Z") });
    const now = new Date("2026-01-10T20:00:00Z");
    const p = accrualPreview(u, cfg, now);
    expect(p.on).toBe(false);
    expect(p.pendingMilli).toBe(0);
  });

  it("caps production at the daily limit", () => {
    const u = makeUser({ dailyMined: 499_500, dailyMinedDay: "2026-01-10" });
    const now = new Date("2026-01-10T13:00:00Z");
    const p = accrualPreview(u, cfg, now);
    expect(p.pendingMilli).toBe(500); // only 0.5 GOP room left
    const state = buildMineState(u, cfg, now);
    expect(state.quotaFull).toBe(true);
  });

  it("resets the daily counter on a new UTC day", () => {
    const u = makeUser({ dailyMined: 500_000, dailyMinedDay: "2026-01-09", mineLastActiveAt: new Date("2026-01-10T12:00:00Z"), lastSettledAt: new Date("2026-01-10T12:00:00Z") });
    const p = accrualPreview(u, cfg, new Date("2026-01-10T13:00:00Z"));
    expect(p.minedToday).toBe(0);
    expect(p.pendingMilli).toBe(500);
  });

  it("state exposes tier info and pending decimals", () => {
    const u = makeUser({ mineSpeedTier: 2, mineLimitTier: 1, mineLastActiveAt: new Date("2026-01-10T12:00:00Z"), lastSettledAt: new Date("2026-01-10T12:00:00Z") });
    const state = buildMineState(u, cfg, new Date("2026-01-10T12:30:00Z"));
    expect(state.speedGop).toBe(2);
    expect(state.dailyLimit).toBe(1000);
    expect(state.pendingGop).toBeCloseTo(1, 5); // 30 min × 2 GOP/h
    expect(state.maxSpeedTier).toBe(6);
  });
});

describe("crypto pricing", () => {
  const cfg = DEFAULT_CONFIG;
  it("applies the buffer to the expected amount", () => {
    // $11 / 600 * 1.03 = 0.01888333… → rounded 8dp
    expect(expectedAssetAmount(cfg.payments.crypto.packages[0], cfg)).toBeCloseTo(11 / 600 * 1.03, 6);
  });
});
