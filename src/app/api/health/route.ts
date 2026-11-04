import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Readiness: database reachable AND schema migrated. */
export async function GET() {
  try {
    await db.execute(sql`select 1 from users limit 1`);
    await db.execute(sql`select 1 from game_config limit 1`);
    return Response.json({ ok: true, db: "ok", time: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, db: "error", message: e instanceof Error ? e.message.slice(0, 120) : "unknown" }, { status: 503 });
  }
}
