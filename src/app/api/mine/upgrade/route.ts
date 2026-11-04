import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { buildMineState } from "@/lib/mine";
import { purchaseUpgrade } from "@/lib/shop";
import { ApiError, json, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/risk";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ kind: z.enum(["speed", "limit"]) });

/** Buy a mine upgrade in the goblin menu. Price is resolved server-side; coins are burned. */
export const POST = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const cfg = await getConfig();
  if (!cfg.features.shop) throw new ApiError(403, "SHOP_DISABLED", "The shop is closed right now");
  if (!rateLimit(`upgrade:${user.id}`, 10, 60_000)) {
    await recordSecurityEvent({ userId: user.id, type: "rate_limited", flagThreshold: cfg.risk.flagThreshold });
    throw new ApiError(429, "RATE_LIMITED", "Slow down a little!");
  }
  const { kind } = bodySchema.parse(await readJson(req, 512));
  const r = await purchaseUpgrade({ userId: user.id, kind, cfg });
  const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  return json({ ...r, state: buildMineState(fresh, cfg) });
});
