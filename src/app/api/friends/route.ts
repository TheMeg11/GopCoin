import { requireUser } from "@/lib/auth";
import { referralLinks } from "@/lib/env";
import { friendsState } from "@/lib/mine";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const { user } = await requireUser(req);
  return json({ ...(await friendsState(user)), links: referralLinks(user.referralCode) });
});
