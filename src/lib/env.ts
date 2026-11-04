import { createHash } from "crypto";

/** Demo login exists only so the app can be previewed outside Telegram. It is automatically
 * disabled whenever BOT_TOKEN is configured (i.e. every real deployment). */
export function demoMode(): boolean {
  return !process.env.BOT_TOKEN && process.env.DISABLE_DEMO_LOGIN !== "true";
}

export const DEMO_ADMIN_ID = 999000001;

/** Numeric Telegram ID of the single primary administrator (server-side only).
 * Accepts TELEGRAM_ADMIN_ID or the shorter ADMIN_ID alias. */
export function adminTelegramId(): number | null {
  const raw = process.env.TELEGRAM_ADMIN_ID?.trim() || process.env.ADMIN_ID?.trim();
  if (raw && /^\d{1,20}$/.test(raw)) return Number(raw);
  return demoMode() ? DEMO_ADMIN_ID : null;
}

export function isAdminTelegramId(id: number): boolean {
  const admin = adminTelegramId();
  return admin !== null && id === admin;
}

export function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.BOT_TOKEN) return createHash("sha256").update("gop-session:" + process.env.BOT_TOKEN).digest("hex");
  return "gop-demo-session-secret-not-for-production";
}

export function webhookSecret(): string {
  if (process.env.WEBHOOK_SECRET) return process.env.WEBHOOK_SECRET;
  return createHash("sha256").update("gop-webhook:" + (process.env.BOT_TOKEN ?? "")).digest("hex").slice(0, 48);
}

export function botUsername(): string {
  return (process.env.BOT_USERNAME ?? "GopCoinBot").replace(/^@/, "");
}

export function webAppUrl(): string {
  return (process.env.WEBAPP_URL ?? "").replace(/\/$/, "");
}

/** Referral links. Direct Mini App link (startapp) when MINIAPP_SHORT_NAME is set, else bot /start link. */
export function referralLinks(code: string) {
  const bot = botUsername();
  const botLink = `https://t.me/${bot}?start=ref_${code}`;
  const short = process.env.MINIAPP_SHORT_NAME?.trim();
  const appLink = short ? `https://t.me/${bot}/${short}?startapp=ref_${code}` : null;
  return { primary: appLink ?? botLink, botLink, appLink };
}

export function initDataMaxAgeSec(): number {
  const v = Number(process.env.INIT_DATA_MAX_AGE ?? 86400);
  return Number.isFinite(v) && v > 0 ? v : 86400;
}
