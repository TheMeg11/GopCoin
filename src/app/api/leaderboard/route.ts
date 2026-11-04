import { and, asc, desc, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { MILLI } from "@/lib/mine";
import { json, route } from "@/lib/http";
import { publicProfile } from "@/lib/users";

export const dynamic = "force-dynamic";

const COLS = { coins: users.lifetimeEarned, referrals: users.referralCount, level: users.xp } as const;

export const GET = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const type = (["coins", "referrals", "level"].includes(sp.get("type") ?? "") ? sp.get("type") : "coins") as keyof typeof COLS;
  const offset = Math.min(10_000, Math.max(0, Number(sp.get("offset") ?? 0) || 0));
  const limit = 50;
  const col = COLS[type];
  const rows = await db.select().from(users).where(ne(users.status, "banned")).orderBy(desc(col), asc(users.id)).limit(limit + 1).offset(offset);
  const mine = type === "coins" ? user.lifetimeEarned : type === "referrals" ? user.referralCount : user.xp;
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(ne(users.status, "banned"), or(gt(col, mine), and(eq(col, mine), lt(users.id, user.id)))));
  // Coins are stored in milli-GOP; leaderboards display whole GOP.
  const stat = (u: typeof user) => (type === "coins" ? Math.floor(u.lifetimeEarned / MILLI) : type === "referrals" ? u.referralCount : u.level);
  return json({
    type,
    offset,
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((u, i) => ({ rank: offset + i + 1, ...publicProfile(u), value: stat(u), isMe: u.id === user.id })),
    me: { rank: user.status === "banned" ? null : c + 1, ...publicProfile(user), value: stat(user) },
  });
});
