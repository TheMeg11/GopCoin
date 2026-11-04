import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { securityEvents, users } from "@/db/schema";
import type { Exec } from "@/lib/ledger";

/** Severity points added to a user's risk score. Accounts crossing the configured threshold
 * are flagged for admin review — never auto-banned. */
export const RISK = {
  rate_limited: 2,
  invalid_payload: 1,
  self_referral_attempt: 2,
  referral_spike: 10,
  task_claim_spam: 2,
  crypto_order_spam: 2,
  invalid_init_data: 0,
  admin_access_denied: 5,
} as const;

export type RiskType = keyof typeof RISK;

const throttle = new Map<string, number>();

export async function recordSecurityEvent(
  o: { userId: number | null; type: RiskType; details?: Record<string, unknown>; flagThreshold: number },
  exec: Exec = db,
): Promise<void> {
  // Avoid log floods during an attack: at most one event per user/type per minute per instance.
  const tk = `${o.userId ?? "anon"}:${o.type}`;
  const now = Date.now();
  if ((throttle.get(tk) ?? 0) > now - 60_000) return;
  throttle.set(tk, now);
  if (throttle.size > 50_000) throttle.clear();

  const severity = RISK[o.type];
  try {
    await exec.insert(securityEvents).values({ userId: o.userId, type: o.type, severity, details: o.details ?? null });
    if (o.userId && severity > 0) {
      await exec
        .update(users)
        .set({
          riskScore: sql`${users.riskScore} + ${severity}`,
          flagged: sql`${users.flagged} OR (${users.riskScore} + ${severity} >= ${o.flagThreshold})`,
        })
        .where(eq(users.id, o.userId));
    }
  } catch (e) {
    console.error("[risk] failed to record event", e);
  }
}
