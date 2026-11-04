import { z } from "zod";
import { DEMO_ADMIN_ID, adminTelegramId, demoMode } from "@/lib/env";
import { ApiError, json, readJson, route } from "@/lib/http";
import { ipSignal, rateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import { parseReferralParam } from "@/lib/telegram";
import { upsertTelegramUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Preview-only login for running outside Telegram. Hard-disabled whenever BOT_TOKEN is set. */
export const POST = route(async (req: Request) => {
  if (!demoMode()) throw new ApiError(404, "NOT_FOUND");
  if (!rateLimit(`demo:${ipSignal(req)}`, 20, 60_000)) throw new ApiError(429, "RATE_LIMITED");
  const b = z
    .object({ as: z.enum(["player", "admin"]).default("player"), demoId: z.number().int().min(1_000_000_000).max(8_999_999_999).optional(), startParam: z.string().max(64).optional() })
    .parse(await readJson(req));
  const id = b.as === "admin" ? (adminTelegramId() ?? DEMO_ADMIN_ID) : b.demoId ?? 1_000_000_000 + Math.floor(Math.random() * 1e9);
  const { user } = await upsertTelegramUser({
    tg: { id, first_name: b.as === "admin" ? "Admin Goblin" : "Demo Goblin", last_name: b.as === "admin" ? undefined : String(id).slice(-4), username: undefined },
    referralCode: parseReferralParam(b.startParam),
    source: "miniapp",
  });
  const s = createSession(user.id, user.telegramId);
  return json({ token: s.token, exp: s.exp, demoId: id });
});

export const GET = route(async () => json({ demo: demoMode() }));
