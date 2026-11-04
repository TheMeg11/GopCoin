import { timingSafeEqual } from "crypto";
import { handleUpdate, type TgUpdate } from "@/lib/bot";
import { webhookSecret } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Telegram webhook — authenticated with the X-Telegram-Bot-Api-Secret-Token header. */
export async function POST(req: Request) {
  if (!process.env.BOT_TOKEN) return new Response("not configured", { status: 503 });
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const expected = Buffer.from(webhookSecret());
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return new Response("forbidden", { status: 401 });
  try {
    const update = (await req.json()) as TgUpdate;
    await handleUpdate(update);
  } catch (e) {
    console.error("[bot] update failed", e);
  }
  // Always 200 so Telegram doesn't retry-storm on a single bad update.
  return Response.json({ ok: true });
}
