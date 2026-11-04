import { createHmac, timingSafeEqual } from "crypto";

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  allows_write_to_pm?: boolean;
  is_bot?: boolean;
};

export type ValidatedInitData = { user: TelegramUser; authDate: number; startParam: string | null };

export class InitDataError extends Error {}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * Official Telegram Mini App validation:
 * secret_key = HMAC_SHA256("WebAppData", bot_token); hash = hex(HMAC_SHA256(secret_key, data_check_string)).
 * data_check_string = all fields except `hash`, sorted by key, "key=value" joined with "\n".
 * Newer clients also send an Ed25519 `signature` field; we accept both canonical variants
 * (with and without `signature`) — both are still authenticated by the bot-token HMAC.
 */
export function validateInitData(initData: string, botToken: string, maxAgeSec: number, nowSec = Math.floor(Date.now() / 1000)): ValidatedInitData {
  if (!initData || initData.length > 8192) throw new InitDataError("missing or oversized initData");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError("missing hash");
  const entries: [string, string][] = [];
  params.forEach((v, k) => {
    if (k !== "hash") entries.push([k, v]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const secret = hmac("WebAppData", botToken);
  const expected = Buffer.from(hash, "hex");
  const check = (list: [string, string][]) => {
    const dcs = list.map(([k, v]) => `${k}=${v}`).join("\n");
    const got = hmac(secret, dcs);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  if (!check(entries) && !check(entries.filter(([k]) => k !== "signature"))) throw new InitDataError("bad signature");

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) throw new InitDataError("bad auth_date");
  if (nowSec - authDate > maxAgeSec) throw new InitDataError("initData expired");
  if (authDate - nowSec > 300) throw new InitDataError("auth_date in the future");

  const userRaw = params.get("user");
  if (!userRaw) throw new InitDataError("no user");
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new InitDataError("bad user json");
  }
  if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) throw new InitDataError("bad user id");
  if (user.is_bot) throw new InitDataError("bots not allowed");
  return { user, authDate, startParam: params.get("start_param") };
}

/** Test helper: produce a correctly signed initData string. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const entries = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const hash = hmac(hmac("WebAppData", botToken), dcs).toString("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}

/** Start parameter format shared by bot `/start` and Mini App `startapp`: [A-Za-z0-9_-], ≤64 chars. */
export function parseReferralParam(param: string | null | undefined): string | null {
  if (!param) return null;
  const m = /^ref_([A-Za-z0-9]{6,16})$/.exec(param.trim());
  return m ? m[1].toUpperCase() : null;
}

type TgResult<T> = { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };

export async function tgApi<T = unknown>(method: string, payload: Record<string, unknown> | FormData): Promise<TgResult<T>> {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, description: "BOT_TOKEN not configured", error_code: 0 };
  try {
    const isForm = payload instanceof FormData;
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: isForm ? undefined : { "content-type": "application/json" },
      body: isForm ? (payload as FormData) : JSON.stringify(payload),
      signal: AbortSignal.timeout(isForm ? 120_000 : 10_000),
    });
    return (await res.json()) as TgResult<T>;
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : "network error", error_code: -1 };
  }
}
