import { requireUser } from "@/lib/auth";
import { isAdminTelegramId, referralLinks } from "@/lib/env";
import { buildMeState } from "@/lib/mine";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const state = await buildMeState(user, isAdminTelegramId(user.telegramId));
  return json({ ...state, links: referralLinks(user.referralCode) });
});
