import { asc } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getConfigWithVersion } from "@/lib/config";
import { adminTelegramId, demoMode } from "@/lib/env";
import { ApiError, json, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  broadcastAction, createBroadcast, createTask, getStats, listAudit, listBroadcasts, listClaims, listSecurity,
  listUsers, resolveSecurity, reviewClaim, runBotSetup, updateConfig, updateTask, userAction, userDetail,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug?: string[] }> };

const idOf = (s: string | undefined) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, "BAD_ID");
  return n;
};

async function dispatch(req: Request, ctx: Ctx): Promise<unknown> {
  // Server-side authorization on EVERY admin request — hiding the UI is not a security control.
  const { adminId } = await requireAdmin(req);
  if (!rateLimit(`admin:${adminId}`, 300, 60_000)) throw new ApiError(429, "RATE_LIMITED");
  const slug = (await ctx.params).slug ?? [];
  const [a, b, c] = slug;
  const m = req.method;
  const url = new URL(req.url);

  if (m === "GET") {
    if (a === "stats") return getStats();
    if (a === "users" && !b) return listUsers(url.searchParams);
    if (a === "users" && b) return userDetail(idOf(b));
    if (a === "config") return getConfigWithVersion();
    if (a === "tasks") return db.select().from(tasks).orderBy(asc(tasks.sortOrder), asc(tasks.id));
    if (a === "claims") return listClaims(url.searchParams.get("status") ?? "pending");
    if (a === "security") return listSecurity();
    if (a === "broadcasts") return listBroadcasts();
    if (a === "audit") return listAudit();
    if (a === "env")
      return {
        demoMode: demoMode(),
        botConfigured: !!process.env.BOT_TOKEN,
        webAppUrl: process.env.WEBAPP_URL ?? null,
        botUsername: process.env.BOT_USERNAME ?? null,
        adminIdConfigured: !!process.env.TELEGRAM_ADMIN_ID,
        adminId: String(adminTelegramId()),
      };
  }
  if (m === "POST" || m === "PUT") {
    const body = await readJson(req);
    if (a === "users" && b && c === "action") return userAction(adminId, idOf(b), body);
    if (a === "config" && m === "PUT") return updateConfig(adminId, body);
    if (a === "tasks" && !b) return createTask(adminId, body);
    if (a === "tasks" && b) return updateTask(adminId, idOf(b), body);
    if (a === "claims" && b) return reviewClaim(adminId, idOf(b), body);
    if (a === "security" && b) return resolveSecurity(adminId, idOf(b));
    if (a === "broadcasts" && !b) return createBroadcast(adminId, body);
    if (a === "broadcasts" && b && c) return broadcastAction(adminId, idOf(b), c);
    if (a === "bot" && b === "setup") return runBotSetup(adminId);
  }
  throw new ApiError(404, "NOT_FOUND");
}

const handler = route(async (req: Request, ctx: Ctx) => json(await dispatch(req, ctx)));
export const GET = handler;
export const POST = handler;
export const PUT = handler;
