import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { isAdminTelegramId } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { recordSecurityEvent } from "@/lib/risk";
import { verifySession, type SessionPayload } from "@/lib/session";

/** Resolve the caller strictly from the signed session token. Client-supplied ids are never trusted. */
export async function requireUser(req: Request): Promise<{ user: User; session: SessionPayload }> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const session = verifySession(token);
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Session expired — please reopen the app");
  const [user] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  if (!user || user.telegramId !== session.tid) throw new ApiError(401, "UNAUTHENTICATED");
  if (Date.now() - user.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  }
  return { user, session };
}

/** Admin = authenticated Telegram id equals TELEGRAM_ADMIN_ID. Nothing else grants access. */
export async function requireAdmin(req: Request): Promise<{ user: User; adminId: number }> {
  const { user } = await requireUser(req);
  if (!isAdminTelegramId(user.telegramId)) {
    const cfg = await getConfig();
    await recordSecurityEvent({ userId: user.id, type: "admin_access_denied", details: { path: new URL(req.url).pathname }, flagThreshold: cfg.risk.flagThreshold });
    throw new ApiError(403, "FORBIDDEN");
  }
  return { user, adminId: user.telegramId };
}
