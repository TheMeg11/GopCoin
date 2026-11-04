import { z } from "zod";
import { getConfig } from "@/lib/config";
import { initDataMaxAgeSec } from "@/lib/env";
import { ApiError, json, readJson, route } from "@/lib/http";
import { ipSignal, rateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/risk";
import { createSession } from "@/lib/session";
import { InitDataError, parseReferralParam, validateInitData } from "@/lib/telegram";
import { upsertTelegramUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Exchanges Telegram-signed initData for a server session. initDataUnsafe is never trusted. */
export const POST = route(async (req: Request) => {
  const ip = ipSignal(req);
  if (!rateLimit(`auth:${ip}`, 30, 60_000)) throw new ApiError(429, "RATE_LIMITED", "Too many attempts, slow down");
  const { initData } = z.object({ initData: z.string().min(1).max(8192) }).parse(await readJson(req));
  const token = process.env.BOT_TOKEN;
  if (!token) throw new ApiError(503, "BOT_NOT_CONFIGURED", "BOT_TOKEN is not configured on the server");
  let v;
  try {
    v = validateInitData(initData, token, initDataMaxAgeSec());
  } catch (e) {
    if (e instanceof InitDataError) {
      const cfg = await getConfig();
      await recordSecurityEvent({ userId: null, type: "invalid_init_data", details: { reason: e.message, net: ip }, flagThreshold: cfg.risk.flagThreshold });
      throw new ApiError(401, "INVALID_INIT_DATA", "Telegram authentication failed. Please reopen the app from Telegram.");
    }
    throw e;
  }
  const { user, created } = await upsertTelegramUser({
    tg: v.user,
    referralCode: parseReferralParam(v.startParam),
    source: "miniapp",
    canMessage: v.user.allows_write_to_pm === true,
  });
  const s = createSession(user.id, user.telegramId);
  return json({ token: s.token, exp: s.exp, created });
});
