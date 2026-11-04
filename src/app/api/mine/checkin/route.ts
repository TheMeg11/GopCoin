import { requireUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { checkIn } from "@/lib/mine";
import { ApiError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/risk";

export const dynamic = "force-dynamic";

/** Check-in: settles mined coins into the balance and restarts the 6h shutdown window. */
export const POST = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const cfg = await getConfig();
  if (!rateLimit(`checkin:${user.id}`, 12, 60_000)) {
    await recordSecurityEvent({ userId: user.id, type: "rate_limited", flagThreshold: cfg.risk.flagThreshold });
    throw new ApiError(429, "RATE_LIMITED", "Slow down a little!");
  }
  const result = await checkIn({ userId: user.id, cfg });
  return json(result);
});
