import { randomBytes } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { referrals, users, type User } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { recordSecurityEvent } from "@/lib/risk";
import type { TelegramUser } from "@/lib/telegram";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

export function generateReferralCode(len = 8): string {
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % 32];
  return s;
}

export function displayName(u: Pick<User, "firstName" | "lastName" | "username">): string {
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || (u.username ? `@${u.username}` : "Goblin");
}

/** Public leaderboard/friends representation: no Telegram id, no username unless needed. */
export function publicProfile(u: Pick<User, "id" | "firstName" | "lastName" | "username" | "photoUrl" | "level">) {
  return { id: u.id, name: displayName(u), photoUrl: u.photoUrl, level: u.level };
}

export function effectiveStatus(u: Pick<User, "status" | "suspendedUntil">): "active" | "suspended" | "banned" {
  if (u.status === "banned") return "banned";
  if (u.status === "suspended") {
    if (u.suspendedUntil && u.suspendedUntil.getTime() <= Date.now()) return "active";
    return "suspended";
  }
  return "active";
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/**
 * Find or register a Telegram user. Referral attribution happens ONLY at first registration,
 * from a server-verified source (signed initData start_param or an authenticated bot webhook).
 * Existing users can never change inviter.
 */
export async function upsertTelegramUser(o: {
  tg: TelegramUser;
  referralCode: string | null;
  source: "miniapp" | "bot";
  canMessage?: boolean;
}): Promise<{ user: User; created: boolean }> {
  const profile = {
    firstName: (o.tg.first_name ?? "").slice(0, 128),
    lastName: o.tg.last_name?.slice(0, 128) ?? null,
    username: o.tg.username?.slice(0, 64) ?? null,
    languageCode: o.tg.language_code?.slice(0, 16) ?? null,
    ...(o.tg.photo_url ? { photoUrl: o.tg.photo_url.slice(0, 500) } : {}),
  };
  const existing = await db.select().from(users).where(eq(users.telegramId, o.tg.id)).limit(1);
  if (existing.length) {
    const u = existing[0];
    const cfg = await getConfig();
    if (o.referralCode && o.referralCode === u.referralCode) {
      await recordSecurityEvent({ userId: u.id, type: "self_referral_attempt", flagThreshold: cfg.risk.flagThreshold });
    }
    const [updated] = await db
      .update(users)
      .set({ ...profile, lastSeenAt: new Date(), ...(o.canMessage ? { canMessage: true, botBlocked: false } : {}) })
      .where(eq(users.id, u.id))
      .returning();
    return { user: updated, created: false };
  }

  const cfg = await getConfig();
  let inviter: User | null = null;
  if (o.referralCode && cfg.referral.enabled) {
    const [found] = await db.select().from(users).where(eq(users.referralCode, o.referralCode)).limit(1);
    if (found && found.telegramId !== o.tg.id && found.status !== "banned") inviter = found;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const user = await db.transaction(async (tx) => {
        const now = new Date();
        const [created] = await tx
          .insert(users)
          .values({
            telegramId: o.tg.id,
            ...profile,
            referralCode: generateReferralCode(),
            referredById: inviter?.id ?? null,
            canMessage: !!o.canMessage,
            // The mine starts running immediately at registration; the first check-in
            // within shutdownHours keeps it running.
            mineLastActiveAt: now,
            lastSettledAt: now,
          })
          .returning();
        if (inviter) {
          await tx.insert(referrals).values({ inviterId: inviter.id, inviteeId: created.id, source: o.source });
        }
        return created;
      });
      if (inviter) {
        // Abnormal referral pattern detection: burst of new invitees within one hour.
        const [{ c }] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(referrals)
          .where(and(eq(referrals.inviterId, inviter.id), gte(referrals.createdAt, new Date(Date.now() - 3600_000))));
        if (c > cfg.referral.maxNewReferralsPerHour) {
          await recordSecurityEvent({ userId: inviter.id, type: "referral_spike", details: { lastHour: c }, flagThreshold: cfg.risk.flagThreshold });
        }
      }
      return { user, created: true };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Either a referral-code collision (retry) or a concurrent registration of the same user.
      const again = await db.select().from(users).where(eq(users.telegramId, o.tg.id)).limit(1);
      if (again.length) return { user: again[0], created: false };
    }
  }
  throw new Error("Could not register user");
}
