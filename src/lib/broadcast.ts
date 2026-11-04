import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { broadcastDeliveries, broadcasts, users } from "@/db/schema";
import { tgApi } from "@/lib/telegram";
import { webAppUrl } from "@/lib/env";

/** Snapshot recipients into delivery rows (unique per broadcast+user → no duplicates ever). */
export async function queueBroadcast(id: number) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(broadcasts).where(eq(broadcasts.id, id)).for("update");
    if (!b || b.status !== "draft") throw new Error("Broadcast is not a draft");
    const conds = [eq(users.canMessage, true), eq(users.botBlocked, false), ne(users.status, "banned")];
    if (b.segment === "active7d") conds.push(gte(users.lastSeenAt, new Date(Date.now() - 7 * 86400_000)));
    if (b.segment === "level5") conds.push(gte(users.level, 5));
    await tx.execute(sql`
      INSERT INTO broadcast_deliveries (broadcast_id, user_id, status)
      SELECT ${id}, id, 'pending' FROM users WHERE ${and(...conds)}
      ON CONFLICT DO NOTHING`);
    const [{ c }] = await tx.select({ c: sql<number>`count(*)::int` }).from(broadcastDeliveries).where(eq(broadcastDeliveries.broadcastId, id));
    await tx.update(broadcasts).set({ status: c > 0 ? "queued" : "completed", total: c, completedAt: c > 0 ? null : new Date() }).where(eq(broadcasts.id, id));
    return c;
  });
}

let running = false;

/**
 * Controlled sender: ≤25 msgs per tick (Telegram allows ~30/s). Rows are claimed with
 * FOR UPDATE SKIP LOCKED and marked 'sending' before the API call, so restarts or parallel
 * instances never re-send a message (at-most-once delivery).
 */
export async function processBroadcastTick(maxPerTick = 25): Promise<number> {
  if (running || !process.env.BOT_TOKEN) return 0;
  running = true;
  try {
    await sweepStuckDeliveries();
    const [b] = await db
      .select()
      .from(broadcasts)
      .where(and(eq(broadcasts.status, "queued"), or(isNull(broadcasts.scheduledAt), lte(broadcasts.scheduledAt, new Date()))))
      .orderBy(broadcasts.id)
      .limit(1);
    if (!b) return 0;
    const claimed = await db.execute<{ id: number; telegram_id: string }>(sql`
      UPDATE broadcast_deliveries d SET status='sending', error=${"claimed:" + new Date().toISOString()}
      FROM users u
      WHERE d.id IN (SELECT id FROM broadcast_deliveries WHERE broadcast_id=${b.id} AND status='pending' ORDER BY id LIMIT ${maxPerTick} FOR UPDATE SKIP LOCKED)
        AND u.id = d.user_id
      RETURNING d.id, u.telegram_id`);
    let sent = 0;
    for (const row of claimed.rows) {
      const url = webAppUrl();
      const r = await tgApi("sendMessage", {
        chat_id: Number(row.telegram_id),
        text: b.message,
        ...(b.buttonText && url ? { reply_markup: { inline_keyboard: [[{ text: b.buttonText, web_app: { url } }]] } } : {}),
      });
      if (r.ok) {
        sent++;
        await db.update(broadcastDeliveries).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(broadcastDeliveries.id, row.id));
        await db.update(broadcasts).set({ sent: sql`${broadcasts.sent} + 1` }).where(eq(broadcasts.id, b.id));
      } else if (r.error_code === 429) {
        await db.update(broadcastDeliveries).set({ status: "pending", error: null }).where(eq(broadcastDeliveries.id, row.id));
        break;
      } else {
        await db.update(broadcastDeliveries).set({ status: "failed", error: (r.description ?? "error").slice(0, 300) }).where(eq(broadcastDeliveries.id, row.id));
        await db.update(broadcasts).set({ failed: sql`${broadcasts.failed} + 1` }).where(eq(broadcasts.id, b.id));
        if (r.error_code === 403) {
          await db.execute(sql`UPDATE users SET bot_blocked=true FROM broadcast_deliveries d WHERE d.id=${row.id} AND users.id=d.user_id`);
        }
      }
      await new Promise((res) => setTimeout(res, 45));
    }
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(broadcastDeliveries)
      .where(and(eq(broadcastDeliveries.broadcastId, b.id), inArray(broadcastDeliveries.status, ["pending", "sending"])));
    if (c === 0) await db.update(broadcasts).set({ status: "completed", completedAt: new Date() }).where(eq(broadcasts.id, b.id));
    return sent;
  } finally {
    running = false;
  }
}

/** Rows left in 'sending' for >10 minutes (process died mid-send) are closed as failed, never retried. */
export async function sweepStuckDeliveries() {
  await db.execute(sql`WITH stuck AS (
      UPDATE broadcast_deliveries SET status='failed', error='interrupted (not retried to avoid duplicates)'
      WHERE status='sending' AND error LIKE 'claimed:%' AND substring(error from 9)::timestamptz < now() - interval '10 minutes'
      RETURNING broadcast_id)
    UPDATE broadcasts b SET failed = b.failed + s.c FROM (SELECT broadcast_id, count(*)::int c FROM stuck GROUP BY broadcast_id) s WHERE b.id = s.broadcast_id`);
}
